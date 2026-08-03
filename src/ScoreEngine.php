<?php

require_once __DIR__ . '/JobCatalog.php';
require_once __DIR__ . '/EducationCatalog.php';
require_once __DIR__ . '/CertCatalog.php';

// =====================================================================
// FILE: src/ScoreEngine.php
// ---------------------------------------------------------------------
// Isolated scoring logic. compute() keeps a stable signature and return
// shape so endpoints never change when the algorithm evolves. Every
// stored score records ScoreEngine::VERSION (scores.algo_version /
// job_applications.score_algo), so historical results stay
// interpretable across algorithm revisions.
//
// FUTURE (noted 2026-07): multiple selectable algorithms, letting
// companies re-sort applicants under different weightings. When that
// lands, compute() gains an algorithm identifier and each variant keeps
// its own version string.
// =====================================================================

class ScoreEngine
{
    const VERSION = 'no-completeness-split1-v2.5';

    // ------------------------------------------------------------------
    // Tunable weights (must sum to 100). Adjust ratios here — the logic
    // below scales automatically.
    // ------------------------------------------------------------------
    const W_EXPERIENCE_RELEVANT = 37;  // years in the job's category (adjacent = half credit)
    const W_EXPERIENCE_GENERAL  = 9;   // any work history at all (small floor)
    const W_SKILLS              = 22;  // relevant skills (with experience backfill floor)
    const W_EDU_PRESENCE        = 7;   // has degree(s)
    const W_EDU_RELEVANCE       = 11;  // degree field related to the job's category
    const W_CERTS               = 14;  // certifications, relevance-weighted
    // Profile-completeness factor removed (v2.5); its 15 points were
    // redistributed above (experience/certs/education/skills). Weights
    // still sum to 100: 37 + 9 + 22 + 7 + 11 + 14 = 100.

    // ------------------------------------------------------------------
    // AI-INCLUSIVE algorithm (second algorithm). Its own weight table:
    // the Standard weights carved proportionally (x0.88) to make room for
    // a dedicated AI-skills factor worth AI_W_AI_SKILLS. Sum is 100:
    // 33 + 8 + 19 + 6 + 10 + 12 + 12 = 100. Stored alongside the Standard
    // score (scores.ai_score); surfaced via the Standard/AI toggle.
    // ------------------------------------------------------------------
    const AI_W_EXPERIENCE_RELEVANT = 33;
    const AI_W_EXPERIENCE_GENERAL  = 8;
    const AI_W_SKILLS              = 19;
    const AI_W_EDU_PRESENCE        = 6;
    const AI_W_EDU_RELEVANCE       = 10;
    const AI_W_CERTS               = 12;
    const AI_W_AI_SKILLS           = 12;  // dedicated AI-skillset factor
    // AI skills live in a sparser space than the general skill catalog, so
    // relevance is judged more generously: a higher base floor and a lower
    // "relevant" threshold than the Standard skill path.
    const AI_SKILL_BASE_RELEVANCE  = 0.30;
    const AI_SKILL_RELEVANT_THRESHOLD = 0.25;
    // AI-skill "mass" (relevance summed) that earns the full AI-skills points.
    const FULL_AI_SKILL_MASS       = 2.5;

    // Relevant years that earn full experience points.
    const FULL_RELEVANT_YEARS = 8.0;
    // Total years that earn the full general-experience floor.
    const FULL_GENERAL_YEARS = 4.0;
    // Relevant-skill "mass" (relevance x proficiency summed) for full skill points.
    const FULL_SKILL_MASS = 3.0;
    // Skill floor: experienced candidates imply skills. Fraction of the
    // (scaled) experience factor that the skill factor can never drop below.
    const SKILL_BACKFILL_FRACTION = 0.5;
    // Text-relevance threshold for counting a cert as "relevant".
    const RELEVANT_THRESHOLD = 0.34;
    // Base relevance credited to ANY listed skill, so the skills factor is
    // never a flat zero when the catalog can't recognise a skill's tokens
    // (or the target doesn't resolve to a category). Deliberately below
    // RELEVANT_THRESHOLD: it contributes to the mass but is never labelled a
    // "relevant" skill, and the mass cap (FULL_SKILL_MASS) keeps a pile of
    // floor-only skills from reaching full points.
    const SKILL_BASE_RELEVANCE = 0.15;

    /**
     * Standard algorithm — the default score. Unchanged composition:
     * experience + skills + education + certs, weights summing to 100.
     *
     * @return array { score: float (0-100), breakdown: array }
     */
    public static function compute(array $profile, string $targetType, string $targetValue): array
    {
        return self::computeWeighted($profile, $targetType, $targetValue, [
            'exp_rel'  => self::W_EXPERIENCE_RELEVANT,
            'exp_gen'  => self::W_EXPERIENCE_GENERAL,
            'skills'   => self::W_SKILLS,
            'edu_pres' => self::W_EDU_PRESENCE,
            'edu_rel'  => self::W_EDU_RELEVANCE,
            'certs'    => self::W_CERTS,
            'ai'       => 0,
        ], false);
    }

    /**
     * AI-inclusive algorithm — the second algorithm. Same factors as
     * Standard but carved proportionally to add a dedicated AI-skills
     * factor scored from the user's AI skillset (user_settings.ai_skills).
     * When the user has no AI skillset enabled/listed, the AI factor
     * contributes 0 and the score is simply the reweighted remainder.
     *
     * @return array { score: float (0-100), breakdown: array }
     */
    public static function computeAiInclusive(array $profile, string $targetType, string $targetValue): array
    {
        return self::computeWeighted($profile, $targetType, $targetValue, [
            'exp_rel'  => self::AI_W_EXPERIENCE_RELEVANT,
            'exp_gen'  => self::AI_W_EXPERIENCE_GENERAL,
            'skills'   => self::AI_W_SKILLS,
            'edu_pres' => self::AI_W_EDU_PRESENCE,
            'edu_rel'  => self::AI_W_EDU_RELEVANCE,
            'certs'    => self::AI_W_CERTS,
            'ai'       => self::AI_W_AI_SKILLS,
        ], true);
    }

    /**
     * Shared scoring core, driven by a weight table $W so the Standard and
     * AI-inclusive algorithms share one code path (no logic drift). When
     * $withAi is true an extra AI-skills factor (weight $W['ai']) is scored
     * from $profile['ai_skillset'].
     *
     * @param array  $profile     Gathered user data (see gatherProfile()).
     * @param string $targetType  'job_title' | 'skill' | 'field'
     * @param string $targetValue The thing being scored against.
     * @param array  $W           Weight table (keys: exp_rel, exp_gen,
     *                             skills, edu_pres, edu_rel, certs, ai).
     * @param bool   $withAi       Include the AI-skills factor.
     *
     * @return array { score: float (0-100), breakdown: array }
     */
    private static function computeWeighted(array $profile, string $targetType, string $targetValue, array $W, bool $withAi): array
    {
        $factors = [];
        $target  = trim($targetValue);

        // Resolve the target to a catalog category where possible. For
        // 'job_title' targets this is the anchor of all relevance math.
        // 'skill' / 'field' targets resolve through the same token map.
        $catId   = JobCatalog::categoryForTitle($target);
        $catName = $catId !== null ? JobCatalog::CATEGORIES[$catId] : null;

        // ---- 1) Experience (relevant + general) ----------------------
        $relevantYears = 0.0;
        $totalYears    = 0.0;
        foreach ($profile['jobs'] as $j) {
            $years = self::yearsBetween($j['start_date'] ?? null, $j['end_date'] ?? null);
            if ($years <= 0) continue;
            $totalYears += $years;

            $credit = 0.0;
            if ($catId !== null) {
                $jobCat = JobCatalog::categoryForTitle($j['title'] ?? '');
                if ($jobCat === $catId) {
                    $credit = 1.0;
                } elseif ($jobCat !== null && in_array($jobCat, JobCatalog::ADJACENCY[$catId] ?? [], true)) {
                    $credit = 0.5;
                } else {
                    // Same-category resolution failed — try direct title text.
                    $credit = 0.6 * JobCatalog::titleSimilarity($j['title'] ?? '', $target);
                }
            } else {
                // Off-catalog target: fall back to plain title similarity.
                $credit = JobCatalog::titleSimilarity($j['title'] ?? '', $target);
            }
            $relevantYears += $years * $credit;
        }

        $relPts = $W['exp_rel'] * min(1.0, $relevantYears / self::FULL_RELEVANT_YEARS);
        $genPts = $W['exp_gen'] * min(1.0, $totalYears / self::FULL_GENERAL_YEARS);
        $factors[] = [
            'factor' => 'relevant_experience',
            'detail' => sprintf(
                '%.1f relevant year(s)%s out of %.1f total',
                $relevantYears,
                $catName ? " in/near \"$catName\"" : ' (by title similarity)',
                $totalYears
            ),
            'points' => round($relPts, 1),
        ];
        $factors[] = [
            'factor' => 'general_experience',
            'detail' => sprintf('%.1f total year(s) of work history', $totalYears),
            'points' => round($genPts, 1),
        ];
        $experiencePts = $relPts + $genPts;

        // ---- 2) Skills (relevance x proficiency, experience backfill) -
        // Relevance signal, per skill (0..1):
        //   a) token-overlap with the target string (weak; a skill name
        //      rarely shares words with a job title), and
        //   b) when the target resolves to a category, the skill's tokens
        //      mapped through TOKEN_MAP onto that category (the main signal).
        // Both can legitimately return 0 for a real skill: the target may
        // not resolve to a category at all (a), or the skill's tokens may
        // simply be absent from the curated TOKEN_MAP (b). Previously those
        // skills were dropped entirely (`$rel <= 0` -> continue), so a
        // profile of relevant-looking skills could sit at a flat 0/20 no
        // matter what was added. To avoid that dead zone we give every
        // listed skill a small BASE floor — deliberately below
        // RELEVANT_THRESHOLD so it never counts as a "relevant" skill and
        // can't lift a keyword-stuffed profile to the top (the mass is still
        // capped at FULL_SKILL_MASS). Genuine category matches score far
        // higher and continue to dominate. This is a conservative stopgap;
        // the skills model is expected to be revisited with the AI signal.
        $skillMass = 0.0;
        $relevantSkillNames = [];
        foreach ($profile['skills'] as $s) {
            $name = $s['name'] ?? '';
            if ($name === '') continue;
            $rel = JobCatalog::titleSimilarity($name, $target);
            if ($catId !== null) {
                $rel = max($rel, JobCatalog::tokenRelevance($name, $catId));
            }
            // Base floor for any listed skill, so the factor is never a flat
            // zero just because the catalog didn't recognise the tokens.
            $rel = max($rel, self::SKILL_BASE_RELEVANCE);
            $prof   = isset($s['proficiency']) && $s['proficiency'] !== null
                ? max(1, min(5, (int) $s['proficiency'])) / 5.0
                : 0.6;   // unrated skills count at 60%
            $skillMass += $rel * $prof;
            if ($rel >= self::RELEVANT_THRESHOLD) $relevantSkillNames[] = $name;
        }
        $skillMatchPts = $W['skills'] * min(1.0, $skillMass / self::FULL_SKILL_MASS);

        // Experience implies skills: deep relevant experience sets a floor
        // under the skill factor so a sparse-but-experienced profile can't
        // be leapfrogged by a keyword-stuffed empty one.
        $expFraction = $experiencePts / ($W['exp_rel'] + $W['exp_gen']);
        $backfill    = $W['skills'] * self::SKILL_BACKFILL_FRACTION * $expFraction;
        $skillPts    = max($skillMatchPts, $backfill);

        $totalSkills = 0;
        foreach ($profile['skills'] as $s) { if (($s['name'] ?? '') !== '') $totalSkills++; }
        $skillDetail = count($relevantSkillNames)
            ? count($relevantSkillNames) . ' relevant skill(s): ' . implode(', ', array_slice($relevantSkillNames, 0, 5))
            : ($totalSkills > 0
                ? $totalSkills . ' skill(s) listed — base credit applied (none matched the target closely enough for full credit)'
                : 'No skills listed');
        if ($backfill > $skillMatchPts && $backfill > 0) {
            $skillDetail .= ' — credited from relevant experience';
        }
        $factors[] = [
            'factor' => 'skills_match',
            'detail' => $skillDetail,
            'points' => round($skillPts, 1),
        ];

        // ---- 3) Education (presence + field relevance) ----------------
        $eduCount = count($profile['education']);
        $eduPresencePts = $eduCount >= 2 ? $W['edu_pres']
                        : ($eduCount === 1 ? $W['edu_pres'] * 0.67 : 0);
        $bestEduRel = 0.0;
        $bestEduField = null;
        foreach ($profile['education'] as $e) {
            $text = trim(($e['field'] ?? '') . ' ' . ($e['degree'] ?? ''));
            if ($text === '') continue;

            // 1) Deterministic: the field resolves through the education
            //    catalog to job categories (full credit on a direct hit,
            //    half on an adjacent category).
            $rel = 0.0;
            if ($catId !== null) {
                $fieldCats = EducationCatalog::categoriesForField($e['field'] ?? '');
                if ($fieldCats !== null && count($fieldCats)) {
                    if (in_array($catId, $fieldCats, true)) {
                        $rel = 1.0;
                    } elseif (array_intersect($fieldCats, JobCatalog::ADJACENCY[$catId] ?? [])) {
                        $rel = 0.5;
                    }
                }
            }

            // 2) Fuzzy fallback / supplement: token relevance + similarity.
            $rel = max($rel, JobCatalog::titleSimilarity($text, $target));
            if ($catId !== null) $rel = max($rel, JobCatalog::tokenRelevance($text, $catId));

            if ($rel > $bestEduRel) { $bestEduRel = $rel; $bestEduField = $e['field'] ?: $e['degree']; }
        }
        $eduRelPts = $W['edu_rel'] * $bestEduRel;
        $factors[] = [
            'factor' => 'education',
            'detail' => $eduCount
                ? ($eduCount . ' degree(s)' . ($bestEduField && $bestEduRel >= self::RELEVANT_THRESHOLD
                    ? ", \"$bestEduField\" relates to the role" : ''))
                : 'No education records',
            'points' => round($eduPresencePts + $eduRelPts, 1),
        ];

        // ---- 4) Certifications (relevance-weighted) -------------------
        // Mirrors the education pattern: resolve the cert through the
        // curated CertCatalog first (1.0 on a direct category hit, 0.5
        // adjacent), fuzzy text matching as fallback/supplement. Points
        // are graded — 1 (any cert counts a little) + 3×relevance — so
        // a directly relevant cert earns 4, an adjacent-field one ~2.5,
        // an unrelated one 1.
        $certPts = 0.0;
        $relCertCount = 0;
        foreach ($profile['certifications'] as $c) {
            $text = trim(($c['name'] ?? '') . ' ' . ($c['issuer'] ?? ''));
            if ($text === '') continue;

            $rel = 0.0;
            if ($catId !== null) {
                $certCats = CertCatalog::categoriesForCert($c['name'] ?? '', $c['issuer'] ?? '');
                if ($certCats !== null && count($certCats)) {
                    if (in_array($catId, $certCats, true)) {
                        $rel = 1.0;
                    } elseif (array_intersect($certCats, JobCatalog::ADJACENCY[$catId] ?? [])) {
                        $rel = 0.5;
                    }
                }
            }
            $rel = max($rel, JobCatalog::titleSimilarity($text, $target));
            if ($catId !== null) $rel = max($rel, JobCatalog::tokenRelevance($text, $catId));

            $certPts += 1 + 3 * $rel;
            if ($rel >= self::RELEVANT_THRESHOLD) $relCertCount++;
        }
        $certPts = min($W['certs'], $certPts);
        $factors[] = [
            'factor' => 'certifications',
            'detail' => count($profile['certifications'])
                ? count($profile['certifications']) . " certification(s), $relCertCount relevant"
                : 'No certifications',
            'points' => round($certPts, 1),
        ];

        // ---- 5) AI skills (AI-inclusive algorithm only) ---------------
        // Scored from the user's AI skillset (user_settings.ai_skills),
        // using a more generous relevance model than the Standard skill
        // path (higher base floor, lower threshold) because the AI skill
        // space is sparser. Contributes 0 when the skillset is disabled or
        // empty. The Standard algorithm never reaches this block.
        $aiSkillPts = 0.0;
        $aiActive = false;
        if ($withAi) {
            $ai = $profile['ai_skillset'] ?? ['enabled' => false, 'skills' => []];
            $aiMass = 0.0; $aiRelevant = [];
            if (!empty($ai['enabled']) && !empty($ai['skills'])) {
                $aiActive = true;
                foreach ($ai['skills'] as $name) {
                    $name = is_string($name) ? trim($name) : '';
                    if ($name === '') continue;
                    $rel = JobCatalog::titleSimilarity($name, $target);
                    if ($catId !== null) {
                        $rel = max($rel, JobCatalog::tokenRelevance($name, $catId));
                    }
                    $rel = max($rel, self::AI_SKILL_BASE_RELEVANCE);
                    $aiMass += $rel;
                    if ($rel >= self::AI_SKILL_RELEVANT_THRESHOLD) $aiRelevant[] = $name;
                }
            }
            $aiSkillPts = $W['ai'] * min(1.0, $aiMass / self::FULL_AI_SKILL_MASS);
            $factors[] = [
                'factor' => 'ai_skills',
                'detail' => count($aiRelevant)
                    ? count($aiRelevant) . ' AI skill(s): ' . implode(', ', array_slice($aiRelevant, 0, 5))
                    : (!empty($ai['enabled'])
                        ? 'No AI skills listed'
                        : 'AI skillset not enabled'),
                'points' => round($aiSkillPts, 1),
            ];
        }

        // ---- Total -----------------------------------------------------
        // Profile-completeness/strength factor removed (v2.5): general
        // completeness didn't reflect true expertise. Its 15 weight points
        // were redistributed into the factors that do — experience, certs,
        // education, and skills (see the W_* constants) — keeping the sum
        // at 100. gatherProfile still returns interests/etc. for other
        // consumers; they simply no longer score here.
        $nonAi = $experiencePts + $skillPts + ($eduPresencePts + $eduRelPts) + $certPts;
        if (!$withAi) {
            $score = $nonAi;
        } else {
            // AI-inclusive (option (b), additive). The non-AI factors are
            // carved to (100 - AI weight); renormalize them back to a full
            // 100 base so the AI-inclusive score is directly comparable to
            // Standard. The AI factor then adds a bonus scaled INTO the
            // remaining headroom (how far below 100 the base sits), so AI
            // skills can only ever RAISE the score, never dilute it — a
            // partial AI factor can't underperform having no AI skills.
            $denom = 100 - $W['ai'];
            $base  = $denom > 0 ? $nonAi * (100.0 / $denom) : $nonAi;
            $aiFrac = $W['ai'] > 0 ? min(1.0, $aiSkillPts / $W['ai']) : 0.0;
            $headroom = max(0.0, 100.0 - $base);
            $score = $base + $headroom * $aiFrac;
        }
        $score = max(0.0, min(100.0, $score));

        return [
            'score'     => round($score, 1),
            'breakdown' => $factors,
        ];
    }

    /** Fractional years between two dates; end NULL = today. */
    private static function yearsBetween(?string $start, ?string $end): float
    {
        if (!$start) return 0.0;
        $s = strtotime($start);
        if ($s === false) return 0.0;
        $e = $end ? strtotime($end) : time();
        if ($e === false || $e <= $s) return 0.0;
        return ($e - $s) / (365.25 * 24 * 3600);
    }

    /**
     * Gather the profile data compute() needs for one user. Shared by
     * Score Me and job applications so both score the same way. Kept
     * here (next to compute) so the algorithm and its inputs evolve
     * together.
     */
    public static function gatherProfile(PDO $pdo, int $userId): array
    {
        // Merge admin-added catalog entries into cert resolution (cached
        // per request; a no-op if the table isn't migrated yet).
        CertCatalog::loadCustom($pdo);

        $skills = $pdo->prepare(
            'SELECT s.name, us.proficiency
             FROM user_skills us JOIN skills s ON s.id = us.skill_id
             WHERE us.user_id = ?'
        );
        $skills->execute([$userId]);

        $jobs = $pdo->prepare(
            'SELECT title, company_name, start_date, end_date FROM job_history WHERE user_id = ?'
        );
        $jobs->execute([$userId]);

        $edu = $pdo->prepare(
            'SELECT institution, degree, field FROM education WHERE user_id = ?'
        );
        $edu->execute([$userId]);

        $certs = $pdo->prepare(
            'SELECT name, issuer FROM certifications WHERE user_id = ?'
        );
        $certs->execute([$userId]);

        $interests = $pdo->prepare(
            'SELECT i.name FROM user_interests ui JOIN interests i ON i.id = ui.interest_id
             WHERE ui.user_id = ?'
        );
        $interests->execute([$userId]);

        // AI skillset — stored in user_settings as 'ai_box_enabled' ("1"/"0")
        // and 'ai_skills' (JSON string array). Loaded here so the AI-inclusive
        // algorithm can score them; the Standard algorithm ignores this key.
        // Mirrors api/profile/get.php's read exactly.
        $aiStmt = $pdo->prepare(
            "SELECT setting_key, setting_value FROM user_settings
             WHERE user_id = ? AND setting_key IN ('ai_box_enabled', 'ai_skills')"
        );
        $aiStmt->execute([$userId]);
        $aiEnabled = false;
        $aiSkills  = [];
        foreach ($aiStmt->fetchAll() as $row) {
            if ($row['setting_key'] === 'ai_box_enabled') {
                $aiEnabled = ($row['setting_value'] === '1');
            } elseif ($row['setting_key'] === 'ai_skills') {
                $decoded = json_decode((string) $row['setting_value'], true);
                if (is_array($decoded)) $aiSkills = array_values(array_filter($decoded, 'is_string'));
            }
        }

        return [
            'skills'         => $skills->fetchAll(),
            'jobs'           => $jobs->fetchAll(),
            'education'      => $edu->fetchAll(),
            'certifications' => $certs->fetchAll(),
            'interests'      => $interests->fetchAll(),
            'ai_skillset'    => ['enabled' => $aiEnabled, 'skills' => $aiSkills],
        ];
    }
}

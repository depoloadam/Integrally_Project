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
    const VERSION = 'cert-catalog-v2.3';

    // ------------------------------------------------------------------
    // Tunable weights (must sum to 100). Adjust ratios here — the logic
    // below scales automatically.
    // ------------------------------------------------------------------
    const W_EXPERIENCE_RELEVANT = 32;  // years in the job's category (adjacent = half credit)
    const W_EXPERIENCE_GENERAL  = 8;   // any work history at all (small floor)
    const W_SKILLS              = 20;  // relevant skills (with experience backfill floor)
    const W_EDU_PRESENCE        = 6;   // has degree(s)
    const W_EDU_RELEVANCE       = 9;   // degree field related to the job's category
    const W_CERTS               = 10;  // certifications, relevance-weighted
    const W_PROFILE_STRENGTH    = 15;  // general completeness

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

    /**
     * Compute a score for a user against a target.
     *
     * @param array  $profile     Gathered user data (see gatherProfile()).
     * @param string $targetType  'job_title' | 'skill' | 'field'
     * @param string $targetValue The thing being scored against.
     *
     * @return array { score: float (0-100), breakdown: array }
     */
    public static function compute(array $profile, string $targetType, string $targetValue): array
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

        $relPts = self::W_EXPERIENCE_RELEVANT * min(1.0, $relevantYears / self::FULL_RELEVANT_YEARS);
        $genPts = self::W_EXPERIENCE_GENERAL  * min(1.0, $totalYears / self::FULL_GENERAL_YEARS);
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
        $skillMass = 0.0;
        $relevantSkillNames = [];
        foreach ($profile['skills'] as $s) {
            $name = $s['name'] ?? '';
            if ($name === '') continue;
            $rel = JobCatalog::titleSimilarity($name, $target);
            if ($catId !== null) {
                $rel = max($rel, JobCatalog::tokenRelevance($name, $catId));
            }
            if ($rel <= 0) continue;
            $prof   = isset($s['proficiency']) && $s['proficiency'] !== null
                ? max(1, min(5, (int) $s['proficiency'])) / 5.0
                : 0.6;   // unrated skills count at 60%
            $skillMass += $rel * $prof;
            if ($rel >= self::RELEVANT_THRESHOLD) $relevantSkillNames[] = $name;
        }
        $skillMatchPts = self::W_SKILLS * min(1.0, $skillMass / self::FULL_SKILL_MASS);

        // Experience implies skills: deep relevant experience sets a floor
        // under the skill factor so a sparse-but-experienced profile can't
        // be leapfrogged by a keyword-stuffed empty one.
        $expFraction = $experiencePts / (self::W_EXPERIENCE_RELEVANT + self::W_EXPERIENCE_GENERAL);
        $backfill    = self::W_SKILLS * self::SKILL_BACKFILL_FRACTION * $expFraction;
        $skillPts    = max($skillMatchPts, $backfill);

        $skillDetail = count($relevantSkillNames)
            ? count($relevantSkillNames) . ' relevant skill(s): ' . implode(', ', array_slice($relevantSkillNames, 0, 5))
            : 'No directly relevant skills listed';
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
        $eduPresencePts = $eduCount >= 2 ? self::W_EDU_PRESENCE
                        : ($eduCount === 1 ? self::W_EDU_PRESENCE * 0.67 : 0);
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
        $eduRelPts = self::W_EDU_RELEVANCE * $bestEduRel;
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
        $certPts = min(self::W_CERTS, $certPts);
        $factors[] = [
            'factor' => 'certifications',
            'detail' => count($profile['certifications'])
                ? count($profile['certifications']) . " certification(s), $relCertCount relevant"
                : 'No certifications',
            'points' => round($certPts, 1),
        ];

        // ---- 5) General profile strength ------------------------------
        // Interests removed from the product UI (v2.2): their 2 points
        // were redistributed to education (3->4) and certifications
        // (2->3) so the 15-point ceiling stays reachable. gatherProfile
        // still returns interests for any other consumer; they simply
        // no longer score.
        $sc = count($profile['skills']);
        $strength  = $sc >= 3 ? 4 : ($sc >= 1 ? 2 : 0);
        $strength += $eduCount >= 1 ? 4 : 0;
        $strength += count($profile['certifications']) >= 1 ? 3 : 0;
        $jc = count($profile['jobs']);
        $strength += $jc >= 2 ? 4 : ($jc >= 1 ? 2 : 0);
        $strength  = min(self::W_PROFILE_STRENGTH, $strength);
        $factors[] = [
            'factor' => 'profile_strength',
            'detail' => 'Overall profile completeness',
            'points' => round((float) $strength, 1),
        ];

        // ---- Total -----------------------------------------------------
        $score = $experiencePts + $skillPts + ($eduPresencePts + $eduRelPts) + $certPts + $strength;
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

        return [
            'skills'         => $skills->fetchAll(),
            'jobs'           => $jobs->fetchAll(),
            'education'      => $edu->fetchAll(),
            'certifications' => $certs->fetchAll(),
            'interests'      => $interests->fetchAll(),
        ];
    }
}

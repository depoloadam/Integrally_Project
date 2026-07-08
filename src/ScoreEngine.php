<?php


// =====================================================================
// FILE: src/ScoreEngine.php
// ---------------------------------------------------------------------
// Isolated scoring logic. Replace compute() with your real algorithm
// when ready. Keep the SAME signature and return shape and none of the
// endpoints need to change.
// =====================================================================

class ScoreEngine
{
    // Bump this when you change the algorithm. Stored with each score
    // so old results stay interpretable (the scores.algo_version column).
    const VERSION = 'placeholder-v1';

    /**
     * Compute a score for a user against a target.
     *
     * @param array  $profile  Gathered user data (see gatherProfile()).
     * @param string $targetType  'job_title' | 'skill' | 'field'
     * @param string $targetValue The thing being scored against.
     *
     * @return array {
     *   score:     float  // 0–100
     *   breakdown: array  // per-factor detail, shown to the user
     * }
     *
     * ----------------------------------------------------------------
     * PLACEHOLDER IMPLEMENTATION
     * ----------------------------------------------------------------
     * This is NOT a real scoring algorithm. It produces a transparent,
     * deterministic number from simple profile-completeness signals so
     * the whole feature can be built and tested end to end. Replace the
     * body with your real logic later; keep the return shape.
     */
    public static function compute(array $profile, string $targetType, string $targetValue): array
    {
        $factors = [];

        // --- Each factor contributes some points (illustrative only) ---

        // Skills present (up to 30).
        $skillCount = count($profile['skills']);
        $skillPts   = min(30, $skillCount * 6);
        $factors[] = [
            'factor' => 'skills_listed',
            'detail' => "$skillCount skill(s) on profile",
            'points' => $skillPts,
        ];

        // Job history depth (up to 25).
        $jobCount = count($profile['jobs']);
        $jobPts   = min(25, $jobCount * 8);
        $factors[] = [
            'factor' => 'experience',
            'detail' => "$jobCount job record(s)",
            'points' => $jobPts,
        ];

        // Education (up to 15).
        $eduCount = count($profile['education']);
        $eduPts   = min(15, $eduCount * 8);
        $factors[] = [
            'factor' => 'education',
            'detail' => "$eduCount education record(s)",
            'points' => $eduPts,
        ];

        // Certifications (up to 15).
        $certCount = count($profile['certifications']);
        $certPts   = min(15, $certCount * 8);
        $factors[] = [
            'factor' => 'certifications',
            'detail' => "$certCount certification(s)",
            'points' => $certPts,
        ];

        // Naive keyword relevance: does the target text appear in any
        // skill/job title? (up to 15). Stand-in for real matching.
        $needle = strtolower(trim($targetValue));
        $hit = false;
        foreach ($profile['skills'] as $s) {
            if ($needle !== '' && str_contains(strtolower($s['name']), $needle)) { $hit = true; break; }
        }
        if (!$hit) {
            foreach ($profile['jobs'] as $j) {
                if ($needle !== '' && str_contains(strtolower($j['title']), $needle)) { $hit = true; break; }
            }
        }
        $relPts = $hit ? 15 : 0;
        $factors[] = [
            'factor' => 'target_relevance',
            'detail' => $hit ? "Profile mentions \"$targetValue\"" : "No direct mention of \"$targetValue\"",
            'points' => $relPts,
        ];

        $score = $skillPts + $jobPts + $eduPts + $certPts + $relPts;
        $score = max(0, min(100, $score));   // clamp to 0–100

        return [
            'score'     => (float) $score,
            'breakdown' => $factors,
        ];
    }

    /**
     * Gather the profile data compute() needs for one user. Shared by
     * Score Me and job applications so both score the same way. Kept
     * here (next to compute) so the algorithm and its inputs evolve
     * together.
     */
    public static function gatherProfile(PDO $pdo, int $userId): array
    {
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
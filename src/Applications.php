<?php

// =====================================================================
// FILE: src/Applications.php
// Shared helpers for native job applications.
//   - apply_form spec validation (the company-defined question set)
//   - answer validation against that spec
//   - derived application status (submitted/withdrawn are stored;
//     expired/job_unavailable are computed here, never stored)
//   - apply-time score snapshot (reuses ScoreEngine)
// =====================================================================

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/ScoreEngine.php';

class Applications
{
    // Fallback application window when a job sets no accept_until date.
    const DEFAULT_WINDOW_DAYS = 90;

    // Allowed custom-question field types.
    const FIELD_TYPES = ['short_text', 'long_text', 'url'];

    const MAX_QUESTIONS   = 10;
    const MAX_ANSWER_LEN  = 5000;
    const MAX_LABEL_LEN   = 160;

    /**
     * Validate + normalize a company-supplied apply_form spec. Returns a
     * clean array ready to json_encode, or errors out (422).
     *
     * Accepted input shape:
     *   {
     *     "collect_resume": bool,     // ask candidate for a resume
     *     "collect_score":  bool,     // snapshot Integrally score at apply
     *     "questions": [
     *       { "label": "...", "type": "short_text|long_text|url",
     *         "required": bool },
     *       ...
     *     ]
     *   }
     *
     * Question "key"s are assigned here (q1, q2, ...) so answers can be
     * matched back stably regardless of label edits.
     */
    public static function normalizeForm($form): array
    {
        require_once __DIR__ . '/Response.php';

        if ($form === null || $form === '') {
            // No form = one-click apply, resume off, score on by default.
            return ['collect_resume' => false, 'collect_score' => true, 'questions' => []];
        }
        if (is_string($form)) {
            $decoded = json_decode($form, true);
            if (!is_array($decoded)) Response::error('apply_form must be valid JSON.', 422);
            $form = $decoded;
        }
        if (!is_array($form)) Response::error('apply_form must be an object.', 422);

        $out = [
            'collect_resume' => !empty($form['collect_resume']),
            'collect_score'  => array_key_exists('collect_score', $form)
                ? !empty($form['collect_score']) : true,
            'questions'      => [],
        ];

        $questions = $form['questions'] ?? [];
        if (!is_array($questions)) Response::error('apply_form.questions must be a list.', 422);
        if (count($questions) > self::MAX_QUESTIONS) {
            Response::error('A job can ask at most ' . self::MAX_QUESTIONS . ' questions.', 422);
        }

        $i = 0;
        foreach ($questions as $q) {
            if (!is_array($q)) Response::error('Each question must be an object.', 422);
            $label = trim((string) ($q['label'] ?? ''));
            if ($label === '') Response::error('Every question needs a label.', 422);
            if (mb_strlen($label) > self::MAX_LABEL_LEN) {
                Response::error('Question labels must be under ' . self::MAX_LABEL_LEN . ' chars.', 422);
            }
            $type = trim((string) ($q['type'] ?? 'short_text'));
            if (!in_array($type, self::FIELD_TYPES, true)) {
                Response::error('Invalid question type "' . $type . '".', 422);
            }
            $i++;
            $out['questions'][] = [
                'key'      => 'q' . $i,
                'label'    => $label,
                'type'     => $type,
                'required' => !empty($q['required']),
            ];
        }

        return $out;
    }

    /**
     * Validate a candidate's answers against a (normalized) form spec.
     * Returns a clean { key => answer } map to store. Errors out (422)
     * on a missing required answer or a malformed URL field.
     */
    public static function validateAnswers(array $form, $answers): array
    {
        require_once __DIR__ . '/Response.php';

        $answers = is_array($answers) ? $answers : [];
        $clean = [];

        foreach ($form['questions'] as $q) {
            $raw = trim((string) ($answers[$q['key']] ?? ''));
            if ($raw === '') {
                if ($q['required']) {
                    Response::error('Please answer: "' . $q['label'] . '".', 422);
                }
                continue; // skip empty optional answers
            }
            if (mb_strlen($raw) > self::MAX_ANSWER_LEN) {
                Response::error('Answer to "' . $q['label'] . '" is too long.', 422);
            }
            if ($q['type'] === 'url' && !preg_match('#^https?://#i', $raw)) {
                Response::error('"' . $q['label'] . '" must be a URL starting with http:// or https://', 422);
            }
            $clean[$q['key']] = $raw;
        }

        return $clean;
    }

    /**
     * Effective status of an application, deriving the read-only states.
     *   stored 'withdrawn'                 -> 'withdrawn'
     *   parent job missing / not 'open'    -> 'job_unavailable'
     *   past effective cutoff              -> 'expired'
     *   otherwise                          -> 'submitted'
     *
     * @param array $app { status, created_at }
     * @param array|null $job { status, accept_until } (null = deleted)
     */
    public static function derivedStatus(array $app, ?array $job): string
    {
        if ($app['status'] === 'withdrawn') return 'withdrawn';
        if ($job === null || ($job['status'] ?? '') !== 'open') return 'job_unavailable';

        $cutoff = self::effectiveCutoff($app['created_at'], $job['accept_until'] ?? null);
        if ($cutoff !== null && time() > $cutoff) return 'expired';

        return 'submitted';
    }

    /**
     * Unix timestamp after which an application is considered expired.
     * Company's accept_until (end of that day) wins; otherwise the
     * submission date plus the default window.
     */
    public static function effectiveCutoff(string $createdAt, ?string $acceptUntil): ?int
    {
        if ($acceptUntil) {
            $t = strtotime($acceptUntil . ' 23:59:59');
            if ($t !== false) return $t;
        }
        $base = strtotime($createdAt);
        if ($base === false) return null;
        return $base + self::DEFAULT_WINDOW_DAYS * 86400;
    }

    /**
     * Human-facing label for a derived status.
     */
    public static function statusLabel(string $derived): string
    {
        switch ($derived) {
            case 'withdrawn':       return 'Withdrawn';
            case 'expired':         return 'Expired';
            case 'job_unavailable': return 'Job no longer available';
            default:                return 'Submitted';
        }
    }

    /**
     * Compute a fresh score snapshot for a user against a job title.
     * Returns { value, breakdown, algo } or null if scoring isn't
     * possible (no title). Never throws — a scoreless application is
     * still valid.
     */
    public static function scoreSnapshot(PDO $pdo, int $userId, string $jobTitle): ?array
    {
        $jobTitle = trim($jobTitle);
        if ($jobTitle === '') return null;

        $profile = ScoreEngine::gatherProfile($pdo, $userId);
        $result  = ScoreEngine::compute($profile, 'job_title', $jobTitle);

        return [
            'value'     => (float) $result['score'],
            'breakdown' => $result['breakdown'],
            'algo'      => ScoreEngine::VERSION,
        ];
    }
}

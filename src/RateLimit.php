<?php

// =====================================================================
// FILE: src/RateLimit.php
// ---------------------------------------------------------------------
// Per-actor request throttling, backed by the `rate_limits` table.
//
// WHY THIS EXISTS
//   Every paginated endpoint already clamps its LIMIT, so no single
//   request can drag the whole table out of MySQL. What was missing was
//   a ceiling on how OFTEN a caller may hit an endpoint. Without one,
//   a single account (or a single anonymous IP) can:
//     - brute-force a password, unlimited attempts
//     - burn CPU by re-running the scoring engine in a loop
//     - full-table-scan the LIKE '%q%' search endpoints continuously
//     - spray message requests / applications at every user on the site
//
// HOW IT WORKS — fixed window counters
//   Each (actor + action) pair gets a bucket. The bucket's window_start
//   is NOW() floored to the window size, so a 60s window rolls over to a
//   fresh row every minute. We INSERT ... ON DUPLICATE KEY UPDATE to
//   increment, then compare against the limit. Old rows are garbage
//   collected probabilistically (see gc()).
//
//   Fixed windows allow a burst across a window boundary (up to 2x the
//   limit in the worst case). That is a deliberate trade: it costs one
//   indexed write per request and needs no Redis. It is the right shape
//   for abuse prevention, not for billing-grade accuracy.
//
// FAIL-OPEN, LOUDLY
//   If the `rate_limits` table is missing or the DB errors, requests are
//   ALLOWED and the failure goes to error_log. A forgotten migration
//   should not brick every endpoint in the app. Flip FAIL_OPEN to false
//   in production once the migration is confirmed run, and a broken
//   limiter will then reject rather than wave traffic through.
//
// PORTABILITY TO RDS / LOAD BALANCER
//   Counters live in MySQL, so they are shared across app servers the
//   moment you scale past one box — nothing to change. The ONE thing
//   that changes behind an ALB is the client IP: REMOTE_ADDR becomes the
//   load balancer's address and every anonymous visitor collapses into a
//   single bucket. That is isolated to clientIp() below — one function to
//   update, and it is already written with the switch commented in place.
// =====================================================================

class RateLimit
{
    /** Allow traffic through if the limiter itself breaks. See header. */
    const FAIL_OPEN = true;

    /**
     * Plus members get this multiplier on their allowance. Auth buckets
     * (login/register) are exempt — you cannot buy your way past a
     * brute-force guard, and the caller is anonymous at that point anyway.
     */
    const PLUS_MULTIPLIER = 2;

    /**
     * Every bucket in one place: 'action' => [limit, windowSeconds].
     * Tune here, not at the call sites.
     */
    const LIMITS = [
        // --- authentication: the only buckets keyed on failures --------
        'auth_login_fail'    => [5,   900],    // 5 bad logins / 15 min
        'auth_register'      => [5,   3600],   // 5 signups / hour / IP
        'company_login_fail' => [5,   900],
        'company_register'   => [3,   3600],

        // --- expensive compute ----------------------------------------
        'score_me'           => [20,  3600],   // scoring engine is the CPU hog
        'upload'             => [10,  3600],   // GD resize / resume writes
        'link_preview'       => [30,  60],     // makes an OUTBOUND fetch

        // --- heavy reads (LIKE '%q%' => full scans) -------------------
        'search'             => [60,  60],

        // --- ordinary writes ------------------------------------------
        'write'              => [30,  60],
        'follow'             => [30,  60],

        // --- social pressure: dual window, burst + daily total ---------
        'message_send'       => [20,  60],
        'message_send_day'   => [200, 86400],
        'message_start'      => [10,  60],     // conversation REQUESTS
        'message_start_day'  => [50,  86400],
        'apply'              => [20,  60],
        'apply_day'          => [50,  86400],
    ];

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------

    /**
     * Increment the caller's bucket and reject with 429 if over limit.
     * This is the one you want at the top of an endpoint.
     *
     * Response code is 'rate_limited' so the frontend can react to it
     * specifically, and a Retry-After header is set for well-behaved
     * clients (and for the future mobile app).
     *
     * @param string      $action Key from self::LIMITS
     * @param string|null $key    Override the actor key (rarely needed;
     *                            used by login to also bucket per-account)
     */
    public static function guard(string $action, ?string $key = null): void
    {
        [$limit, $window] = self::spec($action);
        $key = $key ?? self::actorKey();

        $hits = self::bump($action, $key, $window);
        if ($hits === null) {
            return; // limiter unavailable — bump() already decided fail-open/closed
        }

        if ($hits > $limit) {
            self::reject($action, $window);
        }
    }

    /**
     * Convenience: apply several buckets at once. Used where a burst
     * window and a daily total both apply.
     *
     *   RateLimit::guardAll(['message_send', 'message_send_day']);
     */
    public static function guardAll(array $actions, ?string $key = null): void
    {
        foreach ($actions as $action) {
            self::guard($action, $key);
        }
    }

    /**
     * Reject if the bucket is ALREADY at its limit, WITHOUT incrementing.
     *
     * This is the read half of the failure-counted pattern used by login:
     * we must not count a successful sign-in against the attacker budget,
     * so the counter only moves on a failed attempt (see penalise()).
     */
    public static function blockIfExhausted(string $action, ?string $key = null): void
    {
        [$limit, $window] = self::spec($action);
        $key = $key ?? self::actorKey();

        try {
            $pdo  = Database::conn();
            $stmt = $pdo->prepare(
                'SELECT hits FROM rate_limits
                 WHERE bucket_key = ? AND window_start = ? LIMIT 1'
            );
            $stmt->execute([self::bucketKey($action, $key), self::windowStart($window)]);
            $row = $stmt->fetch();
        } catch (Throwable $e) {
            self::handleFailure($e);
            return;
        }

        if ($row && (int) $row['hits'] >= $limit) {
            self::reject($action, $window);
        }
    }

    /**
     * Increment a failure counter. Call this AFTER a rejected credential
     * check — never on success.
     */
    public static function penalise(string $action, ?string $key = null): void
    {
        [, $window] = self::spec($action);
        self::bump($action, $key ?? self::actorKey(), $window);
    }

    /**
     * Wipe a bucket. Call on a SUCCESSFUL login so that a person who
     * fumbled their password three times and then got it right does not
     * stay one typo away from a lockout.
     */
    public static function forgive(string $action, ?string $key = null): void
    {
        [, $window] = self::spec($action);
        try {
            $pdo  = Database::conn();
            $stmt = $pdo->prepare(
                'DELETE FROM rate_limits
                 WHERE bucket_key = ? AND window_start = ?'
            );
            $stmt->execute([
                self::bucketKey($action, $key ?? self::actorKey()),
                self::windowStart($window),
            ]);
        } catch (Throwable $e) {
            self::handleFailure($e);
        }
    }

    /**
     * Stable identity for the current caller.
     *   user:<id>     — signed-in user
     *   company:<id>  — signed-in company
     *   ip:<sha256>   — anonymous; the IP is HASHED, never stored raw.
     *
     * Hashing the IP means the table holds no plaintext personal data,
     * which keeps this out of scope for most privacy obligations while
     * still being a perfectly good bucket key.
     */
    public static function actorKey(): string
    {
        $userId = Auth::userId();
        if ($userId !== null) {
            return 'user:' . $userId;
        }

        $companyId = Auth::companyId();
        if ($companyId !== null) {
            return 'company:' . $companyId;
        }

        return 'ip:' . hash('sha256', self::clientIp());
    }

    /**
     * Bucket key for an arbitrary string (e.g. the submitted email on a
     * login attempt), so credential stuffing across many IPs against ONE
     * account is still caught.
     */
    public static function subjectKey(string $label, string $value): string
    {
        return $label . ':' . hash('sha256', mb_strtolower(trim($value)));
    }

    /**
     * THE single place the client IP is resolved.
     *
     * On XAMPP / a single EC2 box, REMOTE_ADDR is the real client.
     * Behind an AWS ALB or CloudFront it is NOT — it is the balancer, and
     * every anonymous user would share one bucket. When you move, trust
     * the LAST hop of X-Forwarded-For (the one the ALB itself appended;
     * earlier entries are client-supplied and forgeable).
     */
    public static function clientIp(): string
    {
        // --- AFTER the AWS move, uncomment this block ------------------
        // if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        //     $hops = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        //     $ip   = trim(end($hops));
        //     if (filter_var($ip, FILTER_VALIDATE_IP)) {
        //         return $ip;
        //     }
        // }
        // ---------------------------------------------------------------

        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    /**
     * Look up [limit, window] for an action, applying the Plus multiplier
     * where it is allowed to apply.
     */
    private static function spec(string $action): array
    {
        if (!isset(self::LIMITS[$action])) {
            // A typo in an action name must not silently disable the guard.
            error_log('RateLimit: unknown action "' . $action . '" — falling back to write limits.');
            $action = 'write';
        }

        [$limit, $window] = self::LIMITS[$action];

        $isAuthBucket = str_starts_with($action, 'auth_')
                     || str_starts_with($action, 'company_');

        if (!$isAuthBucket && Auth::userId() !== null && Auth::isPlus()) {
            $limit *= self::PLUS_MULTIPLIER;
        }

        return [$limit, $window];
    }

    /**
     * Increment the bucket and return the new hit count.
     * Returns null when the limiter is unavailable and we are failing open.
     */
    private static function bump(string $action, string $key, int $window): ?int
    {
        $bucket = self::bucketKey($action, $key);
        $start  = self::windowStart($window);

        try {
            $pdo = Database::conn();

            $ins = $pdo->prepare(
                'INSERT INTO rate_limits (bucket_key, window_start, hits)
                 VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE hits = hits + 1'
            );
            $ins->execute([$bucket, $start]);

            $sel = $pdo->prepare(
                'SELECT hits FROM rate_limits
                 WHERE bucket_key = ? AND window_start = ? LIMIT 1'
            );
            $sel->execute([$bucket, $start]);
            $row = $sel->fetch();

            self::gc();

            return $row ? (int) $row['hits'] : 1;
        } catch (Throwable $e) {
            self::handleFailure($e);
            return null;
        }
    }

    private static function bucketKey(string $action, string $key): string
    {
        return mb_substr($key . '|' . $action, 0, 191);
    }

    /**
     * NOW() floored to the window size, as a DATETIME string.
     */
    private static function windowStart(int $window): string
    {
        $now = time();
        return date('Y-m-d H:i:s', $now - ($now % $window));
    }

    /**
     * Send the 429. Retry-After is the worst case (a full window), which
     * is honest — with fixed windows we cannot promise anything shorter.
     */
    private static function reject(string $action, int $window): void
    {
        $wait = self::humanWindow($window);
        header('Retry-After: ' . $window);

        $message = str_contains($action, 'login')
            ? "Too many sign-in attempts. Please wait {$wait} and try again."
            : "You're doing that too quickly. Please wait {$wait} and try again.";

        Response::error($message, 429, 'rate_limited');
    }

    private static function humanWindow(int $seconds): string
    {
        if ($seconds >= 86400) return 'a day';
        if ($seconds >= 3600)  return ($seconds / 3600) . ' hour' . ($seconds >= 7200 ? 's' : '');
        if ($seconds >= 60)    return ($seconds / 60) . ' minute' . ($seconds >= 120 ? 's' : '');
        return $seconds . ' seconds';
    }

    /**
     * Probabilistic garbage collection — roughly 1 request in 200 sweeps
     * rows older than the longest window. Keeps the table from growing
     * without needing a cron job, which matters on RDS storage.
     */
    private static function gc(): void
    {
        if (random_int(1, 200) !== 1) {
            return;
        }
        try {
            $longest = 0;
            foreach (self::LIMITS as [$_, $w]) {
                $longest = max($longest, $w);
            }
            $cutoff = date('Y-m-d H:i:s', time() - ($longest * 2));

            $pdo = Database::conn();
            $pdo->prepare('DELETE FROM rate_limits WHERE window_start < ?')
                ->execute([$cutoff]);
        } catch (Throwable $e) {
            error_log('RateLimit::gc failed: ' . $e->getMessage());
        }
    }

    /**
     * Limiter broke. Either wave the request through (and shout about it
     * in the log) or reject, depending on FAIL_OPEN.
     */
    private static function handleFailure(Throwable $e): void
    {
        error_log('RateLimit unavailable: ' . $e->getMessage());

        if (!self::FAIL_OPEN) {
            Response::error(
                'Service temporarily unavailable. Please try again shortly.',
                503,
                'rate_limiter_down'
            );
        }
    }
}

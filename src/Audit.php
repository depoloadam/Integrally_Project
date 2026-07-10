<?php

// =====================================================================
// FILE: src/Audit.php
// ---------------------------------------------------------------------
// Writes rows to admin_audit_log. Every mutating admin endpoint calls
// Audit::log() AFTER its change succeeds.
//
// Logging is deliberately NON-FATAL: if the insert fails (e.g. the
// migration hasn't been run yet), the admin action itself still
// completes and the failure goes to the PHP error log. An audit gap is
// better than an admin dashboard that breaks entirely.
// =====================================================================

class Audit
{
    /**
     * @param int         $adminId     users.id of the acting admin
     * @param string      $action      'set_role','set_plan','set_user_active',
     *                                 'set_company_active','delete_post','delete_job'
     * @param string      $targetType  'user' | 'company' | 'post' | 'job'
     * @param string|null $targetUuid  target's uuid when it has one
     * @param string      $targetLabel human-readable snapshot of the target
     * @param array|null  $detail      small JSON payload, e.g. ['from'=>'free','to'=>'plus']
     */
    public static function log(
        int $adminId,
        string $action,
        string $targetType,
        ?string $targetUuid,
        string $targetLabel,
        ?array $detail = null
    ): void {
        try {
            $pdo = Database::conn();

            // Snapshot the admin's username so the row stays readable
            // even if the account is later renamed or deleted.
            $u = $pdo->prepare('SELECT username FROM users WHERE id = ? LIMIT 1');
            $u->execute([$adminId]);
            $row = $u->fetch();
            $adminUsername = $row ? $row['username'] : ('#' . $adminId);

            $stmt = $pdo->prepare(
                'INSERT INTO admin_audit_log
                   (admin_id, admin_username, action, target_type,
                    target_uuid, target_label, detail)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([
                $adminId,
                $adminUsername,
                $action,
                $targetType,
                $targetUuid,
                mb_substr($targetLabel, 0, 200),
                $detail === null ? null : json_encode($detail),
            ]);
        } catch (Throwable $e) {
            error_log('Audit::log failed: ' . $e->getMessage());
        }
    }
}

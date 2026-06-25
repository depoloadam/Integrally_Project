<?php
// =====================================================================
// FILE: src/Auth.php
// ---------------------------------------------------------------------
// Security core: password hashing/verification, user sessions, company
// sessions, role-based permissions, and small helpers.
//
// Session identities are kept separate:
//   $_SESSION['user_id']     -> the logged-in USER
//   $_SESSION['company_id']  -> the logged-in COMPANY
// so a person can be signed in as a user and act as a company.
//
// Roles ('user'|'moderator'|'admin') are read LIVE from the DB on each
// check, so a demotion takes effect immediately rather than persisting
// in a stale session.
// =====================================================================

class Auth
{
    // ---- passwords ---------------------------------------------------

    public static function hashPassword(string $plain): string
    {
        return password_hash($plain, PASSWORD_BCRYPT);
    }

    public static function verifyPassword(string $plain, string $hash): bool
    {
        return password_verify($plain, $hash);
    }

    // ---- sessions ----------------------------------------------------

    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }

    // ---- USER session ------------------------------------------------

    public static function login(int $userId): void
    {
        self::startSession();
        session_regenerate_id(true);   // prevent session fixation
        $_SESSION['user_id'] = $userId;
    }

    public static function logout(): void
    {
        self::startSession();
        $_SESSION = [];
        session_destroy();
    }

    public static function userId(): ?int
    {
        self::startSession();
        return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
    }

    public static function requireLogin(): int
    {
        $id = self::userId();
        if ($id === null) {
            Response::error('Authentication required.', 401);
        }
        return $id;
    }

    // ---- COMPANY session ---------------------------------------------

    public static function loginCompany(int $companyId): void
    {
        self::startSession();
        session_regenerate_id(true);
        $_SESSION['company_id'] = $companyId;
    }

    public static function logoutCompany(): void
    {
        self::startSession();
        unset($_SESSION['company_id']);   // leaves any user session intact
    }

    public static function companyId(): ?int
    {
        self::startSession();
        return isset($_SESSION['company_id']) ? (int) $_SESSION['company_id'] : null;
    }

    public static function requireCompany(): int
    {
        $id = self::companyId();
        if ($id === null) {
            Response::error('Company authentication required.', 401);
        }
        return $id;
    }

    // ---- ROLES / PERMISSIONS -----------------------------------------
    // Read live from the DB so role changes apply immediately.

    public static function role(): ?string
    {
        $id = self::userId();
        if ($id === null) return null;

        $pdo  = Database::conn();
        $stmt = $pdo->prepare('SELECT role FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ? $row['role'] : null;
    }

    public static function isAdmin(): bool
    {
        return self::role() === 'admin';
    }

    public static function isStaff(): bool
    {
        $r = self::role();
        return $r === 'admin' || $r === 'moderator';
    }

    /**
     * Guard: stop the request with 403 unless the user is an admin.
     * Returns the admin's user id when allowed.
     */
    public static function requireAdmin(): int
    {
        $id = self::userId();
        if ($id === null) {
            Response::error('Authentication required.', 401);
        }
        if (!self::isAdmin()) {
            Response::error('Admin access required.', 403);
        }
        return $id;
    }

    // ---- helpers -----------------------------------------------------

    /**
     * Generate a v4-style UUID for users.uuid / companies.uuid.
     */
    public static function uuid(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40); // version 4
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80); // variant
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
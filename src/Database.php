<?php

// =====================================================================
// FILE: src/Database.php
// ---------------------------------------------------------------------
// A single, shared PDO connection for the whole app. Uses the
// singleton pattern so you don't open a new DB connection on every
// query — call Database::conn() anywhere to get the same PDO instance.
//
// PDO (not mysqli) is used deliberately: prepared statements are clean
// and safe against SQL injection, and PDO ports easily to RDS later.
// =====================================================================

class Database
{
    // Holds the one and only PDO instance once created.
    private static ?PDO $instance = null;

    // Prevent instantiation / cloning — this class is purely static.
    private function __construct() {}
    private function __clone() {}

    /**
     * Returns the shared PDO connection, creating it on first call.
     */
    public static function conn(): PDO
    {
        if (self::$instance === null) {
            self::$instance = self::create();
        }
        return self::$instance;
    }

    /**
     * Builds the PDO connection from config/config.php settings.
     */
    private static function create(): PDO
    {
        // Load the config array (the return [...] at the top of this file).
        $config = require __DIR__ . '/../config/config.php';
        $db     = $config['db'];

        // Data Source Name — tells PDO where and how to connect.
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            $db['host'],
            $db['port'],
            $db['name'],
            $db['charset']
        );

        // Connection options that make PDO behave sensibly:
        $options = [
            // Throw exceptions on error instead of failing silently.
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            // Return rows as clean associative arrays by default.
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Use REAL prepared statements, not emulated ones —
            // important for genuine injection protection.
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];

        try {
            return new PDO($dsn, $db['user'], $db['pass'], $options);
        } catch (PDOException $e) {
            // In local/debug, show the real reason. In production,
            // hide details and log instead.
            if ($config['app']['debug']) {
                die('Database connection failed: ' . $e->getMessage());
            }
            error_log('DB connection error: ' . $e->getMessage());
            http_response_code(500);
            die(json_encode([
                'success' => false,
                'data'    => null,
                'error'   => 'Internal server error.',
            ]));
        }
    }
}
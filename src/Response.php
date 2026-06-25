<?php

// =====================================================================
// FILE: src/Response.php
// ---------------------------------------------------------------------
// Every endpoint returns the SAME JSON envelope so clients (web + the
// future app) always know what to expect:
//   { "success": bool, "data": <any|null>, "error": <string|null> }
//
// Usage:
//   Response::success(['user' => $user]);
//   Response::error('Email already in use.', 409);
// =====================================================================

class Response
{
    /**
     * Send a success envelope and stop execution.
     */
    public static function success($data = null, int $httpCode = 200): void
    {
        self::send(true, $data, null, $httpCode);
    }

    /**
     * Send an error envelope and stop execution.
     */
    public static function error(string $message, int $httpCode = 400): void
    {
        self::send(false, null, $message, $httpCode);
    }

    /**
     * Internal: set headers, encode, and exit.
     */
    private static function send(bool $success, $data, ?string $error, int $httpCode): void
    {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code($httpCode);
        echo json_encode([
            'success' => $success,
            'data'    => $data,
            'error'   => $error,
        ]);
        exit;
    }

    /**
     * Helper: read and decode a JSON request body into an array.
     * Returns [] if the body is empty or invalid.
     */
    public static function input(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
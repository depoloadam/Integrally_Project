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

// Runtime safety net (env-aware error display + global exception handler).
// Required here because every endpoint already includes Response.php, so
// this protects all of them without touching each file.
require_once __DIR__ . '/bootstrap.php';

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
     * $code is an optional machine-readable identifier (e.g. 'entry_cap')
     * so the frontend can react to a SPECIFIC error without string-matching
     * the human message. Only included in the envelope when provided, so
     * existing consumers of {success,data,error} are unaffected.
     */
    public static function error(string $message, int $httpCode = 400, ?string $code = null): void
    {
        self::send(false, null, $message, $httpCode, $code);
    }

    /**
     * Internal: set headers, encode, and exit.
     */
    private static function send(bool $success, $data, ?string $error, int $httpCode, ?string $code = null): void
    {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code($httpCode);
        $body = [
            'success' => $success,
            'data'    => $data,
            'error'   => $error,
        ];
        if ($code !== null) {
            $body['code'] = $code;
        }
        echo json_encode($body);
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
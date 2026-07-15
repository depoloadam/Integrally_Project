<?php

// =====================================================================
// FILE: src/bootstrap.php
// ---------------------------------------------------------------------
// Runtime safety net for the API. Required once (indirectly, via
// Response.php) by every endpoint, so it protects all of them without
// per-file changes.
//
// It does two things:
//   1. Sets display_errors from config app.debug — ON locally, OFF in
//      production — so raw PHP errors + file paths never leak to clients.
//   2. Installs global exception / fatal-error handlers that return the
//      standard { success:false, data:null, error } JSON envelope with a
//      500, while the real detail goes to the PHP error log (server-side
//      only). Without this, an uncaught PDOException (e.g. a missing
//      column) dumps a stack trace straight to the client.
//
// Idempotent: safe to include more than once.
// =====================================================================

if (defined('INTEGRALLY_BOOTSTRAPPED')) {
    return;
}
define('INTEGRALLY_BOOTSTRAPPED', true);

// ---- Resolve debug flag from config (default to SAFE = off) ----------
$__debug = false;
$__cfgPath = __DIR__ . '/../config/config.php';
if (is_file($__cfgPath)) {
    $__cfg = require $__cfgPath;
    $__debug = (bool) ($__cfg['app']['debug'] ?? false);
}
define('INTEGRALLY_DEBUG', $__debug);

// Always log; never display to the client unless explicitly in debug.
error_reporting(E_ALL);
ini_set('log_errors', '1');
ini_set('display_errors', INTEGRALLY_DEBUG ? '1' : '0');

// ---- Clean JSON for any uncaught throwable ---------------------------
// We can't call Response here reliably (it may not be loaded yet at the
// moment a handler fires), so emit the same envelope shape directly.
function integrally_fail_json(string $logMsg): void
{
    error_log('[integrally] ' . $logMsg);

    // If headers already went out (mid-stream failure), we can't cleanly
    // set the status — just stop. Otherwise send a proper 500 envelope.
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        $err = INTEGRALLY_DEBUG ? $logMsg : 'Something went wrong. Please try again.';
        echo json_encode(['success' => false, 'data' => null, 'error' => $err]);
    }
}

set_exception_handler(function (\Throwable $e): void {
    integrally_fail_json(
        get_class($e) . ': ' . $e->getMessage()
        . ' @ ' . $e->getFile() . ':' . $e->getLine()
    );
    exit;
});

// Fatal errors (e.g. a missing require, a call to an undefined function)
// don't trigger the exception handler — catch them on shutdown.
register_shutdown_function(function (): void {
    $e = error_get_last();
    if ($e === null) {
        return;
    }
    $fatal = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if (in_array($e['type'], $fatal, true)) {
        integrally_fail_json(
            'Fatal: ' . $e['message'] . ' @ ' . ($e['file'] ?? '?') . ':' . ($e['line'] ?? '?')
        );
    }
});

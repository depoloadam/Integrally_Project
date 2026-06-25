<?php


// =====================================================================
// FILE: api/auth/logout.php
// ---------------------------------------------------------------------
// POST /api/auth/logout  — clears the session.
// =====================================================================

require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

Auth::logout();
Response::success(['message' => 'Logged out.']);

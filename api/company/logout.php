<?php


// =====================================================================
// FILE: api/company/logout.php
// POST  — clears ONLY the company session, not any user session.
// =====================================================================

require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

Auth::logoutCompany();
Response::success(['message' => 'Company logged out.']);

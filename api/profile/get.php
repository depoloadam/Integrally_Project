
<?php
// =====================================================================
// FILE: api/profile/get.php
// ---------------------------------------------------------------------
// GET /api/profile/get.php?uuid=<uuid>   -> view any user's PUBLIC profile
// GET /api/profile/get.php               -> view YOUR OWN full profile
//
// When viewing your own profile (no uuid, logged in), you get private
// fields too (email, private attributes). When viewing someone else's,
// you get only public-safe data.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Method not allowed.', 405);
}

$pdo        = Database::conn();
$viewerId   = Auth::userId();              // null if not logged in
$requestUuid = trim($_GET['uuid'] ?? '');

// Decide whose profile and whether it's the owner viewing.
if ($requestUuid === '') {
    // No uuid -> must be logged in, viewing own profile.
    if ($viewerId === null) {
        Response::error('Provide a uuid, or log in to view your own profile.', 400);
    }
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$viewerId]);
} else {
    $stmt = $pdo->prepare('SELECT * FROM users WHERE uuid = ? LIMIT 1');
    $stmt->execute([$requestUuid]);
}

$user = $stmt->fetch();
if (!$user) {
    Response::error('Profile not found.', 404);
}

$isOwner = ($viewerId !== null && (int) $user['id'] === $viewerId);

// --- Build the core profile payload ----------------------------------
$profile = [
    'uuid'        => $user['uuid'],
    'username'    => $user['username'],
    'city'        => $user['city'],
    'state'       => $user['state'],
    'country'     => $user['country'],
    'profile_pic' => $user['profile_pic'],
    'is_owner'    => $isOwner,
];

// Private fields only for the owner.
if ($isOwner) {
    $profile['email']         = $user['email'];
    $profile['is_verified']   = (int) $user['is_verified'];
    $profile['auth_provider'] = $user['auth_provider'];
}

// --- Flexible attributes ---------------------------------------------
// Join against attribute_definitions so we know which are public.
// Owner sees all; visitors see only is_public = 1.
$sql = '
    SELECT a.attr_key, a.attr_value,
           d.label, d.input_type, d.is_public
    FROM user_profile_attributes a
    LEFT JOIN attribute_definitions d ON d.attr_key = a.attr_key
    WHERE a.user_id = ?';
if (!$isOwner) {
    // Treat unknown (undefined) attributes as public by default,
    // unless a definition explicitly marks them private.
    $sql .= ' AND (d.is_public IS NULL OR d.is_public = 1)';
}
$stmt = $pdo->prepare($sql);
$stmt->execute([(int) $user['id']]);

$attributes = [];
foreach ($stmt->fetchAll() as $row) {
    $attributes[$row['attr_key']] = [
        'value'      => $row['attr_value'],
        'label'      => $row['label'],       // may be null if no definition
        'input_type' => $row['input_type'],
    ];
}
$profile['attributes'] = $attributes;

// --- AI Skillset (public when the user has enabled it) ----------------
// Stored in user_settings: 'ai_box_enabled' and 'ai_skills' (JSON array).
$aiStmt = $pdo->prepare(
    "SELECT setting_key, setting_value FROM user_settings
     WHERE user_id = ? AND setting_key IN ('ai_box_enabled', 'ai_skills')"
);
$aiStmt->execute([(int) $user['id']]);
$aiEnabled = false;
$aiSkills  = [];
foreach ($aiStmt->fetchAll() as $row) {
    if ($row['setting_key'] === 'ai_box_enabled') {
        $aiEnabled = ($row['setting_value'] === '1');
    } elseif ($row['setting_key'] === 'ai_skills') {
        $decoded = json_decode((string) $row['setting_value'], true);
        if (is_array($decoded)) $aiSkills = array_values(array_filter($decoded, 'is_string'));
    }
}
// Owner always gets the raw state; visitors only when enabled.
if ($isOwner || $aiEnabled) {
    $profile['ai_skillset'] = [
        'enabled' => $aiEnabled,
        'skills'  => $aiSkills,
    ];
}

// --- Resume metadata (OWNER ONLY — resumes are fully private) ---------
if ($isOwner) {
    $rStmt = $pdo->prepare(
        "SELECT setting_key, setting_value FROM user_settings
         WHERE user_id = ? AND setting_key IN ('resume_file', 'resume_name', 'resume_uploaded_at')"
    );
    $rStmt->execute([(int) $user['id']]);
    $rMeta = [];
    foreach ($rStmt->fetchAll() as $row) {
        $rMeta[$row['setting_key']] = $row['setting_value'];
    }
    $profile['resume'] = !empty($rMeta['resume_file'])
        ? ['name' => $rMeta['resume_name'] ?? 'resume', 'uploaded_at' => $rMeta['resume_uploaded_at'] ?? null]
        : null;
}

Response::success($profile);

<?php
// =====================================================================
// FILE: config/config.php
// ---------------------------------------------------------------------
// All environment-specific settings live here in ONE place so moving
// from local XAMPP -> AWS is a config change, not a code change.
//
// Later on AWS: replace these literals with getenv() calls that read
// from environment variables / AWS Secrets Manager, e.g.
//   'host' => getenv('DB_HOST') ?: '127.0.0.1'
// =====================================================================

return [

    // -- Database (XAMPP defaults: user 'root', empty password) --------
    'db' => [
        'host'    => '127.0.0.1',
        'port'    => '3306',
        'name'    => 'integrally',
        'user'    => 'root',
        'pass'    => '',              // XAMPP default is empty
        'charset' => 'utf8mb4',
    ],

    // -- File storage (local now; swap to S3 paths/URLs on AWS) --------
    'storage' => [
        'uploads_path' => __DIR__ . '/../public/uploads',
        'uploads_url' => '/integrally/public/uploads',
    ],

    // -- App settings --------------------------------------------------
    'app' => [
        'name'  => 'integrally',
        'env'   => 'local',           // 'local' | 'production'
        'debug' => true,              // set false in production
    ],
];

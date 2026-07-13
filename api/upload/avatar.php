<?php

// =====================================================================
// FILE: api/upload/avatar.php
// POST (multipart/form-data) field "image" -> stores a normalized,
// center-cropped square avatar and returns its public URL.
//
// Why a separate endpoint from upload/image.php:
//   - Post images should keep their original dimensions.
//   - Avatars look best (and stay crisp on Retina) when normalized to a
//     consistent square. We render at up to 96px CSS, so a 256px stored
//     square is sharp on 2x displays and still small on disk.
//
// Same security posture as upload/image.php: auth required, content
// verified by getimagesize (not extension/MIME), size cap, random name.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('upload');

/**
 * Find the bounding box of the non-background content in a GD image.
 * Background is inferred from the four corners; a pixel counts as
 * background if it's fully transparent, or close to the corner color.
 * Returns [x, y, w, h] or null if no clear uniform border was found.
 */
function lp_compute_trim($img, int $w, int $h): ?array
{
    // Sample the four corners.
    $corners = [
        imagecolorat($img, 0, 0),
        imagecolorat($img, $w - 1, 0),
        imagecolorat($img, 0, $h - 1),
        imagecolorat($img, $w - 1, $h - 1),
    ];
    $rgba = function ($c) use ($img) {
        return [
            ($c >> 16) & 0xFF,
            ($c >> 8) & 0xFF,
            $c & 0xFF,
            ($c >> 24) & 0x7F, // alpha 0..127 (127 = transparent)
        ];
    };
    $cs = array_map($rgba, $corners);

    // Are all corners "transparent enough"? Then bg is transparency.
    $allTransparent = true;
    foreach ($cs as $c) { if ($c[3] < 100) { $allTransparent = false; break; } }

    // Otherwise require the corners to roughly match each other (uniform
    // solid border like white). If they disagree, don't trim.
    $bg = $cs[0];
    if (!$allTransparent) {
        foreach ($cs as $c) {
            if (abs($c[0] - $bg[0]) > 12 || abs($c[1] - $bg[1]) > 12 || abs($c[2] - $bg[2]) > 12) {
                return null; // corners differ -> likely a real photo, skip
            }
        }
    }

    $isBg = function (int $x, int $y) use ($img, $allTransparent, $bg) {
        $c = imagecolorat($img, $x, $y);
        $a = ($c >> 24) & 0x7F;
        // Treat mostly-transparent pixels (incl. anti-aliased edges) as bg.
        if ($allTransparent) return $a >= 40;
        if ($a >= 40) return true;                         // transparent counts as bg too
        $r = ($c >> 16) & 0xFF; $g = ($c >> 8) & 0xFF; $b = $c & 0xFF;
        return (abs($r - $bg[0]) <= 18 && abs($g - $bg[1]) <= 18 && abs($b - $bg[2]) <= 18);
    };

    // Scan inward from each edge to find content bounds.
    $top = 0;    while ($top < $h - 1)    { $row = true; for ($x = 0; $x < $w; $x += 2) { if (!$isBg($x, $top)) { $row = false; break; } } if (!$row) break; $top++; }
    $bottom = $h - 1; while ($bottom > $top) { $row = true; for ($x = 0; $x < $w; $x += 2) { if (!$isBg($x, $bottom)) { $row = false; break; } } if (!$row) break; $bottom--; }
    $left = 0;   while ($left < $w - 1)   { $col = true; for ($y = $top; $y <= $bottom; $y += 2) { if (!$isBg($left, $y)) { $col = false; break; } } if (!$col) break; $left++; }
    $right = $w - 1; while ($right > $left)  { $col = true; for ($y = $top; $y <= $bottom; $y += 2) { if (!$isBg($right, $y)) { $col = false; break; } } if (!$col) break; $right--; }

    if ($right <= $left || $bottom <= $top) return null;

    // Add a small breathing margin (4% of the content size) so the logo
    // isn't crammed edge-to-edge.
    $cw = $right - $left + 1;
    $ch = $bottom - $top + 1;
    $mx = (int) round($cw * 0.04);
    $my = (int) round($ch * 0.04);
    $x = max(0, $left - $mx);
    $y = max(0, $top - $my);
    $x2 = min($w - 1, $right + $mx);
    $y2 = min($h - 1, $bottom + $my);

    return [$x, $y, $x2 - $x + 1, $y2 - $y + 1];
}

if (Auth::userId() === null && Auth::companyId() === null) {
    Response::error('You must be logged in to upload.', 401);
}

if (!isset($_FILES['image'])) {
    Response::error('No file received. Send a multipart form with field "image".', 422);
}
$file = $_FILES['image'];
if ($file['error'] !== UPLOAD_ERR_OK) {
    Response::error('Upload failed. Please retry.', 400);
}

$MAX_BYTES = 8 * 1024 * 1024;   // allow a larger source; we shrink it anyway
if ($file['size'] > $MAX_BYTES) Response::error('Image must be 8 MB or smaller.', 422);
if ($file['size'] === 0)        Response::error('The uploaded file is empty.', 422);

// Verify real image content.
$info = @getimagesize($file['tmp_name']);
if ($info === false) Response::error('That file is not a valid image.', 422);

// This endpoint needs the GD image library to resize. It ships with
// XAMPP and is enabled by default, but check so the failure is clear.
if (!function_exists('imagecreatetruecolor')) {
    Response::error('Image processing (GD) is not enabled on the server.', 500);
}

$type = $info[2];
switch ($type) {
    case IMAGETYPE_JPEG: $src = @imagecreatefromjpeg($file['tmp_name']); break;
    case IMAGETYPE_PNG:  $src = @imagecreatefrompng($file['tmp_name']);  break;
    case IMAGETYPE_GIF:  $src = @imagecreatefromgif($file['tmp_name']);  break;
    case IMAGETYPE_WEBP: $src = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($file['tmp_name']) : false; break;
    default:
        Response::error('Only JPG, PNG, GIF, or WEBP images are allowed.', 422);
}
if (!$src) Response::error('Could not read that image.', 422);

$srcW = imagesx($src);
$srcH = imagesy($src);

// --- auto-trim a uniform border (common on logos with built-in padding) ---
// Detect the background from the corners. If all four agree (within a
// tolerance, or all fully transparent), scan inward to the content's
// bounding box and crop the padding away so the logo fills the frame.
// Conservative: bails out unless corners clearly match, so photos that
// reach the edges are left untouched.

$trim = lp_compute_trim($src, $srcW, $srcH);
if ($trim !== null) {
    [$tx, $ty, $tw, $th] = $trim;
    // Only apply if it meaningfully reduces the image (>3% on a side) and
    // leaves a sane region.
    if ($tw > 8 && $th > 8 && ($tw < $srcW - 2 || $th < $srcH - 2)) {
        $cropped = imagecreatetruecolor($tw, $th);
        imagealphablending($cropped, false);
        imagesavealpha($cropped, true);
        $tp = imagecolorallocatealpha($cropped, 0, 0, 0, 127);
        imagefilledrectangle($cropped, 0, 0, $tw, $th, $tp);
        imagecopy($cropped, $src, 0, 0, $tx, $ty, $tw, $th);
        imagedestroy($src);
        $src  = $cropped;
        $srcW = $tw;
        $srcH = $th;
    }
}

// Center-crop to a square, then scale to the target size.
$side   = min($srcW, $srcH);
$srcX   = (int) (($srcW - $side) / 2);
$srcY   = (int) (($srcH - $side) / 2);
$TARGET = 256;

$dst = imagecreatetruecolor($TARGET, $TARGET);
// Preserve transparency for PNG/GIF/WEBP.
imagealphablending($dst, false);
imagesavealpha($dst, true);
$transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
imagefilledrectangle($dst, 0, 0, $TARGET, $TARGET, $transparent);

imagecopyresampled($dst, $src, 0, 0, $srcX, $srcY, $TARGET, $TARGET, $side, $side);
imagedestroy($src);

// Resolve storage from config.
$config      = require __DIR__ . '/../../config/config.php';
$uploadsPath = $config['storage']['uploads_path'];
$uploadsUrl  = $config['storage']['uploads_url'];
if (!is_dir($uploadsPath) && !@mkdir($uploadsPath, 0775, true) && !is_dir($uploadsPath)) {
    Response::error('Server upload folder is not available.', 500);
}

try {
    $random = bin2hex(random_bytes(16));
} catch (Exception $e) {
    Response::error('Could not generate a filename. Try again.', 500);
}

// Store PNG to keep transparency and avoid recompression artifacts at
// this small size. (PNG of a 256px square is tiny.)
$filename = $random . '.png';
$destPath = rtrim($uploadsPath, '/\\') . DIRECTORY_SEPARATOR . $filename;

if (!imagepng($dst, $destPath, 6)) {
    imagedestroy($dst);
    Response::error('Could not save the avatar.', 500);
}
imagedestroy($dst);

$publicUrl = rtrim($uploadsUrl, '/') . '/' . $filename;

Response::success([
    'url'    => $publicUrl,
    'width'  => $TARGET,
    'height' => $TARGET,
], 201);
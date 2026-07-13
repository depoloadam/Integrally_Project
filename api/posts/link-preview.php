<?php

// =====================================================================
// FILE: api/posts/link-preview.php
// POST { url* }  ->  { url, title, description, image, site }
// Fetches a user-supplied URL server-side and extracts Open Graph /
// meta-tag preview data (headline, description, image).
//
// SECURITY (SSRF): fetching arbitrary user URLs from the server is
// dangerous. We defend with:
//   - scheme allowlist (http/https only)
//   - DNS resolution + block private/loopback/link-local/reserved IPs
//   - manual redirect following (each hop re-validated)
//   - response size + time caps
// Login is required so this isn't an open proxy for anonymous abusers.
// =====================================================================

require_once __DIR__ . '/../../src/Database.php';
require_once __DIR__ . '/../../src/Response.php';
require_once __DIR__ . '/../../src/Auth.php';
require_once __DIR__ . '/../../src/RateLimit.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Method not allowed.', 405);
}

// Throttle: see src/RateLimit.php. Rejects with 429 + code 'rate_limited'.
RateLimit::guard('link_preview');

// Must be logged in as a user OR a company.
if (Auth::userId() === null && Auth::companyId() === null) {
    Response::error('Authentication required.', 401);
}

$in  = Response::input();
$url = trim($in['url'] ?? '');
if ($url === '') Response::error('A url is required.', 422);

// ---- limits ----------------------------------------------------------
const LP_MAX_REDIRECTS = 4;
const LP_MAX_BYTES     = 1048576;   // 1 MB of HTML is plenty for <head>
const LP_TIMEOUT       = 6;         // seconds, total

/**
 * Reject URLs that resolve to private, loopback, link-local, or
 * otherwise non-public addresses. Returns true if SAFE to fetch.
 */
function lp_host_is_public(string $host): bool
{
    // Resolve both A and AAAA records; every resolved IP must be public.
    $ips = [];
    $a = @dns_get_record($host, DNS_A);
    if ($a) foreach ($a as $r) if (!empty($r['ip']))   $ips[] = $r['ip'];
    $aaaa = @dns_get_record($host, DNS_AAAA);
    if ($aaaa) foreach ($aaaa as $r) if (!empty($r['ipv6'])) $ips[] = $r['ipv6'];

    // If DNS returned nothing, try a direct gethostbyname as a fallback.
    if (!$ips) {
        $resolved = gethostbyname($host);
        if ($resolved && $resolved !== $host) $ips[] = $resolved;
    }
    if (!$ips) return false;   // can't resolve -> don't fetch

    foreach ($ips as $ip) {
        if (!filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        )) {
            return false;      // private/reserved/loopback -> unsafe
        }
    }
    return true;
}

/**
 * Validate a single URL's scheme + host safety. Returns the parsed
 * host on success, or null if the URL must be rejected.
 */
function lp_validate(string $url): ?array
{
    $parts = parse_url($url);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) return null;

    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') return null;

    if (!lp_host_is_public($parts['host'])) return null;

    return $parts;
}

/**
 * Fetch a URL with manual redirect handling, re-validating each hop.
 * Returns [finalUrl, html] or null on failure.
 */
function lp_fetch(string $url): ?array
{
    $current = $url;

    for ($hop = 0; $hop <= LP_MAX_REDIRECTS; $hop++) {
        if (lp_validate($current) === null) return null;

        $ch = curl_init($current);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,            // we follow manually
            CURLOPT_TIMEOUT        => LP_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => LP_TIMEOUT,
            CURLOPT_MAXFILESIZE    => LP_MAX_BYTES,
            CURLOPT_USERAGENT      => 'IntegrallyLinkPreview/1.0 (+https://integrally)',
            CURLOPT_HTTPHEADER     => ['Accept: text/html,application/xhtml+xml'],
            // Hard cap the body size even if the server lies about length.
            CURLOPT_BUFFERSIZE     => 16384,
            CURLOPT_NOPROGRESS     => false,
            CURLOPT_PROGRESSFUNCTION => function ($ch, $dlTotal, $dlNow) {
                return ($dlNow > LP_MAX_BYTES) ? 1 : 0;  // non-zero aborts
            },
        ]);

        $body   = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $redir  = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        curl_close($ch);

        if ($body === false && $status === 0) return null;

        // Follow 3xx redirects manually (re-validated next loop).
        if ($status >= 300 && $status < 400 && $redir !== '') {
            // Resolve relative redirect targets against the current URL.
            $current = lp_absolute_url($current, $redir);
            if ($current === null) return null;
            continue;
        }

        if ($status >= 200 && $status < 300 && is_string($body)) {
            return [$current, substr($body, 0, LP_MAX_BYTES)];
        }
        return null;
    }
    return null;   // too many redirects
}

/** Resolve a possibly-relative URL against a base. */
function lp_absolute_url(string $base, string $rel): ?string
{
    if (preg_match('#^https?://#i', $rel)) return $rel;
    $b = parse_url($base);
    if (!$b || empty($b['scheme']) || empty($b['host'])) return null;
    $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
    if (str_starts_with($rel, '/')) return $origin . $rel;
    $path = isset($b['path']) ? preg_replace('#/[^/]*$#', '/', $b['path']) : '/';
    return $origin . $path . $rel;
}

/** Pull a <meta> property/name="key" content="..." value from HTML. */
function lp_meta(string $html, string $key): ?string
{
    // property="og:title" or name="description", content in either order.
    $patterns = [
        '#<meta[^>]+(?:property|name)\s*=\s*["\']' . preg_quote($key, '#') . '["\'][^>]*content\s*=\s*["\']([^"\']*)["\']#i',
        '#<meta[^>]+content\s*=\s*["\']([^"\']*)["\'][^>]*(?:property|name)\s*=\s*["\']' . preg_quote($key, '#') . '["\']#i',
    ];
    foreach ($patterns as $re) {
        if (preg_match($re, $html, $m)) {
            $val = html_entity_decode(trim($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if ($val !== '') return $val;
        }
    }
    return null;
}

// ---- main ------------------------------------------------------------
$fetched = lp_fetch($url);
if ($fetched === null) {
    Response::error('Could not fetch a preview for that link.', 422);
}
[$finalUrl, $html] = $fetched;

// Title: prefer og:title, then twitter:title, then <title>.
$title = lp_meta($html, 'og:title')
      ?? lp_meta($html, 'twitter:title');
if ($title === null && preg_match('#<title[^>]*>(.*?)</title>#is', $html, $m)) {
    $title = html_entity_decode(trim($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

$description = lp_meta($html, 'og:description')
            ?? lp_meta($html, 'twitter:description')
            ?? lp_meta($html, 'description');

$image = lp_meta($html, 'og:image')
      ?? lp_meta($html, 'twitter:image')
      ?? lp_meta($html, 'og:image:url');

// Resolve a relative image URL and ensure it points somewhere public.
if ($image !== null) {
    $absImg = lp_absolute_url($finalUrl, $image);
    $image  = ($absImg !== null && lp_validate($absImg) !== null) ? $absImg : null;
}

$siteName = lp_meta($html, 'og:site_name') ?? (parse_url($finalUrl)['host'] ?? null);

// Nothing useful found at all.
if ($title === null && $description === null && $image === null) {
    Response::error('No preview information found at that link.', 422);
}

// Trim to sane display lengths.
$clip = fn(?string $s, int $n) => ($s === null) ? null : mb_substr($s, 0, $n);

Response::success([
    'url'         => $finalUrl,
    'title'       => $clip($title, 200),
    'description' => $clip($description, 400),
    'image'       => $image,
    'site'        => $clip($siteName, 100),
]);
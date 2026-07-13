<?php

// =====================================================================
// FILE: src/ImageProcessor.php
// ---------------------------------------------------------------------
// Takes a verified upload and produces a WEB-SIZED image on disk.
//
// WHY THIS EXISTS
//   api/upload/image.php used to move the uploaded file straight into
//   place. A 6000x4000 photo off a phone (4.9 MB, under the size cap)
//   was therefore STORED at 6000x4000 and SERVED at 6000x4000 to every
//   viewer of the feed. The browser scaled it down to ~600px for
//   display, so it looked fine and cost the visitor a 4.9 MB download
//   for 600px of pixels. On mobile data, on a feed of ten such posts,
//   that is 50 MB to render one screen.
//
//   avatar.php already did the right thing (decode -> resize -> re-encode).
//   This pulls that approach into one place so both endpoints share it
//   and the next uploader doesn't have to reinvent it.
//
// WHAT IT DOES
//   1. Rejects decompression bombs BEFORE decoding (see MAX_PIXELS).
//   2. Refuses to decode anything that won't fit in memory.
//   3. Applies EXIF orientation, so phone photos aren't sideways.
//   4. Downscales so the longest edge is at most $maxEdge.
//   5. Re-encodes with sane compression.
//   6. Drops EXIF as a side effect of re-encoding — which also strips
//      GPS coordinates. People post photos without realising their phone
//      wrote their home address into the file.
//
// ANIMATED GIFs are passed through untouched: GD only reads the first
// frame, so re-encoding one would silently destroy the animation. They
// still face the pixel and byte caps.
//
// AWS NOTE: this writes to a local path. When you move to S3, the call
// site changes (put the bytes rather than write the file); this class
// stays as-is because it deals in a temp file in, a temp file out.
// =====================================================================

class ImageProcessor
{
    /**
     * Absolute ceiling on total pixels, checked BEFORE we decode.
     *
     * A "decompression bomb" is a small file that expands enormously: a
     * 20000x20000 PNG of flat colour compresses to a few hundred KB and
     * sails past any byte-size cap, but decoding it asks GD for ~1.6 GB
     * of RAM and takes the whole PHP process down. 50 MP is far above any
     * real camera you'd post from (a 50 MP phone shot is ~8000x6000).
     */
    const MAX_PIXELS = 50000000;   // 50 megapixels

    /** GD needs roughly 4 bytes per pixel, plus headroom for the copy. */
    const BYTES_PER_PIXEL = 4;

    /**
     * Process an uploaded image into $destPath, downscaling so neither
     * edge exceeds $maxEdge.
     *
     * @param string $srcPath   Verified temp file (already through getimagesize)
     * @param array  $info      The getimagesize() result for $srcPath
     * @param string $destPath  Where to write
     * @param int    $maxEdge   Longest edge of the output, in pixels
     * @param int    $quality   JPEG/WEBP quality, 0-100
     *
     * @return array{width:int,height:int,resized:bool}
     * @throws RuntimeException with a message safe to show the user
     */
    public static function process(
        string $srcPath,
        array  $info,
        string $destPath,
        int    $maxEdge = 1600,
        int    $quality = 82
    ): array {
        [$w, $h] = [(int) $info[0], (int) $info[1]];
        $type = (int) $info[2];

        if ($w < 1 || $h < 1) {
            throw new RuntimeException('That image has no dimensions.');
        }

        // --- 1. bomb check, BEFORE any decode ------------------------
        if ($w * $h > self::MAX_PIXELS) {
            throw new RuntimeException(sprintf(
                'That image is too large to process (%s x %s). Please resize it below %d megapixels.',
                number_format($w), number_format($h), (int) (self::MAX_PIXELS / 1000000)
            ));
        }

        // --- 2. will it fit in memory? -------------------------------
        if (!self::fitsInMemory($w, $h)) {
            throw new RuntimeException('That image is too large for the server to process. Please upload a smaller version.');
        }

        // --- 3. animated GIF: copy through, never re-encode -----------
        if ($type === IMAGETYPE_GIF && self::isAnimatedGif($srcPath)) {
            if (!@copy($srcPath, $destPath)) {
                throw new RuntimeException('Could not save the uploaded file.');
            }
            return ['width' => $w, 'height' => $h, 'resized' => false];
        }

        if (!function_exists('imagecreatetruecolor')) {
            throw new RuntimeException('Image processing (GD) is not enabled on the server.');
        }

        // --- 4. decode -----------------------------------------------
        $src = self::decode($srcPath, $type);
        if (!$src) {
            throw new RuntimeException('That image could not be read.');
        }

        try {
            // --- 5. EXIF orientation ---------------------------------
            // Phones store the photo in sensor orientation and set a flag
            // saying "rotate me". Browsers honour the flag; GD does not.
            // Re-encoding drops the flag, so without this a portrait photo
            // would come out sideways once processed.
            if ($type === IMAGETYPE_JPEG) {
                $src = self::applyExifOrientation($src, $srcPath);
                $w = imagesx($src);
                $h = imagesy($src);
            }

            // --- 6. downscale ---------------------------------------
            $scale = min(1.0, $maxEdge / max($w, $h));
            $resized = $scale < 1.0;

            if ($resized) {
                $nw = max(1, (int) round($w * $scale));
                $nh = max(1, (int) round($h * $scale));

                $dst = imagecreatetruecolor($nw, $nh);
                self::preserveTransparency($dst, $type);
                imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
                imagedestroy($src);
                $src = $dst;
                $w = $nw;
                $h = $nh;
            }

            // --- 7. re-encode ---------------------------------------
            $encoded = self::encode($src, $destPath, $type, $quality);
            if (!$encoded) {
                throw new RuntimeException('Could not save the processed image.');
            }

            return ['width' => $w, 'height' => $h, 'resized' => $resized];
        } finally {
            if ($src instanceof GdImage) {
                imagedestroy($src);
            }
        }
    }

    /**
     * Map a verified IMAGETYPE_* to its file extension. Anything not
     * listed is rejected by the caller — notably SVG, which is XML and
     * can carry script.
     */
    public static function extensionFor(int $type): ?string
    {
        return [
            IMAGETYPE_JPEG => 'jpg',
            IMAGETYPE_PNG  => 'png',
            IMAGETYPE_GIF  => 'gif',
            IMAGETYPE_WEBP => 'webp',
        ][$type] ?? null;
    }

    // -----------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------

    /**
     * Would decoding a $w x $h image blow the memory_limit?
     *
     * We need the source bitmap AND the resized copy alive at once, so
     * budget for both plus 30% of slack for GD's own overhead.
     */
    private static function fitsInMemory(int $w, int $h): bool
    {
        $limit = self::memoryLimitBytes();
        if ($limit <= 0) {
            return true;   // unlimited (-1) — nothing to check against
        }

        $need = (int) ($w * $h * self::BYTES_PER_PIXEL * 2 * 1.3);
        $free = $limit - memory_get_usage(true);

        return $need < $free;
    }

    private static function memoryLimitBytes(): int
    {
        $raw = trim((string) ini_get('memory_limit'));
        if ($raw === '' || $raw === '-1') {
            return -1;
        }

        $unit  = strtolower(substr($raw, -1));
        $value = (int) $raw;

        return match ($unit) {
            'g' => $value * 1024 * 1024 * 1024,
            'm' => $value * 1024 * 1024,
            'k' => $value * 1024,
            default => $value,
        };
    }

    /**
     * Does this GIF have more than one frame?
     *
     * Scans for Graphic Control Extension blocks (0x21 0xF9), which
     * precede each frame. Two or more means animated. Reading the bytes
     * directly is the only way — GD would just hand back frame one and
     * tell us nothing.
     */
    private static function isAnimatedGif(string $path): bool
    {
        $fh = @fopen($path, 'rb');
        if (!$fh) {
            return false;
        }

        $frames = 0;
        $prev   = '';

        while (!feof($fh) && $frames < 2) {
            $chunk = fread($fh, 8192);
            if ($chunk === false) {
                break;
            }
            // Carry the last byte over so a marker split across the chunk
            // boundary isn't missed.
            $frames += preg_match_all('/\x00\x21\xF9\x04/s', $prev . $chunk);
            $prev = substr($chunk, -1);
        }

        fclose($fh);
        return $frames > 1;
    }

    private static function decode(string $path, int $type): GdImage|false
    {
        return match ($type) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($path),
            IMAGETYPE_PNG  => @imagecreatefrompng($path),
            IMAGETYPE_GIF  => @imagecreatefromgif($path),
            IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : false,
            default        => false,
        };
    }

    private static function encode(GdImage $img, string $path, int $type, int $quality): bool
    {
        return match ($type) {
            IMAGETYPE_JPEG => @imagejpeg($img, $path, $quality),
            // PNG takes a 0-9 COMPRESSION level, not a quality — and it is
            // lossless, so 6 is a good size/CPU trade with no visible cost.
            IMAGETYPE_PNG  => @imagepng($img, $path, 6),
            IMAGETYPE_GIF  => @imagegif($img, $path),
            IMAGETYPE_WEBP => function_exists('imagewebp') ? @imagewebp($img, $path, $quality) : false,
            default        => false,
        };
    }

    /**
     * PNG/GIF/WEBP can have transparent pixels. A fresh truecolor canvas
     * is opaque black, so without this a transparent logo would be
     * resized onto a black rectangle.
     */
    private static function preserveTransparency(GdImage $dst, int $type): void
    {
        if ($type === IMAGETYPE_JPEG) {
            return;   // JPEG has no alpha channel
        }

        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefilledrectangle($dst, 0, 0, imagesx($dst) - 1, imagesy($dst) - 1, $transparent);
    }

    /**
     * Rotate/flip per the JPEG's EXIF Orientation tag, then forget it.
     */
    private static function applyExifOrientation(GdImage $img, string $path): GdImage
    {
        if (!function_exists('exif_read_data')) {
            return $img;
        }

        $exif = @exif_read_data($path);
        $o = (int) ($exif['Orientation'] ?? 0);
        if ($o < 2 || $o > 8) {
            return $img;   // 0/1 = already upright; anything else is invalid
        }

        // The 8 EXIF orientations are combinations of rotation and mirroring.
        $rotate = match ($o) {
            3, 4 => 180,
            5, 6 => -90,
            7, 8 => 90,
            default => 0,
        };
        $flip = in_array($o, [2, 4, 5, 7], true);

        if ($rotate !== 0) {
            $rotated = @imagerotate($img, $rotate, 0);
            if ($rotated) {
                imagedestroy($img);
                $img = $rotated;
            }
        }
        if ($flip) {
            imageflip($img, IMG_FLIP_HORIZONTAL);
        }

        return $img;
    }
}

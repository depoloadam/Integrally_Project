<?php

// =====================================================================
// FILE: src/RichText.php
// A small, strict HTML sanitizer for user-authored rich text (posts and
// job descriptions). Rich text is dangerous: rendering user HTML without
// sanitizing is a stored-XSS hole. This allows ONLY a tiny whitelist of
// formatting and strips everything else.
//
// Allowed:
//   <b> <strong> <i> <em> <u>            (bold / italic / underline)
//   <br>                                 (line breaks)
//   <span style="color:...; font-size:..."> with ONLY color + font-size,
//                                          and only safe values.
//
// Everything else — scripts, event handlers, links, images, arbitrary
// tags/attributes, javascript: urls — is removed. We parse with DOMDocument
// rather than regex (regex HTML sanitizers are notoriously bypassable).
// =====================================================================

class RichText
{
    /** Tags allowed in output. Keys are lowercase tag names. */
    private const ALLOWED_TAGS = [
        'b' => true, 'strong' => true,
        'i' => true, 'em' => true,
        'u' => true,
        'br' => true,
        'span' => true,   // only for color / font-size styles
        'font' => true,   // legacy execCommand output; converted to span
        'div' => true,    // contentEditable emits divs for lines; we keep as breaks
        'p'  => true,
    ];

    // Allowed font sizes (px). We clamp to a small set so users can't set
    // absurd sizes that break layout.
    private const ALLOWED_SIZES = [12, 14, 16, 18, 24, 32];

    /**
     * Sanitize a rich-text HTML string. Returns safe HTML (a subset of the
     * input) or '' if empty. Length is capped by the caller.
     */
    public static function clean(string $html): string
    {
        $html = trim($html);
        if ($html === '') return '';

        // Normalise: strip NULs and control chars that can confuse parsers,
        // and zero-width spaces (used by the editor as caret anchors).
        $html = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $html);
        $html = str_replace("\xE2\x80\x8B", '', $html);   // U+200B

        // Wrap so DOMDocument has a single root and a known encoding.
        $wrapped = '<?xml encoding="UTF-8"><div id="__root__">' . $html . '</div>';

        $dom = new DOMDocument();
        libxml_use_internal_errors(true);   // ignore malformed-HTML warnings
        $dom->loadHTML($wrapped, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();

        // Find our wrapper div reliably (getElementById needs declared ID
        // types, which we can't guarantee from loadHTML).
        $root = null;
        foreach ($dom->getElementsByTagName('div') as $d) {
            if ($d->getAttribute('id') === '__root__') { $root = $d; break; }
        }
        if (!$root) return '';

        $out = '';
        foreach (iterator_to_array($root->childNodes) as $child) {
            $out .= self::renderNode($child);
        }

        // Collapse excessive break runs, strip a leading break (the first
        // block shouldn't begin with a blank line), and trim.
        $out = preg_replace('#(<br>\s*){3,}#', '<br><br>', $out);
        $out = preg_replace('#^(\s*<br>\s*)+#', '', $out);
        return trim($out);
    }

    /** Recursively render an allowed node to safe HTML. */
    private static function renderNode(DOMNode $node): string
    {
        // Text node: escape it.
        if ($node->nodeType === XML_TEXT_NODE) {
            return htmlspecialchars($node->nodeValue, ENT_QUOTES, 'UTF-8');
        }
        if ($node->nodeType !== XML_ELEMENT_NODE) {
            return '';   // comments, PIs, etc. -> dropped
        }

        /** @var DOMElement $node */
        $tag = strtolower($node->nodeName);

        if (!isset(self::ALLOWED_TAGS[$tag])) {
            // Disallowed tag: drop the tag but keep its (sanitized) text content.
            $inner = '';
            foreach (iterator_to_array($node->childNodes) as $c) {
                $inner .= self::renderNode($c);
            }
            return $inner;
        }

        // <br> is self-closing.
        if ($tag === 'br') return '<br>';

        // contentEditable wraps each new line in a <div> (or <p>). A block
        // always starts on a new line, so emit a <br> BEFORE its content.
        // (A leading <br> at the very top is stripped in clean().) This
        // fixes lines running together when the first line is bare text and
        // following lines are wrapped in divs.
        if ($tag === 'div' || $tag === 'p') {
            $inner = '';
            foreach (iterator_to_array($node->childNodes) as $c) {
                $inner .= self::renderNode($c);
            }
            // An empty div from contentEditable represents a blank line.
            if (trim(strip_tags($inner)) === '' && strpos($inner, '<br>') === false) {
                return '<br>';
            }
            return '<br>' . $inner;
        }

        // Build inner content.
        $inner = '';
        foreach (iterator_to_array($node->childNodes) as $c) {
            $inner .= self::renderNode($c);
        }

        // <span> may carry a sanitized style (color + font-size only).
        if ($tag === 'span') {
            $style = self::safeStyle($node->getAttribute('style'));
            if ($inner === '') return '';
            return $style !== ''
                ? '<span style="' . $style . '">' . $inner . '</span>'
                : $inner;   // no allowed style -> unwrap
        }

        // <font color="..."> from legacy execCommand -> convert to a span.
        if ($tag === 'font') {
            if ($inner === '') return '';
            $styles = [];
            $color = self::normalizeColor($node->getAttribute('color'));
            if ($color !== null) $styles[] = 'color:' . $color;
            // <font style="..."> may also carry color/size.
            $fromStyle = self::safeStyle($node->getAttribute('style'));
            if ($fromStyle !== '') $styles[] = $fromStyle;
            $style = implode(';', $styles);
            return $style !== ''
                ? '<span style="' . $style . '">' . $inner . '</span>'
                : $inner;
        }

        // Normalise synonyms to canonical tags.
        $canonical = ['strong' => 'strong', 'b' => 'strong', 'em' => 'em', 'i' => 'em', 'u' => 'u'][$tag] ?? $tag;

        if ($inner === '') return '';
        return '<' . $canonical . '>' . $inner . '</' . $canonical . '>';
    }

    /**
     * Return a safe style string containing ONLY an allowed color and/or
     * font-size, or '' if neither is valid.
     */
    private static function safeStyle(string $style): string
    {
        if ($style === '') return '';
        $parts = [];

        // color: hex, rgb(), or a conservative set of named colors.
        if (preg_match('/color\s*:\s*([^;]+)/i', $style, $m)) {
            $color = self::normalizeColor(trim($m[1]));
            if ($color !== null) {
                $parts[] = 'color:' . $color;
            }
        }

        // font-size: a number of px that we clamp to the allowed set.
        if (preg_match('/font-size\s*:\s*(\d+)\s*px/i', $style, $m)) {
            $size = (int) $m[1];
            // snap to nearest allowed size
            $best = self::ALLOWED_SIZES[0];
            foreach (self::ALLOWED_SIZES as $s) {
                if (abs($s - $size) < abs($best - $size)) $best = $s;
            }
            $parts[] = 'font-size:' . $best . 'px';
        }

        return implode(';', $parts);
    }

    /**
     * Normalize a color to a safe hex/named value, or null if unsafe.
     * Accepts #hex, rgb(r,g,b), and a small set of named colors. This is
     * what makes execCommand('foreColor') output (which is rgb()) survive.
     */
    private static function normalizeColor(string $color): ?string
    {
        $color = trim($color);

        // #hex (3 or 6 digits)
        if (preg_match('/^#([0-9a-f]{3}|[0-9a-f]{6})$/i', $color)) {
            return $color;
        }

        // rgb(r, g, b) -> #rrggbb
        if (preg_match('/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i', $color, $m)) {
            $r = min(255, (int) $m[1]);
            $g = min(255, (int) $m[2]);
            $b = min(255, (int) $m[3]);
            return sprintf('#%02x%02x%02x', $r, $g, $b);
        }

        // named colors
        $named = [
            'black','white','red','green','blue','orange','purple','teal',
            'gray','grey','navy','maroon','olive','lime','aqua','fuchsia',
            'silver','yellow','brown','pink',
        ];
        if (in_array(strtolower($color), $named, true)) {
            return strtolower($color);
        }

        return null;
    }

    /**
     * Strip ALL tags to a plain-text preview (for feed snippets, search,
     * notifications, etc. where formatting isn't wanted).
     */
    public static function toPlain(string $html): string
    {
        $text = preg_replace('#<br\s*/?>#i', ' ', $html);
        $text = strip_tags($text);
        $text = html_entity_decode($text, ENT_QUOTES, 'UTF-8');
        return trim(preg_replace('/\s+/', ' ', $text));
    }
}
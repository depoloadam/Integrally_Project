#!/usr/bin/env node
// =====================================================================
// FILE: tools/generate-job-catalog.js
// Regenerates src/JobCatalog.php from assets/js/jobs-catalog.js.
//
// Run whenever the JS catalog changes:
//   node tools/generate-job-catalog.js
//
// Emits: CATEGORIES, TITLE_MAP (title -> category id), TOKEN_MAP
// (title token -> category ids, used IDF-style), ADJACENCY (curated
// related-category map), plus the PHP helper methods (title/category
// resolution, token relevance, similarity) which live in the template
// at the bottom of this script.
// =====================================================================

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC  = path.join(ROOT, "assets/js/jobs-catalog.js");
const OUT  = path.join(ROOT, "src/JobCatalog.php");

// Tokens ignored when voting on categories: glue words + seniority/level
// modifiers that carry no category signal ("Senior", "Lead", ...).
const STOP = new Set(["and","of","the","a","an","in","for","non","to",
                      "senior","junior","lead","staff","principal","entry","mid"]);

// Curated adjacency: which categories earn partial (half) experience
// credit for each other. Tune freely; regenerate after edits.
const ADJACENCY = {
  "Software & Engineering": ["Data & AI","IT & Infrastructure","Cybersecurity","Product & Project","Engineering (Non-Software)"],
  "Data & AI": ["Software & Engineering","Science & Research","IT & Infrastructure"],
  "IT & Infrastructure": ["Software & Engineering","Cybersecurity","Data & AI"],
  "Cybersecurity": ["IT & Infrastructure","Software & Engineering"],
  "Design & Creative": ["Marketing & Communications","Media, Writing & Entertainment","Product & Project"],
  "Product & Project": ["Software & Engineering","Design & Creative","Operations & Management"],
  "Marketing & Communications": ["Sales & Business Development","Design & Creative","Media, Writing & Entertainment"],
  "Sales & Business Development": ["Marketing & Communications","Customer Support & Service","Retail & Consumer"],
  "Customer Support & Service": ["Sales & Business Development","Retail & Consumer","Hospitality, Food & Travel"],
  "Finance & Accounting": ["Operations & Management","Legal","Real Estate & Property"],
  "Human Resources": ["Operations & Management","Education & Training"],
  "Operations & Management": ["Product & Project","Supply Chain & Logistics","Finance & Accounting","Human Resources","Manufacturing & Production"],
  "Supply Chain & Logistics": ["Operations & Management","Manufacturing & Production"],
  "Healthcare & Medical": ["Mental Health & Social Services","Science & Research"],
  "Mental Health & Social Services": ["Healthcare & Medical","Education & Training"],
  "Education & Training": ["Mental Health & Social Services","Human Resources"],
  "Legal": ["Finance & Accounting","Public Sector, Safety & Government"],
  "Engineering (Non-Software)": ["Software & Engineering","Manufacturing & Production","Skilled Trades & Construction","Science & Research"],
  "Skilled Trades & Construction": ["Engineering (Non-Software)","Manufacturing & Production","Real Estate & Property"],
  "Manufacturing & Production": ["Supply Chain & Logistics","Engineering (Non-Software)","Skilled Trades & Construction","Operations & Management"],
  "Science & Research": ["Data & AI","Healthcare & Medical","Agriculture & Environment","Engineering (Non-Software)"],
  "Media, Writing & Entertainment": ["Design & Creative","Marketing & Communications"],
  "Hospitality, Food & Travel": ["Customer Support & Service","Retail & Consumer"],
  "Retail & Consumer": ["Sales & Business Development","Customer Support & Service","Hospitality, Food & Travel"],
  "Public Sector, Safety & Government": ["Legal","Education & Training","Healthcare & Medical"],
  "Real Estate & Property": ["Finance & Accounting","Skilled Trades & Construction","Sales & Business Development"],
  "Agriculture & Environment": ["Science & Research","Skilled Trades & Construction"],
};

// ---- load catalog ----------------------------------------------------
const js = fs.readFileSync(SRC, "utf8");
const m = js.match(/const JOB_CATALOG = (\[[\s\S]*?\n\]);/);
if (!m) { console.error("Could not find JOB_CATALOG in " + SRC); process.exit(1); }
const catalog = eval(m[1]);   // trusted local file

const cats = catalog.map(c => c.category);
const ci = Object.fromEntries(cats.map((c, i) => [c, i]));

// Validate adjacency covers exactly the current categories.
for (const c of cats) if (!ADJACENCY[c]) { console.error("ADJACENCY missing: " + c); process.exit(1); }
for (const [k, vs] of Object.entries(ADJACENCY)) {
  if (!(k in ci)) { console.error("ADJACENCY has unknown category: " + k); process.exit(1); }
  for (const v of vs) if (!(v in ci)) { console.error(`ADJACENCY '${k}' references unknown: ${v}`); process.exit(1); }
}

const titleMap = {};
const tokenMap = {};
for (const c of catalog) {
  for (const t of c.titles) {
    titleMap[t.toLowerCase()] = ci[c.category];
    for (const w of t.toLowerCase().match(/[a-z]+/g) || []) {
      if (w.length < 3 || STOP.has(w)) continue;
      (tokenMap[w] ||= new Set()).add(ci[c.category]);
    }
  }
}

const phpStr = s => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

let out = "";
out += "<?php\n";
out += `
// =====================================================================
// FILE: src/JobCatalog.php
// ---------------------------------------------------------------------
// GENERATED by tools/generate-job-catalog.js from
// assets/js/jobs-catalog.js — DO NOT hand-edit the data arrays.
// Regenerate after any catalog change:  node tools/generate-job-catalog.js
//
// Provides the server-side title -> category mapping + token relevance
// used by ScoreEngine's category-relevance algorithm:
//   * CATEGORIES     category names (index = category id)
//   * TITLE_MAP      normalized catalog title -> category id
//   * TOKEN_MAP      title token -> list of category ids containing it
//                    (matching weights tokens by 1/count — IDF-style —
//                    so generic words like 'manager' count little)
//   * ADJACENCY      category id -> related category ids (partial credit)
// =====================================================================

class JobCatalog
{
`;
out += "    public const CATEGORIES = [\n";
for (const c of cats) out += `        ${phpStr(c)},\n`;
out += "    ];\n\n";

out += "    public const TITLE_MAP = [\n";
for (const t of Object.keys(titleMap).sort()) out += `        ${phpStr(t)} => ${titleMap[t]},\n`;
out += "    ];\n\n";

out += "    public const TOKEN_MAP = [\n";
for (const t of Object.keys(tokenMap).sort()) out += `        ${phpStr(t)} => [${[...tokenMap[t]].sort((a,b)=>a-b).join(",")}],\n`;
out += "    ];\n\n";

out += "    public const ADJACENCY = [\n";
for (const c of cats) out += `        ${ci[c]} => [${ADJACENCY[c].map(v => ci[v]).join(",")}],\n`;
out += "    ];\n";

out += `
    // Two alias layers, both applied to free-text titles/skills:
    //
    // (a) WORD aliases — expand an abbreviation/compound into canonical
    //     words that ARE catalog tokens, before tokenizing. Only include
    //     forms whose expansion tokenizes cleanly (verified in tests).
    private const ALIASES = [
        'helpdesk'    => 'help desk',
        'sysadmin'    => 'systems administrator',
        'sysadmins'   => 'systems administrator',
        'infosec'     => 'security',
        'netsec'      => 'network security',
        'sre'         => 'site reliability engineer',
        'sdet'        => 'software test engineer',
        'dba'         => 'database administrator',
        'rn'          => 'registered nurse',
        'lpn'         => 'licensed practical nurse',
        'cna'         => 'nursing assistant',
        'emt'         => 'emergency medical technician',
        'sys admin'   => 'systems administrator',
        'swe'         => 'software engineer',
        'dev'         => 'developer',
        'devs'        => 'developer',
        'admin'       => 'administrator',
        'mgr'         => 'manager',
        'eng'         => 'engineer',
        'tech'        => 'technician',
        'csr'         => 'customer service representative',
        'rep'         => 'representative',
    ];

    // (b) CATEGORY aliases — short forms best mapped straight to a
    //     category id (checked in categoryForTitle before token voting),
    //     because their word-expansions don't tokenize reliably.
    private const CATEGORY_ALIASES = [
        'it'         => 2,   // IT & Infrastructure
        'qa'         => 0,   // Software & Engineering
        'ux'         => 4,   // Design & Creative
        'ui'         => 4,   // Design & Creative
        'hr'         => 10,  // Human Resources
        'ml'         => 1,   // Data & AI
        'ai'         => 1,   // Data & AI
        'bi'         => 1,   // Data & AI
        'pm'         => 5,   // Product & Project
        'ba'         => 5,   // Product & Project (business analyst)
        'cpa'        => 9,   // Finance & Accounting
    ];

    /**
     * Expand word aliases in free text before tokenizing. Whole-word
     * replacement on short titles/skills (not prose).
     */
    public static function expandAliases(string $text): string
    {
        $t = ' ' . strtolower($text) . ' ';
        foreach (self::ALIASES as $from => $to) {
            $t = preg_replace('/\\\\b' . preg_quote($from, '/') . '\\\\b/', $to, $t);
        }
        return trim($t);
    }

    /** Lowercase word tokens (3+ chars, minus stopwords) from any text. */
    public static function tokens(string $text): array
    {
        $text = self::expandAliases($text);
        preg_match_all('/[a-z]+/', strtolower($text), $m);
        $stop = ['and'=>1,'of'=>1,'the'=>1,'a'=>1,'an'=>1,'in'=>1,'for'=>1,'non'=>1,'to'=>1,
                 // seniority/level modifiers: meaningless for category voting
                 'senior'=>1,'junior'=>1,'lead'=>1,'staff'=>1,'principal'=>1,'entry'=>1,'mid'=>1];
        $out = [];
        foreach ($m[0] as $w) {
            if (strlen($w) >= 3 && !isset($stop[$w])) $out[$w] = true;
        }
        return array_keys($out);
    }

    /**
     * Resolve a token to a TOKEN_MAP key, tolerating simple suffix
     * variants ('networking' -> 'network', 'engineers' -> 'engineer').
     * Only maps to forms that actually exist in the map.
     */
    private static function lookupToken(string $tok): ?string
    {
        if (isset(self::TOKEN_MAP[$tok])) return $tok;
        foreach (['ing', 'ers', 'er', 's'] as $suf) {
            $len = strlen($suf);
            if (strlen($tok) > $len + 2 && substr($tok, -$len) === $suf) {
                $base = substr($tok, 0, -$len);
                if (isset(self::TOKEN_MAP[$base])) return $base;
            }
        }
        return null;
    }

    /**
     * Resolve a (free-text) job title to a category id, or null.
     * Exact catalog match first; otherwise IDF-weighted token vote with
     * a minimum-confidence threshold so nonsense titles stay null.
     */
    public static function categoryForTitle(string $title): ?int
    {
        $norm = strtolower(trim($title));
        if ($norm === '') return null;
        if (isset(self::TITLE_MAP[$norm])) return self::TITLE_MAP[$norm];

        $votes = [];
        $total = 0.0;

        // Strong signal: category-alias words (it, qa, hr, ml, ...) present
        // as whole words vote directly and heavily for their category.
        foreach (self::CATEGORY_ALIASES as $word => $cid) {
            if (preg_match('/\\\\b' . preg_quote($word, '/') . '\\\\b/', $norm)) {
                $votes[$cid] = ($votes[$cid] ?? 0) + 1.5;
                $total += 1.5;
            }
        }

        foreach (self::tokens($norm) as $tok) {
            $tok = self::lookupToken($tok);
            if ($tok === null) continue;
            $catIds = self::TOKEN_MAP[$tok];
            $w = 1.0 / count($catIds);          // generic tokens count little
            $total += $w;
            foreach ($catIds as $cid) {
                $votes[$cid] = ($votes[$cid] ?? 0) + $w;
            }
        }
        if (!$votes || $total <= 0) return null;
        arsort($votes);
        $ids     = array_keys($votes);
        $bestId  = $ids[0];
        $bestVal = $votes[$bestId];
        // Dead heat between two categories -> don't guess.
        if (isset($ids[1]) && abs($votes[$ids[1]] - $bestVal) < 1e-9) return null;
        // Require the winner to carry a meaningful share of token weight.
        return ($bestVal >= 0.5 && $bestVal / $total >= 0.4) ? $bestId : null;
    }

    /**
     * How relevant is a piece of text (skill name, degree field, cert)
     * to a category? 0..1. IDF-weighted share of the text's tokens that
     * point at the category (directly or via an adjacent category at
     * half weight).
     */
    public static function tokenRelevance(string $text, int $categoryId): float
    {
        $toks = self::tokens($text);
        if (!$toks) return 0.0;
        $adj = self::ADJACENCY[$categoryId] ?? [];
        $hit = 0.0; $total = 0.0;
        foreach ($toks as $tok) {
            $tok = self::lookupToken($tok);
            if ($tok === null) { $total += 0.4; continue; } // unknown tokens dilute a bit
            $catIds = self::TOKEN_MAP[$tok];
            $w = 1.0 / count($catIds);
            $total += $w;
            if (in_array($categoryId, $catIds, true))      $hit += $w;
            elseif (array_intersect($adj, $catIds))         $hit += $w * 0.5;
        }
        return $total > 0 ? min(1.0, $hit / $total) : 0.0;
    }

    /** Plain token-overlap similarity between two texts, 0..1. */
    public static function titleSimilarity(string $a, string $b): float
    {
        $ta = self::tokens($a); $tb = self::tokens($b);
        if (!$ta || !$tb) return 0.0;
        $inter = count(array_intersect($ta, $tb));
        return $inter / max(1, min(count($ta), count($tb)));
    }
}
`;

fs.writeFileSync(OUT, out);
console.log(`Wrote ${OUT}: ${cats.length} categories, ${Object.keys(titleMap).length} titles, ${Object.keys(tokenMap).length} tokens`);

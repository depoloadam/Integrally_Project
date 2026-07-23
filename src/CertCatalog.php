<?php

// =====================================================================
// FILE: src/CertCatalog.php
// ---------------------------------------------------------------------
// Maps certification names/issuers to JobCatalog categories, mirroring
// the EducationCatalog pattern (curated map first, longest-substring
// containment second). Certifications speak a vocabulary of vendors,
// acronyms, and program names ("CCNA", "PMP", "ServSafe", "NCLEX-RN")
// that barely overlaps with job-title tokens, so before this catalog
// existed the engine's fuzzy text matching scored most famous certs as
// unrelated. ScoreEngine resolves a cert here first (full credit on a
// direct category hit, half on an adjacent one) and only falls back to
// fuzzy matching when the catalog doesn't know the cert.
//
// Category indices — see JobCatalog::CATEGORIES:
//  0 Software  1 Data/AI  2 IT/Infra  3 Cyber  4 Design  5 Prod/Proj
//  6 Marketing 7 Sales    8 Support   9 Finance 10 HR    11 Ops/Mgmt
// 12 Logistics 13 Health 14 MentalH  15 Educ   16 Legal  17 Eng(non-sw)
// 18 Trades   19 Mfg     20 Science  21 Media  22 Hosp/Food 23 Retail
// 24 PublicSafety 25 RealEstate 26 Agri/Env
// =====================================================================

class CertCatalog
{
    // Known certifications and cert-family aliases. Keys are matched
    // against the normalized "name issuer" string, exact first, then
    // longest-substring. Longer keys are tried first, so "american
    // welding society" wins before any shorter match could misfire.
    public const CERT_MAP = [
        // ---- software / cloud / devops ----
        'aws certified' => [0,2],                    // Amazon cloud family
        'amazon web services' => [0,2],
        'solutions architect' => [0,2],
        'azure' => [2,0],
        'google cloud' => [2,0],
        'gcp' => [2,0],
        'kubernetes' => [0,2],
        'cka' => [0,2],
        'ckad' => [0,2],
        'terraform' => [2,0],
        'docker' => [0,2],
        'oracle certified' => [0,2],
        'java se' => [0],
        'ocjp' => [0],
        'istqb' => [0],
        'devnet' => [0,2],
        'red hat' => [2,0],
        'rhcsa' => [2],
        'rhce' => [2],
        // ---- data / analytics ----
        'tableau' => [1],
        'power bi' => [1],
        'databricks' => [1],
        'tensorflow' => [1],
        'data engineer' => [1],
        'machine learning' => [1],
        'google analytics' => [6,1],
        // ---- IT / networking ----
        'comptia a+' => [2],
        'comptia network+' => [2],
        'network+' => [2],
        'comptia cloud+' => [2],
        'comptia linux+' => [2],
        'linux professional institute' => [2],
        'lpic' => [2],
        'ccna' => [2,3],
        'ccnp' => [2,3],
        'ccie' => [2],
        'cisco certified' => [2,3],
        'itil' => [2,11],
        'microsoft certified' => [2,0],
        'microsoft office specialist' => [2,11],
        // ---- cybersecurity ----
        'comptia security+' => [3],
        'security+' => [3],
        'cissp' => [3],
        'cism' => [3],
        'cisa' => [3,9],
        'ceh' => [3],
        'certified ethical hacker' => [3],
        'oscp' => [3],
        'giac' => [3],
        'cysa' => [3],
        'pentest' => [3],
        // ---- product / project ----
        'pmp' => [5,11],
        'project management professional' => [5,11],
        'capm' => [5,11],
        'prince2' => [5,11],
        'certified scrummaster' => [5],
        'certified scrum master' => [5],
        'csm' => [5],
        'psm' => [5],
        'safe agilist' => [5],
        'pmi-acp' => [5],
        'product owner' => [5],
        // ---- marketing / sales ----
        'google ads' => [6],
        'hubspot' => [6,7],
        'digital marketing' => [6],
        'salesforce' => [7,2],
        'seo certification' => [6],
        // ---- finance / accounting ----
        'cpa' => [9],
        'certified public accountant' => [9],
        'cfa' => [9],
        'chartered financial analyst' => [9],
        'cma' => [9],
        'certified management accountant' => [9],
        'enrolled agent' => [9],
        'finra' => [9],
        'series 7' => [9],
        'series 63' => [9],
        'series 65' => [9],
        'quickbooks' => [9],
        'certified bookkeeper' => [9],
        'actuarial' => [9],
        'frm' => [9],
        // ---- HR ----
        'shrm' => [10],
        'phr' => [10],
        'sphr' => [10],
        'professional in human resources' => [10],
        // ---- ops / manufacturing / quality ----
        'six sigma' => [11,19],
        'lean six sigma' => [11,19],
        'green belt' => [11,19],
        'black belt' => [11,19],
        'cpim' => [12,19],
        'cscp' => [12],
        'apics' => [12,19],
        'cqe' => [19],
        'certified quality' => [19],
        // ---- logistics / transport ----
        'cdl' => [12],
        'commercial driver' => [12],
        'forklift' => [12,19],
        'twic' => [12,24],
        'faa' => [12,17],
        'private pilot' => [12],
        'commercial pilot' => [12],
        'a&p mechanic' => [17,12],
        'airframe and powerplant' => [17,12],
        // ---- healthcare ----
        'nclex' => [13],
        'registered nurse' => [13],
        'rn license' => [13],
        'bls' => [13,24],
        'acls' => [13],
        'pals' => [13],
        'cna' => [13],
        'certified nursing assistant' => [13],
        'cma (aama)' => [13],
        'certified medical assistant' => [13],
        'ccma' => [13],
        'phlebotomy' => [13],
        'pharmacy technician' => [13],
        'cpht' => [13],
        'emt' => [13,24],
        'paramedic' => [13,24],
        'radiologic' => [13],
        'dental assistant' => [13],
        'cpr' => [13,24],
        'first aid' => [13,24],
        'personal trainer' => [13],
        'nasm' => [13],
        'ace certified' => [13],
        // ---- mental health / social ----
        'lcsw' => [14],
        'licensed clinical social worker' => [14],
        'lpc' => [14],
        'licensed professional counselor' => [14],
        'cadc' => [14],
        // ---- education ----
        'teaching license' => [15],
        'teaching certificate' => [15],
        'tefl' => [15],
        'tesol' => [15],
        'celta' => [15],
        'praxis' => [15],
        // ---- legal ----
        'bar admission' => [16],
        'bar exam' => [16],
        'paralegal certificate' => [16],
        'notary' => [16,24],
        // ---- engineering (non-software) ----
        'professional engineer' => [17],
        'pe license' => [17],
        'fe exam' => [17],
        'fundamentals of engineering' => [17],
        'autocad' => [4,17],
        'solidworks' => [17,19],
        'leed' => [18,17],
        // ---- trades / construction ----
        'osha' => [18,24,19],
        'journeyman' => [18],
        'master electrician' => [18],
        'epa 608' => [18],
        'epa section 608' => [18],
        'hvac' => [18],
        'nate certified' => [18],
        'american welding society' => [18],
        'certified welding' => [18],
        'cwi' => [18],
        'nccer' => [18],
        // ---- hospitality / food ----
        'servsafe' => [22],
        'food handler' => [22],
        'food protection manager' => [22],
        'sommelier' => [22],
        'culinary' => [22],
        'tips certified' => [22],
        'bartending' => [22],
        // ---- retail / consumer ----
        'cosmetology' => [23],
        'barber license' => [23],
        'esthetician' => [23],
        // ---- public safety ----
        'firefighter' => [24],
        'police academy' => [24],
        'security guard' => [24],
        'guard card' => [24],
        'lifeguard' => [24,22],
        'peace officer' => [24],
        // ---- real estate / insurance ----
        'real estate license' => [25],
        'realtor' => [25],
        'real estate salesperson' => [25],
        'property management' => [25],
        'appraiser' => [25],
        'insurance license' => [9,25],
        'life and health' => [9],
        // ---- agriculture / environment ----
        'pesticide applicator' => [26],
        'arborist' => [26],
        'veterinary technician' => [26,13],
        'wastewater' => [26,24],
    ];

    // Cert-domain vocabulary for partial credit when the cert itself
    // isn't in CERT_MAP. Same shape as JobCatalog::TOKEN_MAP but tuned
    // to certification language. Deliberately excludes ambiguous
    // English ("certified", "professional", "associate", "specialist").
    public const TOKEN_MAP = [
        'aws' => [0,2], 'azure' => [2,0], 'cloud' => [2,0], 'devops' => [0,2],
        'cisco' => [2,3], 'comptia' => [2,3], 'network' => [2], 'linux' => [2,0],
        'cybersecurity' => [3], 'infosec' => [3],
        'scrum' => [5], 'agile' => [5], 'pmi' => [5,11], 'kanban' => [5],
        'marketing' => [6], 'seo' => [6], 'advertising' => [6],
        'accounting' => [9], 'bookkeeping' => [9], 'audit' => [9], 'tax' => [9],
        'payroll' => [9,10], 'hr' => [10],
        'logistics' => [12], 'supply' => [12], 'trucking' => [12],
        'nurse' => [13], 'nursing' => [13], 'clinical' => [13], 'medical' => [13],
        'patient' => [13], 'pharmacy' => [13], 'dental' => [13], 'radiology' => [13],
        'counseling' => [14], 'therapist' => [14],
        'teaching' => [15], 'teacher' => [15], 'instruction' => [15],
        'paralegal' => [16], 'legal' => [16],
        'welding' => [18], 'plumbing' => [18], 'electrician' => [18],
        'carpentry' => [18], 'construction' => [18], 'crane' => [18],
        'machinist' => [19], 'cnc' => [19], 'quality' => [19],
        'safety' => [24,18,19], 'firearms' => [24],
        'culinary' => [22], 'food' => [22], 'hospitality' => [22],
        'restaurant' => [22], 'alcohol' => [22],
        'realtor' => [25], 'appraisal' => [25], 'mortgage' => [25,9],
        'agriculture' => [26], 'environmental' => [26,20], 'pesticide' => [26],
        'veterinary' => [26,13], 'fitness' => [13], 'analytics' => [1,6],
        'aviation' => [12,17], 'automotive' => [18,19],
    ];

    /**
     * Resolve a certification (name + issuer) to job categories, or
     * null if the catalog doesn't recognize it. Exact match on the
     * combined text first, then longest-substring containment (so
     * "american welding society" beats any shorter overlapping key),
     * then a token vote across TOKEN_MAP.
     */
    public static function categoriesForCert(string $name, string $issuer = ''): ?array
    {
        $norm = strtolower(trim($name . ' ' . $issuer));
        $norm = preg_replace('/\s+/', ' ', $norm);
        if ($norm === '') return null;

        if (isset(self::CERT_MAP[$norm])) return self::CERT_MAP[$norm];

        static $byLength = null;
        if ($byLength === null) {
            $byLength = array_keys(self::CERT_MAP);
            usort($byLength, fn($a, $b) => strlen($b) <=> strlen($a));
        }
        foreach ($byLength as $key) {
            if (str_contains($norm, $key)) return self::CERT_MAP[$key];
        }

        // Token vote: collect every category any known token points at.
        $votes = [];
        foreach (preg_split('/[^a-z0-9+&]+/', $norm) as $tok) {
            if ($tok === '' || !isset(self::TOKEN_MAP[$tok])) continue;
            foreach (self::TOKEN_MAP[$tok] as $cid) $votes[$cid] = true;
        }
        return $votes ? array_keys($votes) : null;
    }
}

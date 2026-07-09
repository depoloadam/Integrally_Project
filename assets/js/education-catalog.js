// =====================================================================
// education-catalog.js — shared fields-of-study catalog + typeahead.
// Loaded by app.html before the SPA scripts. Plain globals, matching
// jobs-catalog.js.
//
// Like the jobs catalog, this is a SUGGESTION source: users may type
// any field; off-list entries are stored verbatim. Picking (or typing)
// a catalog field gives the scoring engine a deterministic mapping to
// job categories (see src/EducationCatalog.php, generated from this
// file by tools/generate-education-catalog.js — regenerate after edits:
//   node tools/generate-education-catalog.js
//
// Shape: EDU_CATALOG = [ { group, fields: [ { name, cats:[...] } ] } ].
// `cats` lists the JOB CATALOG category names this field of study is
// evidence for (first = strongest). Empty cats = presence-only fields
// with no particular category signal (e.g. General Studies).
// =====================================================================

const EDU_CATALOG = [
  { group: "Technology & Computing", fields: [
    { name: "Computer Science", cats: ["Software & Engineering","Data & AI","IT & Infrastructure"] },
    { name: "Software Engineering", cats: ["Software & Engineering"] },
    { name: "Information Technology", cats: ["IT & Infrastructure"] },
    { name: "Information Systems", cats: ["IT & Infrastructure","Operations & Management"] },
    { name: "Computer Information Systems", cats: ["IT & Infrastructure","Software & Engineering"] },
    { name: "Cybersecurity", cats: ["Cybersecurity","IT & Infrastructure"] },
    { name: "Computer Engineering", cats: ["Software & Engineering","Engineering (Non-Software)"] },
    { name: "Data Science", cats: ["Data & AI"] },
    { name: "Data Analytics", cats: ["Data & AI"] },
    { name: "Artificial Intelligence", cats: ["Data & AI","Software & Engineering"] },
    { name: "Machine Learning", cats: ["Data & AI"] },
    { name: "Web Development", cats: ["Software & Engineering","Design & Creative"] },
    { name: "Game Design & Development", cats: ["Software & Engineering","Design & Creative"] },
    { name: "Network Administration", cats: ["IT & Infrastructure"] },
    { name: "Human-Computer Interaction", cats: ["Design & Creative","Software & Engineering"] },
  ] },
  { group: "Engineering", fields: [
    { name: "Mechanical Engineering", cats: ["Engineering (Non-Software)","Manufacturing & Production"] },
    { name: "Electrical Engineering", cats: ["Engineering (Non-Software)"] },
    { name: "Civil Engineering", cats: ["Engineering (Non-Software)","Skilled Trades & Construction"] },
    { name: "Chemical Engineering", cats: ["Engineering (Non-Software)","Science & Research"] },
    { name: "Aerospace Engineering", cats: ["Engineering (Non-Software)"] },
    { name: "Industrial Engineering", cats: ["Engineering (Non-Software)","Manufacturing & Production","Operations & Management"] },
    { name: "Biomedical Engineering", cats: ["Engineering (Non-Software)","Healthcare & Medical"] },
    { name: "Environmental Engineering", cats: ["Engineering (Non-Software)","Agriculture & Environment"] },
    { name: "Materials Science & Engineering", cats: ["Engineering (Non-Software)","Science & Research"] },
    { name: "Structural Engineering", cats: ["Engineering (Non-Software)","Skilled Trades & Construction"] },
    { name: "Petroleum Engineering", cats: ["Engineering (Non-Software)"] },
    { name: "Nuclear Engineering", cats: ["Engineering (Non-Software)","Science & Research"] },
    { name: "Robotics Engineering", cats: ["Engineering (Non-Software)","Software & Engineering"] },
  ] },
  { group: "Business & Finance", fields: [
    { name: "Accounting", cats: ["Finance & Accounting"] },
    { name: "Finance", cats: ["Finance & Accounting"] },
    { name: "Business Administration", cats: ["Operations & Management","Finance & Accounting"] },
    { name: "Business Management", cats: ["Operations & Management"] },
    { name: "Economics", cats: ["Finance & Accounting","Data & AI"] },
    { name: "Marketing", cats: ["Marketing & Communications","Sales & Business Development"] },
    { name: "International Business", cats: ["Operations & Management","Sales & Business Development"] },
    { name: "Entrepreneurship", cats: ["Operations & Management","Sales & Business Development"] },
    { name: "Human Resource Management", cats: ["Human Resources"] },
    { name: "Supply Chain Management", cats: ["Supply Chain & Logistics","Operations & Management"] },
    { name: "Logistics & Transportation", cats: ["Supply Chain & Logistics"] },
    { name: "Real Estate", cats: ["Real Estate & Property"] },
    { name: "Hospitality Management", cats: ["Hospitality, Food & Travel","Operations & Management"] },
    { name: "Business Analytics", cats: ["Data & AI","Finance & Accounting"] },
    { name: "Project Management", cats: ["Product & Project","Operations & Management"] },
    { name: "Actuarial Science", cats: ["Finance & Accounting","Data & AI"] },
    { name: "Sales Management", cats: ["Sales & Business Development"] },
    { name: "Sport Management", cats: ["Operations & Management","Marketing & Communications"] },
  ] },
  { group: "Health & Medicine", fields: [
    { name: "Nursing", cats: ["Healthcare & Medical"] },
    { name: "Medicine", cats: ["Healthcare & Medical"] },
    { name: "Pre-Medicine", cats: ["Healthcare & Medical","Science & Research"] },
    { name: "Pharmacy", cats: ["Healthcare & Medical"] },
    { name: "Public Health", cats: ["Healthcare & Medical","Public Sector, Safety & Government"] },
    { name: "Dentistry", cats: ["Healthcare & Medical"] },
    { name: "Dental Hygiene", cats: ["Healthcare & Medical"] },
    { name: "Physical Therapy", cats: ["Healthcare & Medical"] },
    { name: "Occupational Therapy", cats: ["Healthcare & Medical"] },
    { name: "Radiologic Technology", cats: ["Healthcare & Medical"] },
    { name: "Nutrition & Dietetics", cats: ["Healthcare & Medical"] },
    { name: "Veterinary Medicine", cats: ["Healthcare & Medical","Agriculture & Environment"] },
    { name: "Veterinary Technology", cats: ["Healthcare & Medical","Agriculture & Environment"] },
    { name: "Health Administration", cats: ["Healthcare & Medical","Operations & Management"] },
    { name: "Kinesiology", cats: ["Healthcare & Medical"] },
    { name: "Exercise Science", cats: ["Healthcare & Medical"] },
    { name: "Medical Laboratory Science", cats: ["Healthcare & Medical","Science & Research"] },
    { name: "Speech-Language Pathology", cats: ["Healthcare & Medical","Mental Health & Social Services"] },
    { name: "Emergency Medical Services", cats: ["Healthcare & Medical","Public Sector, Safety & Government"] },
  ] },
  { group: "Mental Health & Social Services", fields: [
    { name: "Psychology", cats: ["Mental Health & Social Services","Human Resources"] },
    { name: "Counseling", cats: ["Mental Health & Social Services"] },
    { name: "Social Work", cats: ["Mental Health & Social Services"] },
    { name: "Sociology", cats: ["Mental Health & Social Services","Public Sector, Safety & Government"] },
    { name: "Marriage & Family Therapy", cats: ["Mental Health & Social Services"] },
    { name: "Substance Abuse Counseling", cats: ["Mental Health & Social Services"] },
  ] },
  { group: "Sciences & Mathematics", fields: [
    { name: "Biology", cats: ["Science & Research","Healthcare & Medical"] },
    { name: "Chemistry", cats: ["Science & Research"] },
    { name: "Physics", cats: ["Science & Research","Engineering (Non-Software)"] },
    { name: "Mathematics", cats: ["Data & AI","Science & Research","Finance & Accounting"] },
    { name: "Statistics", cats: ["Data & AI","Science & Research"] },
    { name: "Biochemistry", cats: ["Science & Research","Healthcare & Medical"] },
    { name: "Neuroscience", cats: ["Science & Research","Healthcare & Medical"] },
    { name: "Environmental Science", cats: ["Agriculture & Environment","Science & Research"] },
    { name: "Geology", cats: ["Science & Research","Agriculture & Environment"] },
    { name: "Astronomy", cats: ["Science & Research"] },
    { name: "Microbiology", cats: ["Science & Research","Healthcare & Medical"] },
    { name: "Genetics", cats: ["Science & Research"] },
    { name: "Marine Biology", cats: ["Science & Research","Agriculture & Environment"] },
    { name: "Forensic Science", cats: ["Science & Research","Public Sector, Safety & Government"] },
  ] },
  { group: "Social Sciences & Humanities", fields: [
    { name: "Political Science", cats: ["Public Sector, Safety & Government","Legal"] },
    { name: "International Relations", cats: ["Public Sector, Safety & Government"] },
    { name: "History", cats: ["Education & Training"] },
    { name: "English", cats: ["Media, Writing & Entertainment","Education & Training"] },
    { name: "Literature", cats: ["Media, Writing & Entertainment","Education & Training"] },
    { name: "Philosophy", cats: ["Education & Training"] },
    { name: "Anthropology", cats: ["Science & Research"] },
    { name: "Geography", cats: ["Science & Research","Public Sector, Safety & Government"] },
    { name: "Linguistics", cats: ["Education & Training","Data & AI"] },
    { name: "Communications", cats: ["Marketing & Communications","Media, Writing & Entertainment"] },
    { name: "Journalism", cats: ["Media, Writing & Entertainment"] },
    { name: "Public Relations", cats: ["Marketing & Communications"] },
    { name: "Modern Languages", cats: ["Education & Training"] },
    { name: "Religious Studies", cats: ["Education & Training"] },
    { name: "Liberal Arts", cats: [] },
    { name: "General Studies", cats: [] },
    { name: "Criminal Justice", cats: ["Public Sector, Safety & Government","Legal"] },
    { name: "Criminology", cats: ["Public Sector, Safety & Government","Legal"] },
  ] },
  { group: "Arts & Design", fields: [
    { name: "Graphic Design", cats: ["Design & Creative"] },
    { name: "Industrial Design", cats: ["Design & Creative","Engineering (Non-Software)"] },
    { name: "Interior Design", cats: ["Design & Creative","Real Estate & Property"] },
    { name: "Fashion Design", cats: ["Design & Creative","Retail & Consumer"] },
    { name: "Fine Arts", cats: ["Design & Creative"] },
    { name: "Studio Art", cats: ["Design & Creative"] },
    { name: "Photography", cats: ["Design & Creative","Media, Writing & Entertainment"] },
    { name: "Film & Media Production", cats: ["Media, Writing & Entertainment","Design & Creative"] },
    { name: "Animation", cats: ["Design & Creative","Media, Writing & Entertainment"] },
    { name: "Music", cats: ["Media, Writing & Entertainment"] },
    { name: "Music Performance", cats: ["Media, Writing & Entertainment"] },
    { name: "Theater Arts", cats: ["Media, Writing & Entertainment"] },
    { name: "Architecture", cats: ["Design & Creative","Skilled Trades & Construction","Engineering (Non-Software)"] },
    { name: "UX Design", cats: ["Design & Creative","Software & Engineering"] },
    { name: "Creative Writing", cats: ["Media, Writing & Entertainment"] },
  ] },
  { group: "Education", fields: [
    { name: "Education", cats: ["Education & Training"] },
    { name: "Elementary Education", cats: ["Education & Training"] },
    { name: "Secondary Education", cats: ["Education & Training"] },
    { name: "Special Education", cats: ["Education & Training","Mental Health & Social Services"] },
    { name: "Early Childhood Education", cats: ["Education & Training"] },
    { name: "Curriculum & Instruction", cats: ["Education & Training"] },
    { name: "Educational Leadership", cats: ["Education & Training","Operations & Management"] },
    { name: "Instructional Design", cats: ["Education & Training","Design & Creative"] },
  ] },
  { group: "Law & Public Service", fields: [
    { name: "Law", cats: ["Legal"] },
    { name: "Legal Studies", cats: ["Legal"] },
    { name: "Paralegal Studies", cats: ["Legal"] },
    { name: "Public Administration", cats: ["Public Sector, Safety & Government","Operations & Management"] },
    { name: "Public Policy", cats: ["Public Sector, Safety & Government"] },
    { name: "Emergency Management", cats: ["Public Sector, Safety & Government"] },
    { name: "Fire Science", cats: ["Public Sector, Safety & Government"] },
    { name: "Military Science", cats: ["Public Sector, Safety & Government"] },
    { name: "Urban Planning", cats: ["Public Sector, Safety & Government","Real Estate & Property"] },
  ] },
  { group: "Trades & Applied Programs", fields: [
    { name: "Construction Management", cats: ["Skilled Trades & Construction","Operations & Management"] },
    { name: "Welding Technology", cats: ["Skilled Trades & Construction","Manufacturing & Production"] },
    { name: "Automotive Technology", cats: ["Skilled Trades & Construction","Manufacturing & Production"] },
    { name: "HVAC Technology", cats: ["Skilled Trades & Construction"] },
    { name: "Electrical Technology", cats: ["Skilled Trades & Construction"] },
    { name: "Carpentry", cats: ["Skilled Trades & Construction"] },
    { name: "Plumbing Technology", cats: ["Skilled Trades & Construction"] },
    { name: "Machining & CNC", cats: ["Manufacturing & Production","Skilled Trades & Construction"] },
    { name: "Culinary Arts", cats: ["Hospitality, Food & Travel"] },
    { name: "Baking & Pastry Arts", cats: ["Hospitality, Food & Travel"] },
    { name: "Aviation", cats: ["Supply Chain & Logistics","Engineering (Non-Software)"] },
    { name: "Cosmetology", cats: ["Retail & Consumer"] },
  ] },
  { group: "Agriculture & Environment", fields: [
    { name: "Agriculture", cats: ["Agriculture & Environment"] },
    { name: "Agricultural Science", cats: ["Agriculture & Environment","Science & Research"] },
    { name: "Horticulture", cats: ["Agriculture & Environment"] },
    { name: "Animal Science", cats: ["Agriculture & Environment","Science & Research"] },
    { name: "Forestry", cats: ["Agriculture & Environment"] },
    { name: "Sustainability Studies", cats: ["Agriculture & Environment"] },
    { name: "Food Science", cats: ["Agriculture & Environment","Science & Research","Manufacturing & Production"] },
    { name: "Wildlife & Fisheries", cats: ["Agriculture & Environment","Science & Research"] },
  ] },
];

// Flat list: [{ title, category, cats }] — same item shape the shared
// typeahead expects (title/category display), plus the cats payload.
function eduCatalogAll() {
  if (!eduCatalogAll._cache) {
    const out = [];
    for (const g of EDU_CATALOG) {
      for (const f of g.fields) out.push({ title: f.name, category: g.group, cats: f.cats });
    }
    eduCatalogAll._cache = out;
  }
  return eduCatalogAll._cache;
}

// Ranked substring search over field names (mirrors jobCatalogSearch).
function eduCatalogSearch(q, limit) {
  limit = limit || 8;
  const needle = (q || "").trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const item of eduCatalogAll()) {
    const t = item.title.toLowerCase();
    let rank = -1;
    if (t.startsWith(needle)) rank = 0;
    else if (t.includes(" " + needle)) rank = 1;
    else if (t.includes(needle)) rank = 2;
    if (rank >= 0) scored.push({ item, rank });
  }
  scored.sort((a, b) =>
    a.rank !== b.rank ? a.rank - b.rank
                      : a.item.title.localeCompare(b.item.title));
  return scored.slice(0, limit).map(s => s.item);
}

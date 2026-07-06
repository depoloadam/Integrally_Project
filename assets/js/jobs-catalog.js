// =====================================================================
// jobs-catalog.js — shared job-title catalog + typeahead wiring.
// Loaded by app.html before the SPA scripts. Plain globals (no
// modules) to match geo.js and the existing standalone pattern.
//
// The catalog is a SUGGESTION source only. Users may type ANY role;
// off-list entries are stored verbatim in scores.target_value. The
// list exists to recommend a clean, consistent title where one fits.
//
// Shape: JOB_CATALOG = [ { category, titles:[...] }, ... ].
// Derived from common O*NET/SOC occupation families, cleaned into
// human-facing titles and grouped into 27 practical categories
// (479 titles total). Revise a few times a year; when you want
// admin editing or want to mine off-list entries, port to a DB table.
//
// Helpers:
//   jobCatalogAll()            -> flat [{title, category}] list
//   jobCatalogSearch(q, limit) -> ranked matches for a query string
//   jobMountTypeahead(input, opts) -> wire an <input> to a suggestion
//                                     dropdown (recommend-but-allow-any)
// =====================================================================

const JOB_CATALOG = [
  { category: "Software & Engineering", titles: [
    "Software Engineer", "Software Developer", "Frontend Developer", "Backend Developer",
    "Full Stack Developer", "Mobile Developer", "iOS Developer", "Android Developer",
    "Web Developer", "Game Developer", "Embedded Systems Engineer", "Firmware Engineer",
    "DevOps Engineer", "Site Reliability Engineer", "Platform Engineer", "Cloud Engineer",
    "Systems Engineer", "Software Architect", "Solutions Architect", "Engineering Manager",
    "QA Engineer", "Test Automation Engineer", "Release Engineer", "Build Engineer",
    "API Developer", "Integration Engineer", "Application Developer", "Systems Programmer",
  ] },
  { category: "Data & AI", titles: [
    "Data Scientist", "Data Analyst", "Data Engineer", "Machine Learning Engineer",
    "AI Engineer", "Research Scientist", "Applied Scientist", "Analytics Engineer",
    "Business Intelligence Analyst", "Database Administrator", "Database Engineer",
    "Big Data Engineer", "MLOps Engineer", "Computer Vision Engineer", "NLP Engineer",
    "Quantitative Analyst", "Statistician", "Data Architect", "Deep Learning Engineer",
  ] },
  { category: "IT & Infrastructure", titles: [
    "IT Support Specialist", "Help Desk Technician", "Network Engineer",
    "Network Administrator", "Systems Administrator", "IT Manager",
    "Infrastructure Engineer", "Cloud Administrator", "IT Consultant",
    "Desktop Support Technician", "Technical Support Engineer", "IT Director",
    "Telecommunications Specialist", "Field Service Technician",
  ] },
  { category: "Cybersecurity", titles: [
    "Security Engineer", "Security Analyst", "Information Security Analyst",
    "Penetration Tester", "Security Architect", "SOC Analyst", "Incident Responder",
    "Cybersecurity Consultant", "Chief Information Security Officer", "Cryptographer",
    "Compliance Analyst", "GRC Analyst",
  ] },
  { category: "Design & Creative", titles: [
    "Graphic Designer", "UX Designer", "UI Designer", "Product Designer", "UX Researcher",
    "Web Designer", "Visual Designer", "Interaction Designer", "Motion Designer",
    "Art Director", "Creative Director", "Illustrator", "Animator", "Industrial Designer",
    "Brand Designer", "Design Manager", "Design Lead", "3D Artist", "Game Artist",
  ] },
  { category: "Product & Project", titles: [
    "Product Manager", "Senior Product Manager", "Product Owner", "Program Manager",
    "Project Manager", "Technical Program Manager", "Scrum Master", "Agile Coach",
    "Product Marketing Manager", "Associate Product Manager", "Group Product Manager",
    "Chief Product Officer", "Project Coordinator", "Delivery Manager",
  ] },
  { category: "Marketing & Communications", titles: [
    "Marketing Manager", "Digital Marketing Manager", "Content Marketing Manager",
    "SEO Specialist", "SEM Specialist", "Social Media Manager", "Content Strategist",
    "Copywriter", "Content Writer", "Brand Manager", "Growth Marketer",
    "Email Marketing Manager", "Marketing Analyst", "Public Relations Manager",
    "Communications Manager", "Marketing Coordinator", "Marketing Director",
    "Chief Marketing Officer", "Community Manager", "Influencer Marketing Manager",
    "Demand Generation Manager", "Marketing Specialist", "PR Specialist", "Media Planner",
  ] },
  { category: "Sales & Business Development", titles: [
    "Sales Representative", "Account Executive", "Sales Manager",
    "Business Development Manager", "Sales Development Representative", "Account Manager",
    "Regional Sales Manager", "Sales Director", "Inside Sales Representative",
    "Enterprise Account Executive", "Sales Engineer", "Customer Success Manager",
    "Sales Operations Manager", "Channel Sales Manager", "VP of Sales",
    "Chief Revenue Officer", "Territory Manager", "Key Account Manager",
    "Retail Sales Associate", "Solutions Consultant",
  ] },
  { category: "Customer Support & Service", titles: [
    "Customer Support Representative", "Customer Service Representative",
    "Technical Support Specialist", "Customer Success Specialist", "Support Team Lead",
    "Call Center Agent", "Client Services Manager", "Customer Experience Manager",
    "Support Engineer", "Help Desk Manager",
  ] },
  { category: "Finance & Accounting", titles: [
    "Accountant", "Financial Analyst", "Controller", "Chief Financial Officer", "Bookkeeper",
    "Auditor", "Tax Accountant", "Financial Advisor", "Investment Analyst",
    "Portfolio Manager", "Treasury Analyst", "Accounts Payable Specialist",
    "Accounts Receivable Specialist", "Payroll Specialist", "Finance Manager",
    "Budget Analyst", "Credit Analyst", "Actuary", "Investment Banker", "Financial Planner",
    "Cost Accountant", "Revenue Analyst", "Risk Analyst",
  ] },
  { category: "Human Resources", titles: [
    "HR Manager", "HR Generalist", "Recruiter", "Technical Recruiter",
    "Talent Acquisition Specialist", "HR Business Partner", "People Operations Manager",
    "Compensation Analyst", "Benefits Administrator", "HR Coordinator", "HR Director",
    "Chief People Officer", "Learning and Development Manager", "Employee Relations Manager",
    "Diversity and Inclusion Manager", "HR Specialist",
  ] },
  { category: "Operations & Management", titles: [
    "Operations Manager", "Chief Executive Officer", "Chief Operating Officer",
    "General Manager", "Business Analyst", "Operations Analyst",
    "Business Operations Manager", "Management Consultant", "Strategy Manager",
    "Chief of Staff", "Office Manager", "Executive Assistant", "Administrative Assistant",
    "Operations Coordinator", "Process Improvement Manager", "Facilities Manager",
    "Vice President of Operations",
  ] },
  { category: "Supply Chain & Logistics", titles: [
    "Supply Chain Manager", "Logistics Coordinator", "Warehouse Manager",
    "Procurement Manager", "Purchasing Manager", "Inventory Manager", "Supply Chain Analyst",
    "Logistics Manager", "Fleet Manager", "Distribution Manager", "Materials Manager",
    "Demand Planner", "Buyer",
  ] },
  { category: "Healthcare & Medical", titles: [
    "Registered Nurse", "Physician", "Nurse Practitioner", "Physician Assistant",
    "Medical Assistant", "Pharmacist", "Physical Therapist", "Occupational Therapist",
    "Dentist", "Dental Hygienist", "Radiologic Technologist", "Surgeon", "Anesthesiologist",
    "Pediatrician", "Psychiatrist", "Licensed Practical Nurse",
    "Certified Nursing Assistant", "Respiratory Therapist", "Speech-Language Pathologist",
    "Medical Laboratory Technician", "Paramedic", "Emergency Medical Technician",
    "Phlebotomist", "Healthcare Administrator", "Clinical Research Coordinator",
    "Optometrist", "Chiropractor", "Veterinarian", "Veterinary Technician",
    "Home Health Aide", "Midwife", "Dietitian",
  ] },
  { category: "Mental Health & Social Services", titles: [
    "Therapist", "Counselor", "Clinical Psychologist", "Social Worker",
    "Marriage and Family Therapist", "Substance Abuse Counselor", "School Counselor",
    "Case Manager", "Behavioral Therapist", "Mental Health Counselor",
    "Rehabilitation Counselor", "Community Health Worker",
  ] },
  { category: "Education & Training", titles: [
    "Teacher", "Elementary School Teacher", "High School Teacher", "Professor", "Lecturer",
    "Teaching Assistant", "Instructional Designer", "Corporate Trainer", "Tutor",
    "Special Education Teacher", "School Principal", "Curriculum Developer",
    "Academic Advisor", "Education Coordinator", "Preschool Teacher", "ESL Teacher",
    "Librarian", "Training Manager", "Dean", "Substitute Teacher",
  ] },
  { category: "Legal", titles: [
    "Lawyer", "Attorney", "Paralegal", "Legal Assistant", "Corporate Counsel",
    "General Counsel", "Compliance Officer", "Contract Manager", "Legal Secretary",
    "Patent Attorney", "Litigation Attorney", "Judge", "Legal Analyst", "Court Reporter",
    "Mediator",
  ] },
  { category: "Engineering (Non-Software)", titles: [
    "Mechanical Engineer", "Electrical Engineer", "Civil Engineer", "Chemical Engineer",
    "Aerospace Engineer", "Industrial Engineer", "Structural Engineer",
    "Environmental Engineer", "Biomedical Engineer", "Manufacturing Engineer",
    "Process Engineer", "Materials Engineer", "Petroleum Engineer", "Nuclear Engineer",
    "Automotive Engineer", "Robotics Engineer", "Project Engineer", "Quality Engineer",
    "Design Engineer", "Field Engineer", "Marine Engineer",
  ] },
  { category: "Skilled Trades & Construction", titles: [
    "Electrician", "Plumber", "Carpenter", "Welder", "HVAC Technician",
    "Construction Manager", "General Contractor", "Construction Worker", "Painter", "Mason",
    "Roofer", "Heavy Equipment Operator", "Machinist", "Auto Mechanic", "Diesel Mechanic",
    "Maintenance Technician", "Site Supervisor", "Estimator", "Surveyor", "Ironworker",
    "Pipefitter", "Millwright", "Landscaper",
  ] },
  { category: "Manufacturing & Production", titles: [
    "Production Manager", "Manufacturing Manager", "Assembly Line Worker",
    "Production Supervisor", "Quality Control Inspector", "Plant Manager",
    "Machine Operator", "Production Planner", "Fabricator", "Tool and Die Maker",
    "Manufacturing Technician", "Line Lead",
  ] },
  { category: "Science & Research", titles: [
    "Research Scientist", "Biologist", "Chemist", "Physicist", "Microbiologist",
    "Biochemist", "Lab Technician", "Research Assistant", "Clinical Research Associate",
    "Environmental Scientist", "Geologist", "Marine Biologist", "Epidemiologist",
    "Molecular Biologist", "Toxicologist", "Food Scientist", "Materials Scientist",
    "Astronomer", "Meteorologist", "Ecologist",
  ] },
  { category: "Media, Writing & Entertainment", titles: [
    "Journalist", "Editor", "Writer", "Author", "Technical Writer", "Content Creator",
    "Video Editor", "Photographer", "Videographer", "Producer", "Podcast Producer",
    "Screenwriter", "Reporter", "Broadcast Journalist", "Proofreader", "Grant Writer",
    "Scriptwriter", "Sound Engineer", "Film Director", "Camera Operator", "Voice Actor",
    "Musician", "Music Producer",
  ] },
  { category: "Hospitality, Food & Travel", titles: [
    "Chef", "Sous Chef", "Line Cook", "Pastry Chef", "Restaurant Manager", "Bartender",
    "Server", "Barista", "Hotel Manager", "Event Planner", "Catering Manager",
    "Housekeeping Manager", "Concierge", "Travel Agent", "Flight Attendant", "Sommelier",
    "Food Service Manager", "Host",
  ] },
  { category: "Retail & Consumer", titles: [
    "Retail Manager", "Store Manager", "Sales Associate", "Cashier", "Visual Merchandiser",
    "Merchandiser", "Buyer", "Retail Supervisor", "Loss Prevention Specialist",
    "Assistant Store Manager", "District Manager", "Stock Associate", "E-commerce Manager",
    "Category Manager",
  ] },
  { category: "Public Sector, Safety & Government", titles: [
    "Police Officer", "Firefighter", "Paramedic", "Military Officer", "Government Analyst",
    "Policy Analyst", "Urban Planner", "City Manager", "Public Health Official",
    "Corrections Officer", "Detective", "Security Guard", "Customs Officer", "Diplomat",
    "Intelligence Analyst", "Emergency Management Director", "Postal Worker",
    "Air Traffic Controller",
  ] },
  { category: "Real Estate & Property", titles: [
    "Real Estate Agent", "Real Estate Broker", "Property Manager", "Leasing Consultant",
    "Real Estate Appraiser", "Mortgage Broker", "Loan Officer", "Real Estate Developer",
    "Facilities Coordinator", "Escrow Officer",
  ] },
  { category: "Agriculture & Environment", titles: [
    "Farmer", "Agricultural Technician", "Farm Manager", "Horticulturist", "Agronomist",
    "Forester", "Conservation Scientist", "Fisheries Biologist", "Rancher",
    "Landscape Architect", "Environmental Consultant", "Sustainability Manager",
  ] },
];

// Flat, memoized [{title, category}] view of the catalog.
let _jobFlat = null;
function jobCatalogAll() {
  if (_jobFlat) return _jobFlat;
  _jobFlat = [];
  for (const grp of JOB_CATALOG) {
    for (const t of grp.titles) _jobFlat.push({ title: t, category: grp.category });
  }
  return _jobFlat;
}

// Rank matches for a query. Prefix matches beat word-boundary matches,
// which beat plain substring matches; ties broken alphabetically.
function jobCatalogSearch(q, limit) {
  limit = limit || 8;
  const needle = (q || "").trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const item of jobCatalogAll()) {
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

// Wire a text <input> to a live suggestion dropdown. Users can pick a
// suggestion OR keep whatever they typed (recommend-but-allow-anything).
//
//   input : the <input type="text"> element
//   opts  : { onPick?(title), minChars?=2, limit?=8 }
//
// The dropdown is appended to the input's parent, which should be
// position:relative (the .job-ta-wrap class handles this).
function jobMountTypeahead(input, opts) {
  opts = opts || {};
  const minChars = opts.minChars != null ? opts.minChars : 2;
  const limit    = opts.limit || 8;

  const wrap = input.parentElement;
  if (wrap && !wrap.classList.contains("job-ta-wrap")) {
    wrap.classList.add("job-ta-wrap");
  }

  const menu = document.createElement("div");
  menu.className = "job-ta-menu";
  menu.style.display = "none";
  (wrap || input.parentNode).appendChild(menu);

  let active = -1;
  let items = [];

  const close = () => { menu.style.display = "none"; active = -1; };

  const render = () => {
    const q = input.value;
    if (q.trim().length < minChars) { close(); return; }
    items = jobCatalogSearch(q, limit);
    if (!items.length) { close(); return; }
    menu.innerHTML = items.map((it, i) => `
      <div class="job-ta-item${i === active ? " active" : ""}" data-i="${i}">
        <span class="job-ta-title"></span>
        <span class="job-ta-cat"></span>
      </div>`).join("");
    // Fill text via textContent to avoid any injection from titles.
    [...menu.querySelectorAll(".job-ta-item")].forEach((row, i) => {
      row.querySelector(".job-ta-title").textContent = items[i].title;
      row.querySelector(".job-ta-cat").textContent = items[i].category;
      row.onmousedown = (e) => { e.preventDefault(); pick(i); };
    });
    menu.style.display = "block";
  };

  const pick = (i) => {
    if (i < 0 || i >= items.length) return;
    input.value = items[i].title;
    if (opts.onPick) opts.onPick(items[i].title);
    close();
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (menu.style.display === "none") return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") { close(); }
  });

  return { close, refresh: render };
}

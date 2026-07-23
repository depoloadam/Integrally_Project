// =====================================================================
// FILE: assets/js/certs-catalog.js
// ---------------------------------------------------------------------
// The certification catalog — single source of truth for:
//   1. The cert-name typeahead in the profile "Add certification" modal
//      (certCatalogSearch, rendered by jobMountTypeahead).
//   2. src/CertCatalog.php, GENERATED from this file by
//      tools/generate-cert-catalog.js (run it after every edit here) —
//      which the score engine uses to relevance-weight certifications.
//
// Entry shape: { name, issuer?, cats:[category names], aliases?:[...] }.
// - name is the canonical display name the typeahead inserts.
// - aliases are lowercase match strings: acronym forms, family patterns
//   ("aws certified" catches every AWS cert, cataloged or not), and
//   disambiguators ("american welding society" ≠ Amazon's "AWS").
// - cats use JobCatalog category NAMES (validated by the generator).
//
// CERT_TOKENS handles the long tail: thousands of certifications exist
// and this list never will be complete, so single-word domain/vendor
// vocabulary gives partial-to-full credit to uncataloged certs ("Fortinet
// NSE 4 Network Security" hits 'fortinet' + 'network' + 'security').
// The PHP side additionally falls back to the education field map for
// certs phrased like fields of study ("Certificate in Accounting").
// =====================================================================

const CERT_CATALOG = [
  { group: "Software, Cloud & DevOps", certs: [
    { name: "AWS Certified Solutions Architect – Associate", issuer: "Amazon Web Services", cats: ["Software & Engineering","IT & Infrastructure"], aliases: ["aws certified","solutions architect","aws csa"] },
    { name: "AWS Certified Solutions Architect – Professional", issuer: "Amazon Web Services", cats: ["Software & Engineering","IT & Infrastructure"] },
    { name: "AWS Certified Developer – Associate", issuer: "Amazon Web Services", cats: ["Software & Engineering","IT & Infrastructure"] },
    { name: "AWS Certified SysOps Administrator", issuer: "Amazon Web Services", cats: ["IT & Infrastructure","Software & Engineering"] },
    { name: "AWS Certified Cloud Practitioner", issuer: "Amazon Web Services", cats: ["IT & Infrastructure","Software & Engineering"] },
    { name: "Microsoft Certified: Azure Fundamentals (AZ-900)", issuer: "Microsoft", cats: ["IT & Infrastructure","Software & Engineering"], aliases: ["azure fundamentals","az-900","az900"] },
    { name: "Microsoft Certified: Azure Administrator (AZ-104)", issuer: "Microsoft", cats: ["IT & Infrastructure"], aliases: ["azure administrator","az-104","az104"] },
    { name: "Microsoft Certified: Azure Solutions Architect (AZ-305)", issuer: "Microsoft", cats: ["IT & Infrastructure","Software & Engineering"], aliases: ["az-305","az305"] },
    { name: "Google Cloud Professional Cloud Architect", issuer: "Google Cloud", cats: ["IT & Infrastructure","Software & Engineering"], aliases: ["gcp","google cloud certified"] },
    { name: "Google Cloud Associate Cloud Engineer", issuer: "Google Cloud", cats: ["IT & Infrastructure","Software & Engineering"] },
    { name: "Certified Kubernetes Administrator (CKA)", issuer: "Cloud Native Computing Foundation", cats: ["Software & Engineering","IT & Infrastructure"], aliases: ["cka","kubernetes"] },
    { name: "Certified Kubernetes Application Developer (CKAD)", issuer: "Cloud Native Computing Foundation", cats: ["Software & Engineering","IT & Infrastructure"], aliases: ["ckad"] },
    { name: "HashiCorp Certified: Terraform Associate", issuer: "HashiCorp", cats: ["IT & Infrastructure","Software & Engineering"], aliases: ["terraform"] },
    { name: "Docker Certified Associate", issuer: "Docker", cats: ["Software & Engineering","IT & Infrastructure"], aliases: ["docker"] },
    { name: "Red Hat Certified System Administrator (RHCSA)", issuer: "Red Hat", cats: ["IT & Infrastructure"], aliases: ["rhcsa","red hat"] },
    { name: "Red Hat Certified Engineer (RHCE)", issuer: "Red Hat", cats: ["IT & Infrastructure"], aliases: ["rhce"] },
    { name: "Oracle Certified Professional: Java SE Developer", issuer: "Oracle", cats: ["Software & Engineering"], aliases: ["oracle certified","java se","ocjp","ocp java"] },
    { name: "ISTQB Certified Tester Foundation Level", issuer: "ISTQB", cats: ["Software & Engineering"], aliases: ["istqb"] },
    { name: "Cisco Certified DevNet Associate", issuer: "Cisco", cats: ["Software & Engineering","IT & Infrastructure"], aliases: ["devnet"] },
    { name: "Salesforce Certified Platform Developer I", issuer: "Salesforce", cats: ["Software & Engineering","IT & Infrastructure"] },
    { name: "Unity Certified Programmer", issuer: "Unity", cats: ["Software & Engineering"] },
  ]},
  { group: "Data & AI", certs: [
    { name: "Tableau Desktop Specialist", issuer: "Tableau", cats: ["Data & AI"], aliases: ["tableau"] },
    { name: "Microsoft Certified: Power BI Data Analyst (PL-300)", issuer: "Microsoft", cats: ["Data & AI"], aliases: ["power bi","pl-300","pl300"] },
    { name: "Databricks Certified Data Engineer Associate", issuer: "Databricks", cats: ["Data & AI"], aliases: ["databricks"] },
    { name: "Google Data Analytics Professional Certificate", issuer: "Google", cats: ["Data & AI"] },
    { name: "AWS Certified Data Engineer – Associate", issuer: "Amazon Web Services", cats: ["Data & AI","Software & Engineering"] },
    { name: "TensorFlow Developer Certificate", issuer: "Google", cats: ["Data & AI"], aliases: ["tensorflow"] },
    { name: "Cloudera Data Platform Certification", issuer: "Cloudera", cats: ["Data & AI"] },
    { name: "SAS Certified Specialist: Base Programming", issuer: "SAS", cats: ["Data & AI","Science & Research"] },
  ]},
  { group: "IT & Networking", certs: [
    { name: "CompTIA A+", issuer: "CompTIA", cats: ["IT & Infrastructure"], aliases: ["a+","comptia a+"] },
    { name: "CompTIA Network+", issuer: "CompTIA", cats: ["IT & Infrastructure"], aliases: ["network+"] },
    { name: "CompTIA Cloud+", issuer: "CompTIA", cats: ["IT & Infrastructure"], aliases: ["cloud+"] },
    { name: "CompTIA Linux+", issuer: "CompTIA", cats: ["IT & Infrastructure"], aliases: ["linux+"] },
    { name: "CompTIA Server+", issuer: "CompTIA", cats: ["IT & Infrastructure"], aliases: ["server+"] },
    { name: "CCNA", issuer: "Cisco", cats: ["IT & Infrastructure","Cybersecurity"], aliases: ["cisco certified network associate"] },
    { name: "CCNP Enterprise", issuer: "Cisco", cats: ["IT & Infrastructure","Cybersecurity"], aliases: ["ccnp"] },
    { name: "CCIE", issuer: "Cisco", cats: ["IT & Infrastructure"], aliases: ["cisco certified internetwork expert"] },
    { name: "Juniper Networks Certified Associate (JNCIA)", issuer: "Juniper Networks", cats: ["IT & Infrastructure"], aliases: ["jncia","juniper"] },
    { name: "Palo Alto Networks PCNSA", issuer: "Palo Alto Networks", cats: ["Cybersecurity","IT & Infrastructure"], aliases: ["pcnsa","palo alto"] },
    { name: "Palo Alto Networks PCNSE", issuer: "Palo Alto Networks", cats: ["Cybersecurity","IT & Infrastructure"], aliases: ["pcnse"] },
    { name: "Fortinet NSE 4", issuer: "Fortinet", cats: ["Cybersecurity","IT & Infrastructure"], aliases: ["nse 4","fortinet nse"] },
    { name: "VMware Certified Professional (VCP)", issuer: "VMware", cats: ["IT & Infrastructure"], aliases: ["vcp","vmware"] },
    { name: "ITIL 4 Foundation", issuer: "PeopleCert", cats: ["IT & Infrastructure","Operations & Management"], aliases: ["itil"] },
    { name: "Microsoft 365 Certified: Fundamentals", issuer: "Microsoft", cats: ["IT & Infrastructure"], aliases: ["microsoft certified","microsoft 365"] },
    { name: "Microsoft Office Specialist", issuer: "Microsoft", cats: ["IT & Infrastructure","Operations & Management"] },
    { name: "Apple Certified Support Professional", issuer: "Apple", cats: ["IT & Infrastructure","Customer Support & Service"] },
    { name: "Google IT Support Professional Certificate", issuer: "Google", cats: ["IT & Infrastructure","Customer Support & Service"], aliases: ["it support"] },
    { name: "ServiceNow Certified System Administrator", issuer: "ServiceNow", cats: ["IT & Infrastructure"], aliases: ["servicenow"] },
    { name: "Linux Professional Institute LPIC-1", issuer: "Linux Professional Institute", cats: ["IT & Infrastructure"], aliases: ["lpic"] },
  ]},
  { group: "Cybersecurity", certs: [
    { name: "CompTIA Security+", issuer: "CompTIA", cats: ["Cybersecurity"], aliases: ["security+"] },
    { name: "CompTIA CySA+", issuer: "CompTIA", cats: ["Cybersecurity"], aliases: ["cysa","cysa+"] },
    { name: "CompTIA PenTest+", issuer: "CompTIA", cats: ["Cybersecurity"], aliases: ["pentest","pentest+"] },
    { name: "CISSP", issuer: "ISC2", cats: ["Cybersecurity"], aliases: ["certified information systems security professional"] },
    { name: "CISM", issuer: "ISACA", cats: ["Cybersecurity"], aliases: ["certified information security manager"] },
    { name: "CISA", issuer: "ISACA", cats: ["Cybersecurity","Finance & Accounting"], aliases: ["certified information systems auditor"] },
    { name: "Certified Ethical Hacker (CEH)", issuer: "EC-Council", cats: ["Cybersecurity"], aliases: ["ceh"] },
    { name: "OSCP", issuer: "OffSec", cats: ["Cybersecurity"], aliases: ["offensive security certified professional"] },
    { name: "GIAC Security Essentials (GSEC)", issuer: "GIAC", cats: ["Cybersecurity"], aliases: ["giac","gsec"] },
    { name: "Systems Security Certified Practitioner (SSCP)", issuer: "ISC2", cats: ["Cybersecurity"], aliases: ["sscp"] },
  ]},
  { group: "Product & Project", certs: [
    { name: "Project Management Professional (PMP)", issuer: "PMI", cats: ["Product & Project","Operations & Management"], aliases: ["pmp"] },
    { name: "Certified Associate in Project Management (CAPM)", issuer: "PMI", cats: ["Product & Project","Operations & Management"], aliases: ["capm"] },
    { name: "PMI Agile Certified Practitioner (PMI-ACP)", issuer: "PMI", cats: ["Product & Project"], aliases: ["pmi-acp","acp"] },
    { name: "PRINCE2 Foundation", issuer: "Axelos", cats: ["Product & Project","Operations & Management"], aliases: ["prince2"] },
    { name: "Certified ScrumMaster (CSM)", issuer: "Scrum Alliance", cats: ["Product & Project"], aliases: ["csm","certified scrum master","scrummaster"] },
    { name: "Professional Scrum Master (PSM I)", issuer: "Scrum.org", cats: ["Product & Project"], aliases: ["psm"] },
    { name: "Certified Scrum Product Owner (CSPO)", issuer: "Scrum Alliance", cats: ["Product & Project"], aliases: ["cspo","product owner"] },
    { name: "SAFe Agilist", issuer: "Scaled Agile", cats: ["Product & Project"], aliases: ["safe agilist","safe"] },
  ]},
  { group: "Design & Creative", certs: [
    { name: "Adobe Certified Professional: Photoshop", issuer: "Adobe", cats: ["Design & Creative"], aliases: ["adobe certified","photoshop"] },
    { name: "Adobe Certified Professional: Illustrator", issuer: "Adobe", cats: ["Design & Creative"], aliases: ["illustrator"] },
    { name: "Google UX Design Professional Certificate", issuer: "Google", cats: ["Design & Creative"], aliases: ["ux design"] },
    { name: "Autodesk Certified Professional: AutoCAD", issuer: "Autodesk", cats: ["Design & Creative","Engineering (Non-Software)"], aliases: ["autocad"] },
    { name: "Certified SOLIDWORKS Associate (CSWA)", issuer: "Dassault Systèmes", cats: ["Engineering (Non-Software)","Manufacturing & Production"], aliases: ["solidworks","cswa"] },
  ]},
  { group: "Marketing & Sales", certs: [
    { name: "Google Analytics Certification", issuer: "Google", cats: ["Marketing & Communications","Data & AI"], aliases: ["google analytics"] },
    { name: "Google Ads Search Certification", issuer: "Google", cats: ["Marketing & Communications"], aliases: ["google ads"] },
    { name: "HubSpot Inbound Marketing Certification", issuer: "HubSpot", cats: ["Marketing & Communications","Sales & Business Development"], aliases: ["hubspot"] },
    { name: "Meta Certified Digital Marketing Associate", issuer: "Meta", cats: ["Marketing & Communications"], aliases: ["digital marketing"] },
    { name: "Salesforce Certified Administrator", issuer: "Salesforce", cats: ["Sales & Business Development","IT & Infrastructure"], aliases: ["salesforce"] },
    { name: "Certified Professional Sales Person (CPSP)", issuer: "NASP", cats: ["Sales & Business Development"], aliases: ["cpsp"] },
  ]},
  { group: "Finance & Accounting", certs: [
    { name: "Certified Public Accountant (CPA)", issuer: "AICPA", cats: ["Finance & Accounting"], aliases: ["cpa"] },
    { name: "Chartered Financial Analyst (CFA)", issuer: "CFA Institute", cats: ["Finance & Accounting"], aliases: ["cfa"] },
    { name: "Certified Management Accountant (CMA)", issuer: "IMA", cats: ["Finance & Accounting"], aliases: ["cma"] },
    { name: "Enrolled Agent (EA)", issuer: "IRS", cats: ["Finance & Accounting"], aliases: ["enrolled agent"] },
    { name: "Certified Internal Auditor (CIA)", issuer: "IIA", cats: ["Finance & Accounting"], aliases: ["certified internal auditor"] },
    { name: "FINRA Series 7", issuer: "FINRA", cats: ["Finance & Accounting"], aliases: ["series 7","finra"] },
    { name: "FINRA Series 63", issuer: "FINRA", cats: ["Finance & Accounting"], aliases: ["series 63"] },
    { name: "FINRA Series 65", issuer: "FINRA", cats: ["Finance & Accounting"], aliases: ["series 65"] },
    { name: "Financial Risk Manager (FRM)", issuer: "GARP", cats: ["Finance & Accounting"], aliases: ["frm"] },
    { name: "QuickBooks Certified User", issuer: "Intuit", cats: ["Finance & Accounting"], aliases: ["quickbooks"] },
    { name: "Certified Bookkeeper", issuer: "AIPB", cats: ["Finance & Accounting"], aliases: ["bookkeeper"] },
    { name: "Certified Financial Planner (CFP)", issuer: "CFP Board", cats: ["Finance & Accounting"], aliases: ["cfp"] },
    { name: "Associate of the Society of Actuaries (ASA)", issuer: "SOA", cats: ["Finance & Accounting"], aliases: ["actuarial","actuary"] },
  ]},
  { group: "Human Resources", certs: [
    { name: "SHRM Certified Professional (SHRM-CP)", issuer: "SHRM", cats: ["Human Resources"], aliases: ["shrm","shrm-cp"] },
    { name: "SHRM Senior Certified Professional (SHRM-SCP)", issuer: "SHRM", cats: ["Human Resources"], aliases: ["shrm-scp"] },
    { name: "Professional in Human Resources (PHR)", issuer: "HRCI", cats: ["Human Resources"], aliases: ["phr"] },
    { name: "Senior Professional in Human Resources (SPHR)", issuer: "HRCI", cats: ["Human Resources"], aliases: ["sphr"] },
    { name: "Certified Payroll Professional (CPP)", issuer: "PayrollOrg", cats: ["Human Resources","Finance & Accounting"], aliases: ["payroll"] },
  ]},
  { group: "Operations, Quality & Manufacturing", certs: [
    { name: "Lean Six Sigma Green Belt", issuer: "", cats: ["Operations & Management","Manufacturing & Production"], aliases: ["six sigma","green belt"] },
    { name: "Lean Six Sigma Black Belt", issuer: "", cats: ["Operations & Management","Manufacturing & Production"], aliases: ["black belt"] },
    { name: "Certified Supply Chain Professional (CSCP)", issuer: "ASCM", cats: ["Supply Chain & Logistics"], aliases: ["cscp","apics"] },
    { name: "Certified in Planning and Inventory Management (CPIM)", issuer: "ASCM", cats: ["Supply Chain & Logistics","Manufacturing & Production"], aliases: ["cpim"] },
    { name: "Certified Quality Engineer (CQE)", issuer: "ASQ", cats: ["Manufacturing & Production"], aliases: ["cqe","certified quality"] },
    { name: "Certified Production Technician (CPT)", issuer: "MSSC", cats: ["Manufacturing & Production"] },
    { name: "CNC Machining Certification (NIMS)", issuer: "NIMS", cats: ["Manufacturing & Production"], aliases: ["nims","cnc"] },
  ]},
  { group: "Transportation & Logistics", certs: [
    { name: "CDL Class A", issuer: "", cats: ["Supply Chain & Logistics"], aliases: ["cdl","commercial driver's license","commercial driver license"] },
    { name: "CDL Class B", issuer: "", cats: ["Supply Chain & Logistics"] },
    { name: "Forklift Operator Certification", issuer: "", cats: ["Supply Chain & Logistics","Manufacturing & Production"], aliases: ["forklift"] },
    { name: "TWIC Card", issuer: "TSA", cats: ["Supply Chain & Logistics","Public Sector, Safety & Government"], aliases: ["twic"] },
    { name: "FAA Private Pilot License", issuer: "FAA", cats: ["Supply Chain & Logistics"], aliases: ["private pilot","faa"] },
    { name: "FAA Commercial Pilot License", issuer: "FAA", cats: ["Supply Chain & Logistics"], aliases: ["commercial pilot"] },
    { name: "FAA Airframe and Powerplant (A&P)", issuer: "FAA", cats: ["Engineering (Non-Software)","Supply Chain & Logistics"], aliases: ["a&p mechanic","airframe and powerplant"] },
    { name: "FAA Part 107 Remote Pilot (Drone)", issuer: "FAA", cats: ["Supply Chain & Logistics","Media, Writing & Entertainment"], aliases: ["part 107","drone"] },
  ]},
  { group: "Healthcare", certs: [
    { name: "NCLEX-RN", issuer: "NCSBN", cats: ["Healthcare & Medical"], aliases: ["nclex","registered nurse license","rn license"] },
    { name: "NCLEX-PN", issuer: "NCSBN", cats: ["Healthcare & Medical"] },
    { name: "Basic Life Support (BLS)", issuer: "American Heart Association", cats: ["Healthcare & Medical","Public Sector, Safety & Government"], aliases: ["bls"] },
    { name: "Advanced Cardiovascular Life Support (ACLS)", issuer: "American Heart Association", cats: ["Healthcare & Medical"], aliases: ["acls"] },
    { name: "Pediatric Advanced Life Support (PALS)", issuer: "American Heart Association", cats: ["Healthcare & Medical"], aliases: ["pals"] },
    { name: "Certified Nursing Assistant (CNA)", issuer: "", cats: ["Healthcare & Medical"], aliases: ["cna"] },
    { name: "Certified Medical Assistant (CMA)", issuer: "AAMA", cats: ["Healthcare & Medical"], aliases: ["ccma","medical assistant"] },
    { name: "Certified Phlebotomy Technician (CPT)", issuer: "NHA", cats: ["Healthcare & Medical"], aliases: ["phlebotomy"] },
    { name: "Certified Pharmacy Technician (CPhT)", issuer: "PTCB", cats: ["Healthcare & Medical"], aliases: ["cpht","pharmacy technician"] },
    { name: "EMT Certification (NREMT)", issuer: "NREMT", cats: ["Healthcare & Medical","Public Sector, Safety & Government"], aliases: ["emt","nremt"] },
    { name: "Paramedic Certification", issuer: "NREMT", cats: ["Healthcare & Medical","Public Sector, Safety & Government"], aliases: ["paramedic"] },
    { name: "Registered Health Information Technician (RHIT)", issuer: "AHIMA", cats: ["Healthcare & Medical","IT & Infrastructure"], aliases: ["rhit"] },
    { name: "ARRT Radiography Certification", issuer: "ARRT", cats: ["Healthcare & Medical"], aliases: ["radiologic","radiography","arrt"] },
    { name: "Certified Dental Assistant (CDA)", issuer: "DANB", cats: ["Healthcare & Medical"], aliases: ["dental assistant"] },
    { name: "CPR Certification", issuer: "American Red Cross", cats: ["Healthcare & Medical","Public Sector, Safety & Government"], aliases: ["cpr"] },
    { name: "First Aid Certification", issuer: "American Red Cross", cats: ["Healthcare & Medical","Public Sector, Safety & Government"], aliases: ["first aid"] },
    { name: "NASM Certified Personal Trainer", issuer: "NASM", cats: ["Healthcare & Medical"], aliases: ["nasm","personal trainer","cpt fitness"] },
    { name: "ACE Certified Personal Trainer", issuer: "ACE", cats: ["Healthcare & Medical"], aliases: ["ace certified"] },
    { name: "Registered Dietitian Nutritionist (RDN)", issuer: "CDR", cats: ["Healthcare & Medical"], aliases: ["dietitian"] },
  ]},
  { group: "Mental Health & Social Services", certs: [
    { name: "Licensed Clinical Social Worker (LCSW)", issuer: "", cats: ["Mental Health & Social Services"], aliases: ["lcsw"] },
    { name: "Licensed Professional Counselor (LPC)", issuer: "", cats: ["Mental Health & Social Services"], aliases: ["lpc"] },
    { name: "Certified Alcohol and Drug Counselor (CADC)", issuer: "", cats: ["Mental Health & Social Services"], aliases: ["cadc"] },
    { name: "Board Certified Behavior Analyst (BCBA)", issuer: "BACB", cats: ["Mental Health & Social Services"], aliases: ["bcba"] },
  ]},
  { group: "Education", certs: [
    { name: "State Teaching License", issuer: "", cats: ["Education & Training"], aliases: ["teaching license","teaching certificate","teacher certification"] },
    { name: "TEFL Certification", issuer: "", cats: ["Education & Training"], aliases: ["tefl"] },
    { name: "TESOL Certification", issuer: "", cats: ["Education & Training"], aliases: ["tesol"] },
    { name: "CELTA", issuer: "Cambridge", cats: ["Education & Training"], aliases: ["celta"] },
    { name: "Praxis Exam Certification", issuer: "ETS", cats: ["Education & Training"], aliases: ["praxis"] },
    { name: "Child Development Associate (CDA Credential)", issuer: "Council for Professional Recognition", cats: ["Education & Training"], aliases: ["child development associate"] },
  ]},
  { group: "Legal & Public Sector", certs: [
    { name: "Bar Admission", issuer: "", cats: ["Legal"], aliases: ["bar exam","attorney license"] },
    { name: "Certified Paralegal (CP)", issuer: "NALA", cats: ["Legal"], aliases: ["paralegal certificate","certified paralegal"] },
    { name: "Notary Public Commission", issuer: "", cats: ["Legal","Public Sector, Safety & Government"], aliases: ["notary"] },
    { name: "Firefighter I & II Certification", issuer: "", cats: ["Public Sector, Safety & Government"], aliases: ["firefighter"] },
    { name: "Police Academy / POST Certification", issuer: "", cats: ["Public Sector, Safety & Government"], aliases: ["police academy","post certification","peace officer"] },
    { name: "Security Guard License (Guard Card)", issuer: "", cats: ["Public Sector, Safety & Government"], aliases: ["security guard","guard card"] },
    { name: "Lifeguard Certification", issuer: "American Red Cross", cats: ["Public Sector, Safety & Government","Hospitality, Food & Travel"], aliases: ["lifeguard"] },
  ]},
  { group: "Engineering & Trades", certs: [
    { name: "Professional Engineer (PE)", issuer: "NCEES", cats: ["Engineering (Non-Software)"], aliases: ["pe license","professional engineer"] },
    { name: "Fundamentals of Engineering (FE)", issuer: "NCEES", cats: ["Engineering (Non-Software)"], aliases: ["fe exam","fundamentals of engineering"] },
    { name: "LEED Green Associate", issuer: "USGBC", cats: ["Skilled Trades & Construction","Engineering (Non-Software)"], aliases: ["leed"] },
    { name: "OSHA 10-Hour", issuer: "OSHA", cats: ["Skilled Trades & Construction","Public Sector, Safety & Government","Manufacturing & Production"], aliases: ["osha 10","osha"] },
    { name: "OSHA 30-Hour", issuer: "OSHA", cats: ["Skilled Trades & Construction","Public Sector, Safety & Government","Manufacturing & Production"], aliases: ["osha 30"] },
    { name: "Journeyman Electrician License", issuer: "", cats: ["Skilled Trades & Construction"], aliases: ["journeyman","electrician license"] },
    { name: "Master Electrician License", issuer: "", cats: ["Skilled Trades & Construction"], aliases: ["master electrician"] },
    { name: "EPA Section 608 Certification", issuer: "EPA", cats: ["Skilled Trades & Construction"], aliases: ["epa 608","epa section 608"] },
    { name: "NATE Certification (HVAC)", issuer: "NATE", cats: ["Skilled Trades & Construction"], aliases: ["nate certified","hvac certification"] },
    { name: "Certified Welding Inspector (CWI)", issuer: "American Welding Society", cats: ["Skilled Trades & Construction"], aliases: ["cwi","american welding society","certified welding"] },
    { name: "AWS Certified Welder", issuer: "American Welding Society", cats: ["Skilled Trades & Construction"], aliases: ["certified welder"] },
    { name: "NCCER Core Certification", issuer: "NCCER", cats: ["Skilled Trades & Construction"], aliases: ["nccer"] },
    { name: "ASE Automotive Certification", issuer: "ASE", cats: ["Skilled Trades & Construction","Manufacturing & Production"], aliases: ["ase","automotive service excellence"] },
    { name: "Crane Operator Certification (NCCCO)", issuer: "NCCCO", cats: ["Skilled Trades & Construction"], aliases: ["crane operator","nccco"] },
  ]},
  { group: "Hospitality & Food", certs: [
    { name: "ServSafe Food Protection Manager", issuer: "National Restaurant Association", cats: ["Hospitality, Food & Travel"], aliases: ["servsafe","food protection manager"] },
    { name: "ServSafe Food Handler", issuer: "National Restaurant Association", cats: ["Hospitality, Food & Travel"], aliases: ["food handler"] },
    { name: "TIPS Alcohol Certification", issuer: "360training", cats: ["Hospitality, Food & Travel"], aliases: ["tips certified","alcohol server"] },
    { name: "Certified Sommelier", issuer: "Court of Master Sommeliers", cats: ["Hospitality, Food & Travel"], aliases: ["sommelier"] },
    { name: "Certified Culinarian (CC)", issuer: "American Culinary Federation", cats: ["Hospitality, Food & Travel"], aliases: ["culinary certification","culinarian"] },
    { name: "Certified Hotel Administrator (CHA)", issuer: "AHLEI", cats: ["Hospitality, Food & Travel"], aliases: ["cha"] },
  ]},
  { group: "Retail & Personal Services", certs: [
    { name: "Cosmetology License", issuer: "", cats: ["Retail & Consumer"], aliases: ["cosmetology"] },
    { name: "Barber License", issuer: "", cats: ["Retail & Consumer"], aliases: ["barber"] },
    { name: "Esthetician License", issuer: "", cats: ["Retail & Consumer"], aliases: ["esthetician"] },
    { name: "Certified Retail Management Professional", issuer: "NRF", cats: ["Retail & Consumer"] },
  ]},
  { group: "Real Estate & Insurance", certs: [
    { name: "Real Estate Salesperson License", issuer: "", cats: ["Real Estate & Property"], aliases: ["real estate license","realtor license"] },
    { name: "Real Estate Broker License", issuer: "", cats: ["Real Estate & Property"], aliases: ["broker license"] },
    { name: "Certified Property Manager (CPM)", issuer: "IREM", cats: ["Real Estate & Property"], aliases: ["property management","cpm real estate"] },
    { name: "Licensed Residential Appraiser", issuer: "", cats: ["Real Estate & Property"], aliases: ["appraiser"] },
    { name: "Life and Health Insurance License", issuer: "", cats: ["Finance & Accounting","Real Estate & Property"], aliases: ["life and health","insurance license"] },
    { name: "Property and Casualty Insurance License", issuer: "", cats: ["Finance & Accounting","Real Estate & Property"], aliases: ["property and casualty"] },
  ]},
  { group: "Science, Agriculture & Environment", certs: [
    { name: "Certified Pesticide Applicator", issuer: "", cats: ["Agriculture & Environment"], aliases: ["pesticide applicator"] },
    { name: "ISA Certified Arborist", issuer: "ISA", cats: ["Agriculture & Environment"], aliases: ["arborist"] },
    { name: "Certified Veterinary Technician (CVT)", issuer: "", cats: ["Agriculture & Environment","Healthcare & Medical"], aliases: ["veterinary technician","cvt"] },
    { name: "Wastewater Treatment Operator License", issuer: "", cats: ["Agriculture & Environment","Public Sector, Safety & Government"], aliases: ["wastewater"] },
    { name: "Certified Clinical Research Coordinator (CCRC)", issuer: "ACRP", cats: ["Science & Research","Healthcare & Medical"], aliases: ["clinical research"] },
  ]},
  { group: "Media & Communications", certs: [
    { name: "Accreditation in Public Relations (APR)", issuer: "PRSA", cats: ["Marketing & Communications","Media, Writing & Entertainment"], aliases: ["apr"] },
    { name: "Avid Media Composer Certification", issuer: "Avid", cats: ["Media, Writing & Entertainment"], aliases: ["media composer"] },
  ]},
];

// Domain/vendor vocabulary for certs the catalog doesn't know. Single
// tokens only; matched against the normalized "name issuer" text.
// Deliberately excludes generic cert English ("certified", "associate",
// "professional", "specialist", "advanced", "foundation").
const CERT_TOKENS = {
  // software / cloud / it
  aws: ["Software & Engineering","IT & Infrastructure"],
  azure: ["IT & Infrastructure","Software & Engineering"],
  cloud: ["IT & Infrastructure","Software & Engineering"],
  devops: ["Software & Engineering","IT & Infrastructure"],
  programming: ["Software & Engineering"], developer: ["Software & Engineering"],
  software: ["Software & Engineering"], coding: ["Software & Engineering"],
  python: ["Software & Engineering","Data & AI"], java: ["Software & Engineering"],
  javascript: ["Software & Engineering"], sql: ["Data & AI","Software & Engineering"],
  database: ["Data & AI","IT & Infrastructure"], kubernetes: ["Software & Engineering","IT & Infrastructure"],
  linux: ["IT & Infrastructure","Software & Engineering"], windows: ["IT & Infrastructure"],
  server: ["IT & Infrastructure"], network: ["IT & Infrastructure"],
  networking: ["IT & Infrastructure"], networks: ["IT & Infrastructure"], virtualization: ["IT & Infrastructure"],
  helpdesk: ["IT & Infrastructure","Customer Support & Service"],
  it: ["IT & Infrastructure"],
  cisco: ["IT & Infrastructure","Cybersecurity"], comptia: ["IT & Infrastructure","Cybersecurity"],
  microsoft: ["IT & Infrastructure","Software & Engineering"], oracle: ["IT & Infrastructure","Software & Engineering"],
  vmware: ["IT & Infrastructure"], citrix: ["IT & Infrastructure"],
  fortinet: ["Cybersecurity","IT & Infrastructure"], juniper: ["IT & Infrastructure"],
  splunk: ["Cybersecurity","Data & AI"], servicenow: ["IT & Infrastructure"],
  sap: ["IT & Infrastructure","Operations & Management"], workday: ["IT & Infrastructure","Human Resources"],
  // security
  cybersecurity: ["Cybersecurity"], infosec: ["Cybersecurity"], security: ["Cybersecurity","Public Sector, Safety & Government"],
  forensics: ["Cybersecurity","Public Sector, Safety & Government"],
  // data
  analytics: ["Data & AI","Marketing & Communications"], tableau: ["Data & AI"],
  // product / mgmt
  scrum: ["Product & Project"], agile: ["Product & Project"], pmi: ["Product & Project","Operations & Management"],
  kanban: ["Product & Project"],
  // marketing / sales
  marketing: ["Marketing & Communications"], seo: ["Marketing & Communications"],
  advertising: ["Marketing & Communications"], salesforce: ["Sales & Business Development","IT & Infrastructure"],
  // finance
  accounting: ["Finance & Accounting"], bookkeeping: ["Finance & Accounting"],
  audit: ["Finance & Accounting"], auditing: ["Finance & Accounting"], tax: ["Finance & Accounting"],
  payroll: ["Finance & Accounting","Human Resources"], banking: ["Finance & Accounting"],
  mortgage: ["Real Estate & Property","Finance & Accounting"], actuarial: ["Finance & Accounting"],
  // hr
  hr: ["Human Resources"], recruiting: ["Human Resources"],
  // logistics
  logistics: ["Supply Chain & Logistics"], supply: ["Supply Chain & Logistics"],
  trucking: ["Supply Chain & Logistics"], aviation: ["Supply Chain & Logistics","Engineering (Non-Software)"],
  // healthcare
  nurse: ["Healthcare & Medical"], nursing: ["Healthcare & Medical"], clinical: ["Healthcare & Medical"],
  medical: ["Healthcare & Medical"], patient: ["Healthcare & Medical"], pharmacy: ["Healthcare & Medical"],
  dental: ["Healthcare & Medical"], radiology: ["Healthcare & Medical"], phlebotomy: ["Healthcare & Medical"],
  fitness: ["Healthcare & Medical"], healthcare: ["Healthcare & Medical"],
  // mental health
  counseling: ["Mental Health & Social Services"], therapist: ["Mental Health & Social Services"],
  behavioral: ["Mental Health & Social Services"],
  // education
  teaching: ["Education & Training"], teacher: ["Education & Training"], instruction: ["Education & Training"],
  // legal
  paralegal: ["Legal"], legal: ["Legal"],
  // trades / mfg
  welding: ["Skilled Trades & Construction"], plumbing: ["Skilled Trades & Construction"],
  electrician: ["Skilled Trades & Construction"], electrical: ["Skilled Trades & Construction","Engineering (Non-Software)"],
  carpentry: ["Skilled Trades & Construction"], construction: ["Skilled Trades & Construction"],
  crane: ["Skilled Trades & Construction"], hvac: ["Skilled Trades & Construction"],
  machinist: ["Manufacturing & Production"], cnc: ["Manufacturing & Production"],
  quality: ["Manufacturing & Production"], automotive: ["Skilled Trades & Construction","Manufacturing & Production"],
  // safety / public
  safety: ["Public Sector, Safety & Government","Skilled Trades & Construction","Manufacturing & Production"],
  firearms: ["Public Sector, Safety & Government"],
  // hospitality
  culinary: ["Hospitality, Food & Travel"], food: ["Hospitality, Food & Travel"],
  hospitality: ["Hospitality, Food & Travel"], restaurant: ["Hospitality, Food & Travel"],
  alcohol: ["Hospitality, Food & Travel"], bartending: ["Hospitality, Food & Travel"],
  // real estate
  realtor: ["Real Estate & Property"], appraisal: ["Real Estate & Property"],
  // agri / science
  agriculture: ["Agriculture & Environment"], environmental: ["Agriculture & Environment","Science & Research"],
  pesticide: ["Agriculture & Environment"], veterinary: ["Agriculture & Environment","Healthcare & Medical"],
  laboratory: ["Science & Research","Healthcare & Medical"],
};

// ---- typeahead search --------------------------------------------------
// (q, limit) -> [{title, category, issuer}] for jobMountTypeahead.
// Matches canonical names, aliases, and issuers; ranks name-prefix
// first, then alias/issuer prefix, then word-boundary, then contains.
function certCatalogNorm(s) {
  return (s || "").toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}
function certCatalogAll() {
  if (certCatalogAll._cache) return certCatalogAll._cache;
  const out = [];
  for (const g of CERT_CATALOG) for (const c of g.certs) {
    out.push({
      title: c.name,
      issuer: c.issuer || "",
      category: (c.cats && c.cats[0]) || "",
      _n: certCatalogNorm(c.name),
      _alts: (c.aliases || []).map(certCatalogNorm).concat(c.issuer ? [certCatalogNorm(c.issuer)] : []),
    });
  }
  certCatalogAll._cache = out;
  return out;
}
function certCatalogSearch(q, limit) {
  limit = limit || 8;
  const needle = certCatalogNorm(q);
  if (!needle) return [];
  const scored = [];
  for (const item of certCatalogAll()) {
    let rank = -1;
    if (item._n.startsWith(needle)) rank = 0;
    else if (item._alts.some(a => a.startsWith(needle))) rank = 1;
    else if (item._n.includes(" " + needle) || item._n.includes("(" + needle)) rank = 2;
    else if (item._n.includes(needle) || item._alts.some(a => a.includes(needle))) rank = 3;
    if (rank >= 0) scored.push({ item, rank });
  }
  scored.sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.item.title.localeCompare(b.item.title));
  return scored.slice(0, limit).map(s => s.item);
}

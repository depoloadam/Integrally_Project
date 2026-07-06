// =====================================================================
// geo.js — shared country / subdivision data + dropdown wiring.
// Loaded by BOTH auth pages (index.html and company.html) before their
// inline scripts. Plain globals (no modules) to match the existing
// standalone-page pattern.
//
// A country entry: { name, sub } where `sub` is null (no subdivision
// field shown) OR { label, items:[...] }. Currently only the United
// States and Canada carry a curated subdivision list; every other
// country shows no subdivision field for now.
//
// geoInitCountry(countrySelect, subContainer, preselect?) wires the
// cascade. `preselect` is optional { country, state } used by EDIT
// forms to restore existing values.
// =====================================================================

const GEO_COUNTRIES = [
  { name: "United States", sub: { label: "State", items: [
    "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
    "Delaware","District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois",
    "Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts",
    "Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
    "New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota",
    "Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina",
    "South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington",
    "West Virginia","Wisconsin","Wyoming",
  ] } },
  { name: "Canada", sub: { label: "Province / Territory", items: [
    "Alberta","British Columbia","Manitoba","New Brunswick","Newfoundland and Labrador",
    "Northwest Territories","Nova Scotia","Nunavut","Ontario","Prince Edward Island",
    "Quebec","Saskatchewan","Yukon",
  ] } },
  { name: "United Kingdom", sub: null },
  { name: "Australia", sub: null },
  { name: "India", sub: null },
  { name: "Germany", sub: null },

  // Countries below use a free-text region field (sub:null with a generic
  // fallback handled in the wiring). Alphabetical after the curated set.
  { name: "Argentina", sub: null }, { name: "Austria", sub: null },
  { name: "Bangladesh", sub: null }, { name: "Belgium", sub: null },
  { name: "Brazil", sub: null }, { name: "Chile", sub: null },
  { name: "China", sub: null }, { name: "Colombia", sub: null },
  { name: "Denmark", sub: null }, { name: "Egypt", sub: null },
  { name: "Finland", sub: null }, { name: "France", sub: null },
  { name: "Ghana", sub: null }, { name: "Greece", sub: null },
  { name: "Hong Kong", sub: null }, { name: "Hungary", sub: null },
  { name: "Indonesia", sub: null }, { name: "Ireland", sub: null },
  { name: "Israel", sub: null }, { name: "Italy", sub: null },
  { name: "Japan", sub: null }, { name: "Kenya", sub: null },
  { name: "Malaysia", sub: null }, { name: "Mexico", sub: null },
  { name: "Netherlands", sub: null }, { name: "New Zealand", sub: null },
  { name: "Nigeria", sub: null }, { name: "Norway", sub: null },
  { name: "Pakistan", sub: null }, { name: "Peru", sub: null },
  { name: "Philippines", sub: null }, { name: "Poland", sub: null },
  { name: "Portugal", sub: null }, { name: "Romania", sub: null },
  { name: "Saudi Arabia", sub: null }, { name: "Singapore", sub: null },
  { name: "South Africa", sub: null }, { name: "South Korea", sub: null },
  { name: "Spain", sub: null }, { name: "Sweden", sub: null },
  { name: "Switzerland", sub: null }, { name: "Thailand", sub: null },
  { name: "Turkey", sub: null }, { name: "Ukraine", sub: null },
  { name: "United Arab Emirates", sub: null }, { name: "Vietnam", sub: null },
  { name: "Other", sub: null },
];

// Wire a country <select> to a subdivision container that gets rebuilt
// whenever the country changes.
//
//   countrySelect : the <select id="reg-country"> element
//   subContainer  : an empty container the helper fills with the
//                   subdivision field (a <select> for curated countries,
//                   a free-text <input> otherwise, or nothing).
//
// Read the chosen values later with geoGetSubdivision(subContainer).
function geoInitCountry(countrySelect, subContainer, preselect) {
  // Populate the country dropdown once.
  countrySelect.innerHTML =
    `<option value="">Select country…</option>` +
    GEO_COUNTRIES.map(c => `<option value="${c.name}">${c.name}</option>`).join("");

  // Restore an existing country value (edit forms). If the stored country
  // isn't in our list, leave it unselected — the state is still restored
  // as free text below if applicable.
  if (preselect && preselect.country) {
    countrySelect.value = preselect.country;
  }

  const rebuildSub = () => {
    const country = GEO_COUNTRIES.find(c => c.name === countrySelect.value);
    subContainer.innerHTML = "";
    if (!country || !countrySelect.value) return;   // no country chosen yet

    if (country.sub) {
      // Curated list -> dropdown. (Currently US & Canada only.)
      subContainer.innerHTML = `
        <div class="in-field">
          <label for="reg-sub">${country.sub.label} <span class="opt">(optional)</span></label>
          <select id="reg-sub">
            <option value="">Select ${country.sub.label.toLowerCase()}…</option>
            ${country.sub.items.map(s => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </div>`;
      // Restore an existing subdivision value if it matches an option.
      if (preselect && preselect.state) {
        const sel = subContainer.querySelector("#reg-sub");
        if (sel && [...sel.options].some(o => o.value === preselect.state)) {
          sel.value = preselect.state;
        }
      }
    }
    // Countries without a curated list show NO subdivision field for now.
  };

  countrySelect.addEventListener("change", rebuildSub);
  rebuildSub();
}

// Returns the current subdivision value ("" if none/empty).
function geoGetSubdivision(subContainer) {
  const el = subContainer.querySelector("#reg-sub");
  return el ? el.value.trim() : "";
}

// ---------------------------------------------------------------------
// Modal variant — for the in-app EDIT forms (app.html), which use plain
// inline <label><input> markup inside modals rather than the auth pages'
// .in-field wrappers. Give it your own element ids to avoid clashes.
//
//   countrySelect : a <select> element (already in the modal DOM)
//   subContainer  : an empty container div in the modal
//   opts.subId    : id to assign the generated subdivision control
//                   (default "edit-sub")
//   opts.preselect: { country, state } existing values to restore
//
// Read the value later with geoGetSubdivisionBy(subContainer, subId).
// ---------------------------------------------------------------------
function geoInitCountryModal(countrySelect, subContainer, opts) {
  opts = opts || {};
  const subId     = opts.subId || "edit-sub";
  const preselect = opts.preselect || {};

  countrySelect.innerHTML =
    `<option value="">Select country…</option>` +
    GEO_COUNTRIES.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
  if (preselect.country) countrySelect.value = preselect.country;

  const rebuild = () => {
    const country = GEO_COUNTRIES.find(c => c.name === countrySelect.value);
    subContainer.innerHTML = "";
    if (!country || !countrySelect.value || !country.sub) return;

    subContainer.innerHTML =
      `<label>${country.sub.label}</label>` +
      `<select id="${subId}"><option value="">Select ${country.sub.label.toLowerCase()}…</option>` +
      country.sub.items.map(s => `<option value="${s}">${s}</option>`).join("") +
      `</select>`;

    if (preselect.state) {
      const sel = subContainer.querySelector("#" + subId);
      if (sel && [...sel.options].some(o => o.value === preselect.state)) sel.value = preselect.state;
    }
  };

  countrySelect.addEventListener("change", rebuild);
  rebuild();
}

function geoGetSubdivisionBy(subContainer, subId) {
  const el = subContainer.querySelector("#" + (subId || "edit-sub"));
  return el ? el.value.trim() : "";
}

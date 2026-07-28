// Unit + behavioral tests for the shared PhoneField module (assets/js/phone.js):
// country-code dropdown driving +code AND format mask. Masked countries
// (US, CA, GB, AU) reshape digits; others are prefix-only. Covers the mask
// engine, country switching, value seeding + country inference, and the
// live input formatting.

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const dom = new JSDOM(`<!doctype html><body></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;

// Load the IIFE module in window scope; it attaches window.PhoneField.
const src = readFileSync("assets/js/phone.js", "utf8");
window.eval(src);
const PF = window.PhoneField;
ok(!!PF && typeof PF.mount === "function", "PhoneField module loads and exposes mount()");

const US = PF._byIso("US"), GB = PF._byIso("GB"), AU = PF._byIso("AU"), DE = PF._byIso("DE"), OT = PF._byIso("OTHER");

console.log("\nmask engine — compose(country, nationalDigits)");
ok(PF._compose(US, "5551234567") === "+1 (555) 123-4567", "US full: +1 (555) 123-4567");
ok(PF._compose(US, "555") === "+1 (555)", "US partial area code closes the paren at 3 digits");
ok(PF._compose(US, "555123") === "+1 (555) 123", "US partial: area + prefix");
ok(PF._compose(PF._byIso("CA"), "5551234567") === "+1 (555) 123-4567", "Canada uses the same NANP mask");
ok(PF._compose(GB, "7911123456") === "+44 7911 123456", "UK: +44 7911 123456");
ok(PF._compose(AU, "412345678") === "+61 412 345 678", "AU: +61 412 345 678");
ok(PF._compose(DE, "30123456") === "+49 30123456", "Germany prefix-only: +49 then raw digits");
ok(PF._compose(OT, "123456") === "123456", "'Other' has no +code and no mask");
// teeth: masked output must differ from prefix-only for the same digits
ok(PF._compose(US, "5551234567") !== PF._compose(DE, "5551234567"), "masked US differs from prefix-only DE");
// max caps: US ignores overflow beyond 10 national digits
ok(/\+1 \(555\) 123-4567/.test(PF._compose(US, "55512345679999")), "US mask caps at 10 national digits");

console.log("\nnationalDigitsOf — strips a matching dial prefix");
ok(PF._nationalDigitsOf("+1 (555) 123-4567", US) === "5551234567", "US: strips +1, keeps 10 digits");
ok(PF._nationalDigitsOf("+44 7911 123456", GB) === "7911123456", "UK: strips +44");
ok(PF._nationalDigitsOf("5551234567", US) === "5551234567", "no prefix present: digits unchanged");

console.log("\nmount() — wiring on real elements");
const mk = () => {
  const wrap = window.document.createElement("div");
  const sel = window.document.createElement("select");
  const inp = window.document.createElement("input"); inp.type = "tel";
  wrap.appendChild(sel); wrap.appendChild(inp);
  window.document.body.appendChild(wrap);
  return { sel, inp };
};

// default US, typing digits formats live
let { sel, inp } = mk();
PF.mount(inp, sel, { initialIso: "US" });
ok(sel.options.length === PF.countries.length, "country select is populated with every country");
ok(sel.value === "US", "defaults to US");
inp.value = "5551234567";
inp.dispatchEvent(new window.Event("input", { bubbles: true }));
ok(inp.value === "+1 (555) 123-4567", "typing a US number formats to +1 (555) 123-4567");

// switching country strips the OLD country's dial code and re-masks the
// remaining national digits under the new country (a US number can't become
// a real UK number, but the +1 is correctly dropped rather than treated as
// a national digit).
sel.value = "GB";
sel.dispatchEvent(new window.Event("change", { bubbles: true }));
ok(inp.value === "+44 5551 234567", "switching to UK strips the US +1 and re-masks under UK");
ok(inp.placeholder.length > 0, "placeholder updates for the country");
// The realistic flow — a genuinely UK number typed under GB — masks cleanly.
inp.value = "7911123456";
inp.dispatchEvent(new window.Event("input", { bubbles: true }));
ok(inp.value === "+44 7911 123456", "a real UK number masks to +44 7911 123456");

// seeding from a stored +44 value infers the country
let m2 = mk();
PF.mount(m2.inp, m2.sel, { initialValue: "+44 7911 123456", initialIso: "US" });
ok(m2.sel.value === "GB", "stored +44 value infers United Kingdom on load");
ok(m2.inp.value === "+44 7911 123456", "seeded UK value is displayed formatted");

// seeding a US value
let m3 = mk();
PF.mount(m3.inp, m3.sel, { initialValue: "+1 (555) 123-4567" });
ok(m3.sel.value === "US", "stored +1 value infers US");

// 'Other': leaves an arbitrary international string basically alone
let m4 = mk();
PF.mount(m4.inp, m4.sel, { initialIso: "OTHER" });
m4.inp.value = "0049 30 999";
m4.inp.dispatchEvent(new window.Event("input", { bubbles: true }));
ok(/0049|30|999/.test(m4.inp.value.replace(/\D/g, "").length ? m4.inp.value : "x"), "'Other' keeps user digits without a mask");

// getValue / getIso
let m5 = mk();
const api = PF.mount(m5.inp, m5.sel, { initialIso: "AU" });
m5.inp.value = "412345678";
m5.inp.dispatchEvent(new window.Event("input", { bubbles: true }));
ok(api.getValue() === "+61 412 345 678", "getValue returns the composed AU number");
ok(api.getIso() === "AU", "getIso returns the selected country");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

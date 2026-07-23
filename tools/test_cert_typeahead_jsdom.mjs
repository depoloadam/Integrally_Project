// test_cert_typeahead_jsdom.mjs — cert catalog search + modal typeahead.
//
// Covers:
//   1. certCatalogSearch ranking: canonical-name prefix beats alias
//      beats contains; acronyms ("ccna", "pmp") and issuer text
//      ("comptia") surface the right certs; dash normalization.
//   2. The REAL jobMountTypeahead mounted on a cert-name input renders
//      suggestions, and picking one fills the name AND autofills the
//      issuer (only when the issuer field is empty) via the extended
//      onPick(title, item) hook.
//
// Run: node tools/test_cert_typeahead_jsdom.mjs   (needs jsdom)

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const certsSrc = readFileSync(join(root, "assets/js/certs-catalog.js"), "utf8");
const jobsSrc  = readFileSync(join(root, "assets/js/jobs-catalog.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const dom = new JSDOM(`<!doctype html><body>
  <div class="in-modal"><label>Name</label><input id="c-name">
  <label>Issuer</label><input id="c-issuer"></div></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;

// Evaluate both catalog files in this scope (they define plain consts +
// functions, exactly as the browser sees them).
const ctx = new Function("window", "document", `
  ${certsSrc}
  ${jobsSrc}
  return { certCatalogSearch, jobMountTypeahead };
`)(window, window.document);
const { certCatalogSearch, jobMountTypeahead } = ctx;

console.log("certCatalogSearch ranking");
{
  const r1 = certCatalogSearch("CCNA", 8);
  ok(r1.length && r1[0].title === "CCNA", `"CCNA" → CCNA first (got "${r1[0]?.title}")`);
  ok(r1[0].issuer === "Cisco", "CCNA carries issuer Cisco");

  const r2 = certCatalogSearch("pmp", 8);
  ok(r2.some(i => i.title.includes("PMP")), '"pmp" surfaces Project Management Professional');

  const r3 = certCatalogSearch("comptia", 8);
  ok(r3.length >= 4 && r3.every(i => i.issuer === "CompTIA" || i.title.toLowerCase().includes("comptia")),
     `issuer text "comptia" surfaces the CompTIA family (${r3.length} results)`);

  const r4 = certCatalogSearch("solutions arch", 8);
  ok(r4.some(i => i.title.startsWith("AWS Certified Solutions Architect")),
     'partial "solutions arch" finds AWS Solutions Architect');

  const r5 = certCatalogSearch("servsafe", 8);
  ok(r5.length && r5[0].title.startsWith("ServSafe"), '"servsafe" → ServSafe first');

  const r6 = certCatalogSearch("aws certified solutions architect - associate", 8);
  ok(r6.length && r6[0].title.includes("–"), "hyphen input matches en-dash canonical name (dash normalization)");

  ok(certCatalogSearch("x", 8).length === 0 || true, "no crash on 1-char input");
  ok(certCatalogSearch("", 8).length === 0, "empty query → no results");
}

console.log("\ntypeahead on the cert modal (real jobMountTypeahead)");
{
  const nameEl = window.document.getElementById("c-name");
  const issEl  = window.document.getElementById("c-issuer");
  let picked = null;
  jobMountTypeahead(nameEl, {
    search: certCatalogSearch, minChars: 2, limit: 8,
    onPick: (title, item) => {
      picked = item;
      if (item && item.issuer && !issEl.value.trim()) issEl.value = item.issuer;
    },
  });

  nameEl.value = "ccna";
  nameEl.dispatchEvent(new window.Event("input"));
  const menu = window.document.querySelector(".job-ta-menu");
  ok(menu && menu.style.display === "block", "menu opens on input");
  ok(menu.parentElement === window.document.body, "menu is body-appended (modal-clip safe)");
  const first = menu.querySelector(".job-ta-item");
  ok(first && first.querySelector(".job-ta-title").textContent === "CCNA", "first suggestion is CCNA");

  first.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  ok(nameEl.value === "CCNA", "picking fills the name input");
  ok(picked && picked.issuer === "Cisco", "onPick receives the full item (issuer present)");
  ok(issEl.value === "Cisco", "issuer autofilled when empty");

  // Autofill must NOT clobber a user-entered issuer.
  issEl.value = "My Own Issuer";
  nameEl.value = "pmp";
  nameEl.dispatchEvent(new window.Event("input"));
  const row = window.document.querySelector(".job-ta-menu .job-ta-item");
  row.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  ok(issEl.value === "My Own Issuer", "existing issuer is not overwritten on pick");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

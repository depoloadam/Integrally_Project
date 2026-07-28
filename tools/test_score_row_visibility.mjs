// Behavioral test: the "View full breakdown" / "View history" buttons on a
// score row must appear ONLY on the owner's own profile. On another user's
// profile they route to viewer-scoped endpoints (history.php / score.php),
// which 404 as "score not found" — so they're hidden. This also guards
// against the null-handler crash: wiring .onclick on a missing button throws.

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;
window.el = (h) => { const t = window.document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
window.esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Owner-path globals — stubbed so the file loads; not exercised by a visitor row.
window.confirmDialog = async () => false;
window.api = async () => ({ ok: true, data: { success: true, data: [] } });
window.toast = () => {};
window.loadScoreComparison = () => {};
window.openScoreRemoveDialog = () => {};
window.refreshAfterProfileChange = () => {};
window.showEntryCapModal = () => {};
window.ME = { uuid: "me", role: "user" };

const src = readFileSync("assets/js/profile.js", "utf8");
// profile.js is a big flat file of function declarations; eval it in window
// scope with the globals aliased, then grab the one function we test.
try {
  window.eval(`var el=window.el, esc=window.esc, confirmDialog=window.confirmDialog, api=window.api,
    toast=window.toast, loadScoreComparison=window.loadScoreComparison,
    openScoreRemoveDialog=window.openScoreRemoveDialog, refreshAfterProfileChange=window.refreshAfterProfileChange,
    showEntryCapModal=window.showEntryCapModal, ME=window.ME;
    ${src}
    ;window.renderScoreRow = renderScoreRow;`);
} catch (e) {
  console.log("  ✗ profile.js failed to load:", e.message);
  console.log("\n0 passed, 1 failed"); process.exit(1);
}
ok(typeof window.renderScoreRow === "function", "renderScoreRow loaded");

const score = {
  id: 42, target_type: "job_title", target_value: "Data Analyst",
  score_value: 73, created_at: "2026-07-20T10:00:00Z", hidden: false,
  breakdown: [{ factor: "degree", detail: "BSc Computer Science", points: 10 }],
};

// --- OWNER's own profile (showOwnerControls = true) ---------------------
let ownerRow;
ok((() => { try { ownerRow = window.renderScoreRow(score, true); return true; } catch { return false; } })(),
   "owner row builds without throwing");
ok(!!ownerRow.querySelector(".score-fullbtn"), "owner sees 'View full breakdown'");
ok(!!ownerRow.querySelector(".score-histbtn"), "owner sees 'View history'");
ok(!!ownerRow.querySelector(".score-rescorebtn"), "owner still sees Re-score (unchanged)");
ok(!!ownerRow.querySelector(".score-hide-toggle"), "owner still sees hide toggle (unchanged)");
ok(!!ownerRow.querySelector(".score-delbtn"), "owner still sees Remove (unchanged)");

// --- ANOTHER user's profile (showOwnerControls = false) -----------------
let visitorRow;
ok((() => { try { visitorRow = window.renderScoreRow(score, false); return true; } catch (e) { console.log("    threw:", e.message); return false; } })(),
   "visitor row builds without throwing (no null .onclick crash)");
ok(!visitorRow.querySelector(".score-fullbtn"), "visitor does NOT see 'View full breakdown'");
ok(!visitorRow.querySelector(".score-histbtn"), "visitor does NOT see 'View history'");
ok(!visitorRow.querySelector(".score-rescorebtn"), "visitor does not see Re-score");
ok(!visitorRow.querySelector(".score-hide-toggle"), "visitor does not see hide toggle");
ok(!visitorRow.querySelector(".score-delbtn"), "visitor does not see Remove");
// The score itself is still shown to visitors — we hid the actions, not the data.
ok(!!visitorRow.querySelector(".in-score-badge"), "visitor still sees the score badge/value");
ok(visitorRow.textContent.includes("Data Analyst"), "visitor still sees the target");
// The expand caret still works for a visitor (mini-breakdown is inline, allowed).
ok(!!visitorRow.querySelector(".score-expand"), "visitor still has the expand caret");

// teeth: expanding a visitor row must not throw (handlers were the risk).
const caret = visitorRow.querySelector(".score-expand");
ok((() => { try { caret.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); return true; } catch { return false; } })(),
   "expanding a visitor row does not throw");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

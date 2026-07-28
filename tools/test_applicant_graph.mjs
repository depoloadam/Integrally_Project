// Behavioral test for the collapsible applicant graph (company.js):
// histogram + beeswarm modes, collapse/expand with remembered state, and
// two-way hover sync between graph marks and list rows. Reads only the
// existing applicant payload — no endpoint involved.

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

const src = readFileSync("assets/js/company.js", "utf8");

function extractFn(src, name, kw = "function") {
  const start = src.indexOf(`${kw} ${name}(`);
  if (start < 0) return "";
  const braceOpen = src.indexOf("{", src.indexOf(")", start));
  let j = braceOpen, d = 0;
  do { if (src[j] === "{") d++; else if (src[j] === "}") d--; j++; } while (d > 0);
  return src.slice(start, j);
}

const dom = new JSDOM(`<!doctype html><body></body>`, { url: "http://localhost/" });
const { window } = dom;
global.window = window; global.document = window.document;
const el = (h) => { const t = window.document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let detailOpened = [];
const openApplicantDetail = (u) => detailOpened.push(u);

const parts = [
  "let JA_GRAPH = { open: false, mode: 'histogram' };",
  "let highlightGraphMark = function(){};",
  extractFn(src, "buildApplicantGraph"),
  extractFn(src, "cssEscape"),
  extractFn(src, "graphMarkToRow"),
  extractFn(src, "buildApplicantHistogram"),
  extractFn(src, "buildApplicantBeeswarm"),
  "window.__g = { buildApplicantGraph, buildApplicantHistogram, buildApplicantBeeswarm, graphMarkToRow, get JA_GRAPH(){return JA_GRAPH;}, get highlightGraphMark(){return highlightGraphMark;} };"
].join("\n");
new Function("el", "esc", "openApplicantDetail", "document", "window", parts)(el, esc, openApplicantDetail, window.document, window);
const G = window.__g;

const mkApps = () => ([
  { uuid: "a1", score_value: 92, score_rank: 1, status: "submitted", candidate: { uuid: "u1", full_name: "Zoe Adams", username: "zoe" } },
  { uuid: "a2", score_value: 74, score_rank: 2, status: "submitted", candidate: { uuid: "u2", full_name: "Al Brown", username: "al" } },
  { uuid: "a3", score_value: 71, score_rank: 3, status: "submitted", candidate: { uuid: "u3", full_name: "Cy Diaz", username: "cy" } },
  { uuid: "a4", score_value: 33, score_rank: 4, status: "withdrawn", candidate: { uuid: "u4", full_name: "Bo Fox", username: "bo" } },
  { uuid: "a5", score_value: null, score_rank: null, status: "submitted", candidate: { uuid: "u5", full_name: "No Score", username: "ns" } },
]);

const apps = mkApps();
apps.forEach(a => {
  const row = el(`<div class="ja-row" data-app-uuid="${a.uuid}"></div>`);
  window.document.body.appendChild(row);
});

console.log("build + collapse");
const mount = el(`<div></div>`); window.document.body.appendChild(mount);
G.JA_GRAPH.open = false; G.JA_GRAPH.mode = "histogram";
G.buildApplicantGraph(mount, apps, { title: "Data Analyst" }, "job1");
const shell = mount.querySelector(".ja-graph");
ok(!!shell, "graph shell renders");
ok(/Data Analyst/.test(shell.textContent), "header names the job title (scope is clear)");
ok(/how each ranks against the others who applied/i.test(shell.textContent), "explains the data is scoped to this role");
const body = shell.querySelector(".ja-graph-body");
ok(body.style.display === "none", "starts collapsed");
shell.querySelector(".ja-graph-toggle").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(body.style.display !== "none", "toggle expands the graph");
ok(shell.classList.contains("open"), "open class applied");
ok(G.JA_GRAPH.open === true, "open state remembered on module");

console.log("\nunscored applicants are noted, not plotted");
ok(/1 applicant without a score isn't plotted/.test(shell.textContent), "the one unscored applicant is called out");

console.log("\nhistogram mode");
let canvas = shell.querySelector("#ja-graph-canvas");
ok(!!canvas.querySelector(".ja-hist"), "histogram renders by default");
const cols = canvas.querySelectorAll(".ja-hist-col");
ok(cols.length === 10, "ten score buckets");
const counts = [...cols].map(c => c.querySelector(".ja-hist-count").textContent.trim());
ok(counts[9] === "1", "bucket 90–100 has 1 (the 92)");
ok(counts[7] === "2", "bucket 70–79 has 2 (74 and 71)");
ok(counts[3] === "1", "bucket 30–39 has 1 (the 33)");
ok(counts[0] === "" && counts[5] === "", "empty buckets show no count");
cols[7].dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true }));
const lit = [...window.document.querySelectorAll(".ja-row.hot")].map(r => r.dataset.appUuid).sort();
ok(JSON.stringify(lit) === JSON.stringify(["a2", "a3"]), "hovering a bucket lights exactly its applicants' rows");
cols[7].dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: true }));
ok(window.document.querySelectorAll(".ja-row.hot").length === 0, "leaving the bucket clears the highlight");

console.log("\nbeeswarm mode");
shell.querySelector('.ja-graph-mode[data-mode="beeswarm"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(G.JA_GRAPH.mode === "beeswarm", "mode switches to beeswarm");
canvas = shell.querySelector("#ja-graph-canvas");
ok(!canvas.querySelector(".ja-hist") && !!canvas.querySelector(".ja-swarm"), "canvas swaps histogram -> beeswarm");
const dots = canvas.querySelectorAll(".ja-swarm-dot");
ok(dots.length === 4, "one dot per scored applicant (unscored excluded)");
const zoeDot = [...dots].find(d => d.dataset.appUuid === "a1");
ok(parseFloat(zoeDot.style.left) === 92, "a dot's x-position equals its score");
detailOpened = [];
zoeDot.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(detailOpened.length === 1 && detailOpened[0] === "a1", "clicking a dot opens that applicant's detail");
zoeDot.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true }));
ok(window.document.querySelector('.ja-row[data-app-uuid="a1"]').classList.contains("hot"), "hovering a dot lights its row");

console.log("\nrow -> graph sync (highlightGraphMark)");
G.highlightGraphMark("a1", true);
ok(canvas.querySelector('.ja-swarm-dot[data-app-uuid="a1"]').classList.contains("hot"), "row hover lights the matching dot");
G.highlightGraphMark("a1", false);
ok(!canvas.querySelector('.ja-swarm-dot[data-app-uuid="a1"]').classList.contains("hot"), "clearing removes the dot highlight");

console.log("\nremembered state across rebuild (e.g. after a sort change)");
const mount2 = el(`<div></div>`); window.document.body.appendChild(mount2);
G.buildApplicantGraph(mount2, apps, { title: "Data Analyst" }, "job1");
const shell2 = mount2.querySelector(".ja-graph");
ok(shell2.classList.contains("open"), "graph stays open after a rebuild");
ok(shell2.querySelector('.ja-graph-mode[data-mode="beeswarm"]').classList.contains("active"), "beeswarm mode is remembered after rebuild");

console.log("\nempty / all-unscored");
const mount3 = el(`<div></div>`); window.document.body.appendChild(mount3);
G.buildApplicantGraph(mount3, [{ uuid: "x", score_value: null, candidate: {} }], { title: "Role" }, "j");
mount3.querySelector(".ja-graph-toggle").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
ok(/No scored applicants to plot/i.test(mount3.textContent), "all-unscored shows an honest empty state");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);

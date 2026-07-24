// Behavioral check for the hover-card system in shell.js.
// Extracts the REAL module source (everything from the hover-card banner
// to end of file) and runs it against jsdom with a stubbed api().
//
// Covers: intent delay, leave grace, cache reuse, out-of-order fetch
// guard, privacy-driven omissions, disabled-button states, placement
// flipping at viewport edges, and teardown on navigation.
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const src = readFileSync("assets/js/shell.js", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n)); };

// ---- isolate the hover-card module ----------------------------------
const marker = "// hover cards — profile / company previews";
const start = src.indexOf(marker);
if (start === -1) { console.error("FATAL: hover card module not found in shell.js"); process.exit(1); }
const moduleSrc = src.slice(start);

const dom = new JSDOM(`<!doctype html><html><body></body></html>`, {
  url: "http://localhost/app.html", pretendToBeVisual: true,
});
const { window } = dom;
const document = window.document;
global.window = window; global.document = document;
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.setTimeout = window.setTimeout ? setTimeout : setTimeout;

// jsdom leaves offsetHeight/Width at 0; the placement code needs real
// numbers to decide whether to flip. Give the card a plausible box.
Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
  configurable: true, get() { return this.classList?.contains("in-hovercard") ? 180 : 20; },
});
Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
  configurable: true, get() { return this.classList?.contains("in-hovercard") ? 320 : 100; },
});
Object.defineProperty(window.document.documentElement, "clientWidth", { configurable: true, get: () => 1200 });
Object.defineProperty(window.document.documentElement, "clientHeight", { configurable: true, get: () => 800 });

const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toasts = [];
const toast = (m, k) => toasts.push([m, k]);

// ---- stub api() ------------------------------------------------------
let apiCalls = [];
let apiResponder = null;
const api = async (path, method = "GET", body = null) => {
  apiCalls.push({ path, method, body });
  return apiResponder ? apiResponder(path, method, body) : { ok: true, data: { success: true, data: {} } };
};

const FIXTURES = {
  "user:u-alice": {
    type: "user", uuid: "u-alice", name: "Alice Nguyen", username: "alice",
    avatar: null, verified: true, headline: "Senior Data Engineer @ Acme Robotics",
    location: "Akron, OH",
    score: { target_type: "job_title", target_value: "Data Engineer", value: 87 },
    stats: { followers: 2, following: 1 },
    viewer: { signed_in: true, is_self: false, following: false, follows_me: true, blocked: false },
    message: { available: true, pending: false, reason: null },
  },
  // Everything private: no location, no score, no counts.
  "user:u-dave": {
    type: "user", uuid: "u-dave", name: "Dave Kim", username: "dave",
    avatar: null, verified: false, headline: null, location: null,
    score: null, stats: null,
    viewer: { signed_in: true, is_self: false, following: false, follows_me: false, blocked: true },
    message: { available: false, pending: false, reason: "Messaging unavailable" },
  },
  "user:u-self": {
    type: "user", uuid: "u-self", name: "Me Myself", username: "me",
    avatar: null, verified: false, headline: null, location: null, score: null,
    stats: { followers: 0, following: 0 },
    viewer: { signed_in: true, is_self: true, following: false, follows_me: false, blocked: false },
    message: { available: false, pending: false, reason: null },
  },
  "company:co-acme": {
    type: "company", uuid: "co-acme", name: "Acme Robotics", avatar: null,
    verified: true, subtitle: "Acme builds industrial automation systems…",
    industry: "Robotics", location: "Akron, OH",
    stats: { followers: 1, openings: 2 },
    viewer: { signed_in: true, is_self: false, following: true },
  },
  "company:co-empty": {
    type: "company", uuid: "co-empty", name: "Quiet Co", avatar: null,
    verified: false, subtitle: null, industry: null, location: null,
    stats: { followers: 0, openings: 0 },
    viewer: { signed_in: false, is_self: false, following: false },
  },
};

apiResponder = (path) => {
  const m = /type=([^&]+)&uuid=([^&]+)/.exec(path);
  if (!m) return { ok: false, data: null };
  const key = decodeURIComponent(m[1]) + ":" + decodeURIComponent(m[2]);
  const d = FIXTURES[key];
  return d ? { ok: true, data: { success: true, data: d } } : { ok: false, status: 404, data: { success: false } };
};

// ---- evaluate the module in this scope ------------------------------
const factory = new Function(
  "window", "document", "esc", "api", "toast", "requestAnimationFrame", "location",
  moduleSrc + "\n; return { hideHoverCard, HOVER_CACHE, hoverCardHtml, placeHoverCard, hoverCardEl, HOVER_OPEN_DELAY, HOVER_CLOSE_DELAY };"
);
const mod = factory(window, document, esc, api, toast, global.requestAnimationFrame, window.location);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const card = () => document.querySelector(".in-hovercard");
const fire = (elm, type, relatedTarget = null) => {
  const ev = new window.MouseEvent(type, { bubbles: true, relatedTarget });
  elm.dispatchEvent(ev);
};

function trigger(type, uuid, rect) {
  const b = document.createElement("span");
  b.dataset.hoverCard = type;
  b.dataset.hoverUuid = uuid;
  b.textContent = uuid;
  document.body.appendChild(b);
  b.getBoundingClientRect = () => rect || { top: 200, bottom: 220, left: 100, right: 200, width: 100, height: 20 };
  return b;
}

const D = 380;   // a little past HOVER_OPEN_DELAY

console.log("\nhover card — trigger & timing");
{
  apiCalls = [];
  const t = trigger("user", "u-alice");
  fire(t, "mouseover");
  await sleep(120);
  ok(apiCalls.length === 0, "no fetch before the intent delay elapses");
  await sleep(D);
  ok(apiCalls.length === 1, "one fetch after the intent delay");
  ok(card() && card().style.display === "block", "card is shown");
  ok(card().parentElement === document.body, "card is appended to document.body (escapes overflow clipping)");
  ok(card().style.position === "" || window.getComputedStyle(card()).position !== "absolute", "card is not absolutely positioned inside a scroller");
  mod.hideHoverCard();
  t.remove();
}

{
  apiCalls = [];
  const t = trigger("user", "u-alice");
  fire(t, "mouseover");
  await sleep(120);
  fire(t, "mouseout");
  await sleep(D);
  ok(apiCalls.length === 0, "leaving before the delay cancels the fetch entirely");
  ok(!card() || card().style.display === "none", "no card after an aborted hover");
  t.remove();
}

console.log("\nhover card — caching");
{
  mod.HOVER_CACHE.clear();
  apiCalls = [];
  const t = trigger("user", "u-alice");
  fire(t, "mouseover"); await sleep(D);
  mod.hideHoverCard();
  fire(t, "mouseover"); await sleep(D);
  ok(apiCalls.length === 1, "second hover on the same target reuses the cache (1 fetch, not 2)");
  mod.hideHoverCard(); t.remove();
}

{
  mod.HOVER_CACHE.clear();
  apiCalls = [];
  const t = trigger("user", "u-nobody");   // 404s
  fire(t, "mouseover"); await sleep(D);
  ok(!card() || card().style.display === "none", "a 404 shows no card");
  ok(toasts.length === 0, "a failed hover never toasts (would be intolerable on mouse-move)");
  mod.hideHoverCard();
  fire(t, "mouseover"); await sleep(D);
  ok(apiCalls.length === 1, "a miss is cached too — no retry loop on repeated hover");
  mod.hideHoverCard(); t.remove();
}

console.log("\nhover card — content & privacy");
{
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-alice");
  fire(t, "mouseover"); await sleep(D);
  const h = card().innerHTML;
  ok(/Alice Nguyen/.test(h), "renders the display name");
  ok(/@alice/.test(h), "renders the handle");
  ok(/Senior Data Engineer/.test(h), "renders the headline");
  ok(/Akron, OH/.test(h), "renders the location when permitted");
  ok(/87/.test(h) && /Data Engineer/.test(h), "renders the top score with its target");
  ok(/followers/.test(h), "renders follower counts");
  mod.hideHoverCard(); t.remove();
}

{
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-dave");
  fire(t, "mouseover"); await sleep(D);
  const h = card().innerHTML;
  ok(!/Akron/.test(h), "omits location when the server withheld it (show_city=0)");
  ok(!/hc-score-val/.test(h), "omits the score block when the server withheld it (hide_all_scores)");
  ok(!/hc-stats/.test(h), "omits counts when the server withheld them (hide_follow_lists)");
  const msg = card().querySelector(".hc-message");
  ok(msg && msg.disabled, "Message is greyed out when blocked");
  ok(msg.getAttribute("title") === "Messaging unavailable", "blocked reason is shown but does not say who blocked whom");
  ok(!/blocked you|you blocked/i.test(h), "never discloses block direction");
  mod.hideHoverCard(); t.remove();
}

console.log("\nhover card — action buttons");
{
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-alice");
  fire(t, "mouseover"); await sleep(D);
  const f = card().querySelector(".hc-follow");
  const m = card().querySelector(".hc-message");
  ok(f && !f.disabled, "Follow is enabled for a signed-in viewer");
  ok(f.textContent.trim() === "Follow", "Follow reads 'Follow' when not following");
  ok(m && !m.disabled, "Message is enabled when messaging is available");

  apiCalls = [];
  apiResponder = () => ({ ok: true, data: { success: true } });
  f.click();
  await sleep(30);
  ok(apiCalls.some(c => c.path === "/follow/follow.php" && c.method === "POST"), "Follow POSTs to follow.php");
  ok(apiCalls[0].body.target_type === "user" && apiCalls[0].body.target_uuid === "u-alice", "Follow sends the right target");
  ok(f.classList.contains("following"), "Follow flips to the following state");
  ok(mod.HOVER_CACHE.get("user:u-alice").viewer.following === true, "cache is updated so re-hover shows the new state");
  mod.hideHoverCard(); t.remove();
  apiResponder = (path) => {
    const mm = /type=([^&]+)&uuid=([^&]+)/.exec(path);
    const key = decodeURIComponent(mm[1]) + ":" + decodeURIComponent(mm[2]);
    const d = FIXTURES[key];
    return d ? { ok: true, data: { success: true, data: d } } : { ok: false, status: 404, data: { success: false } };
  };
}

{
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-self");
  fire(t, "mouseover"); await sleep(D);
  ok(!card().querySelector(".hc-actions"), "own card shows no action buttons");
  mod.hideHoverCard(); t.remove();
}

console.log("\nhover card — company");
{
  mod.HOVER_CACHE.clear();
  const t = trigger("company", "co-acme");
  fire(t, "mouseover"); await sleep(D);
  const h = card().innerHTML;
  ok(/Acme Robotics/.test(h), "renders the company name");
  ok(/Robotics/.test(h) && /Akron, OH/.test(h), "renders industry and location");
  ok(/2<\/b> open roles/.test(h) || /open roles/.test(h), "renders the open-roles count");
  ok(!card().querySelector(".hc-message"), "company card has no Message button");
  const o = card().querySelector(".hc-openings");
  ok(o && !o.disabled, "View openings is enabled when roles exist");
  const f = card().querySelector(".hc-follow");
  ok(f && f.classList.contains("following") && f.textContent.trim() === "Following", "Follow reflects the already-following state");
  ok(card().querySelector(".hc-avatar").classList.contains("company"), "company avatar uses the squared variant");
  mod.hideHoverCard(); t.remove();
}

{
  mod.HOVER_CACHE.clear();
  const t = trigger("company", "co-empty");
  fire(t, "mouseover"); await sleep(D);
  const o = card().querySelector(".hc-openings");
  const f = card().querySelector(".hc-follow");
  ok(o && o.disabled, "View openings is greyed out with no open roles");
  ok(f && f.disabled, "Follow is greyed out for a signed-out viewer");
  ok(/<b>0<\/b>\s*followers/.test(card().innerHTML), "follower count is singular/plural correct");
  mod.hideHoverCard(); t.remove();
}

console.log("\nhover card — placement");
{
  mod.HOVER_CACHE.clear();
  // Trigger near the bottom: card must flip above rather than overflow.
  const t = trigger("user", "u-alice", { top: 700, bottom: 720, left: 100, right: 200, width: 100, height: 20 });
  fire(t, "mouseover"); await sleep(D);
  const top = parseInt(card().style.top, 10);
  ok(top + 180 <= 800, "card stays inside the viewport bottom (flips above)");
  ok(top < 700, "card was placed above the trigger, not below it");
  mod.hideHoverCard(); t.remove();
}

{
  mod.HOVER_CACHE.clear();
  // Trigger at the far right: card must pull back inside.
  const t = trigger("user", "u-alice", { top: 200, bottom: 220, left: 1150, right: 1190, width: 40, height: 20 });
  fire(t, "mouseover"); await sleep(D);
  const left = parseInt(card().style.left, 10);
  ok(left + 320 <= 1200, "card stays inside the viewport right edge");
  ok(left >= 12, "card respects the left edge pad");
  mod.hideHoverCard(); t.remove();
}

console.log("\nhover card — teardown");
{
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-alice");
  fire(t, "mouseover"); await sleep(D);
  ok(card().style.display === "block", "card is open before navigation");
  window.dispatchEvent(new window.Event("hashchange"));
  ok(card().style.display === "none", "navigation closes the card");
  t.remove();
}

{
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-alice");
  fire(t, "mouseover"); await sleep(D);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(card().style.display === "none", "Escape closes the card");
  t.remove();
}

{
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-alice");
  fire(t, "mouseover"); await sleep(D);
  ok(card().inert === false, "card is interactive while shown");
  mod.hideHoverCard();
  ok(card().inert === true, "card is inert while hidden (stays out of tab order)");
  t.remove();
}

{
  // Leaving the trigger should close after the grace period, but NOT
  // while the pointer is inside the card itself.
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-alice");
  fire(t, "mouseover"); await sleep(D);
  fire(card(), "mouseenter");
  fire(t, "mouseout");
  await sleep(300);
  ok(card().style.display === "block", "card stays open while the pointer is inside it");
  fire(card(), "mouseleave");
  await sleep(300);
  ok(card().style.display === "none", "card closes once the pointer leaves it");
  t.remove();
}

console.log("\nhover card — scrolling inside a scrollable rail (regression)");
{
  // REGRESSION: the close handler was bound capture-phase on window, so
  // a scroll on ANY element — including the overflow-y:auto feed rails
  // that host "Add to your network" — closed the card immediately. The
  // card must survive a scroll in an unrelated scroller and instead
  // re-anchor to its trigger.
  mod.HOVER_CACHE.clear();
  const rail = document.createElement("div");
  rail.className = "in-col-right";
  document.body.appendChild(rail);

  const t = trigger("user", "u-alice");
  rail.appendChild(t);
  fire(t, "mouseover"); await sleep(D);
  ok(card().style.display === "block", "card opens for a trigger inside a scrollable rail");

  // Scroll the RAIL, not the page. Trigger stays on screen.
  rail.dispatchEvent(new window.Event("scroll", { bubbles: false }));
  await sleep(20);
  ok(card().style.display === "block", "a scroll inside the rail does NOT close the card");

  // Now move the trigger out of view and scroll again.
  t.getBoundingClientRect = () => ({ top: -400, bottom: -380, left: 100, right: 200, width: 100, height: 20 });
  rail.dispatchEvent(new window.Event("scroll", { bubbles: false }));
  await sleep(20);
  ok(card().style.display === "none", "the card closes once its trigger scrolls out of view");
  rail.remove();
}

{
  // Re-anchoring: as the trigger moves, the card should follow it rather
  // than stay pinned to a stale coordinate.
  mod.HOVER_CACHE.clear();
  const t = trigger("user", "u-alice", { top: 300, bottom: 320, left: 100, right: 200, width: 100, height: 20 });
  fire(t, "mouseover"); await sleep(D);
  const before = parseInt(card().style.top, 10);
  t.getBoundingClientRect = () => ({ top: 240, bottom: 260, left: 100, right: 200, width: 100, height: 20 });
  window.dispatchEvent(new window.Event("scroll"));
  await sleep(20);
  const after = parseInt(card().style.top, 10);
  ok(after !== before, "card re-anchors to the trigger's new position on scroll");
  ok(after < before, "card followed the trigger upward");
  mod.hideHoverCard(); t.remove();
}

console.log("\nhover card — descender clipping (regression)");
{
  // REGRESSION: .hc-sub / .hc-desc clamp with -webkit-line-clamp, which
  // clips at the computed line-box height and IGNORES padding-bottom.
  // Job titles with descenders ("Senior Design Manager @ Apogee") had
  // their tails sheared. They need explicit max-height headroom instead.
  const css = readFileSync("assets/css/app.css", "utf8");
  const block = (sel) => {
    const i = css.indexOf(sel + " {");
    return i === -1 ? "" : css.slice(i, css.indexOf("}", i));
  };
  for (const sel of [".in-hovercard .hc-sub", ".in-hovercard .hc-desc"]) {
    const b = block(sel);
    ok(/-webkit-line-clamp:\s*2/.test(b), `${sel} clamps to 2 lines`);
    ok(/max-height:\s*([\d.]+)em/.test(b), `${sel} sets explicit max-height (padding-bottom does not work under line-clamp)`);
    const lh = parseFloat((/line-height:\s*([\d.]+)/.exec(b) || [])[1] || "0");
    const mh = parseFloat((/max-height:\s*([\d.]+)em/.exec(b) || [])[1] || "0");
    ok(mh > lh * 2, `${sel} max-height (${mh}em) exceeds 2 line-boxes (${(lh * 2).toFixed(2)}em) so descenders clear`);
    ok(!/padding-bottom/.test(b), `${sel} no longer relies on padding-bottom under line-clamp`);
  }
}

console.log("\nhover card — malformed triggers");
{
  apiCalls = [];
  const bad = document.createElement("span");
  bad.dataset.hoverCard = "user";      // no uuid
  document.body.appendChild(bad);
  fire(bad, "mouseover"); await sleep(D);
  ok(apiCalls.length === 0, "a trigger missing its uuid never fetches");
  bad.remove();

  const bad2 = trigger("bogus", "x");
  fire(bad2, "mouseover"); await sleep(D);
  ok(apiCalls.length === 0, "an unrecognised card type never fetches");
  bad2.remove();
}

console.log("\nhover card — descender clipping (CSS regression)");
{
  // Any rule that pairs overflow:hidden with a fixed line box must leave
  // room for descenders in the TALLEST font the stack can fall back to.
  // Inter's glyph box is ~1.21em; Segoe UI (the Windows fallback, since
  // Inter is never actually loaded via @font-face) is ~1.33em. Rules
  // tuned to Inter shear "g/j/p/q/y" on Windows — which is exactly the
  // bug this guards against.
  const css = readFileSync("assets/css/app.css", "utf8");
  const SEGOE = (2210 + 514) / 2048;   // Segoe UI ascent+descent / unitsPerEm

  const block = css.slice(css.indexOf("Hover cards — profile / company previews"));
  const rules = [...block.matchAll(/\.in-hovercard\s+\.(hc-[a-z-]+)\s*\{([^}]*)\}/g)];
  ok(rules.length > 0, "hover card rules are present in app.css");

  let clipped = [];
  for (const [, name, body] of rules) {
    if (!/overflow\s*:\s*hidden/.test(body)) continue;
    const fsM = /font-size\s*:\s*([\d.]+)px/.exec(body);
    const lhM = /line-height\s*:\s*([\d.]+)/.exec(body);
    if (!fsM) continue;
    ok(!!lhM, `.${name} declares an explicit line-height (it clips overflow)`);
    if (!lhM) { clipped.push(name); continue; }
    const fs = parseFloat(fsM[1]), lh = parseFloat(lhM[1]);
    const headroom = (fs * lh - fs * SEGOE) / 2;
    ok(headroom >= 0, `.${name} line box clears the Segoe UI glyph box (${headroom.toFixed(2)}px headroom)`);
    if (headroom < 0) clipped.push(name);
  }
  ok(clipped.length === 0, "no hover card text rule shears descenders on a tall-metric fallback font");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

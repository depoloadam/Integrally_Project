// =====================================================================
// shell.js — shared core for the Integrally app
//   config, helpers, api(), modal system, auth guard/boot, nav,
//   dropdowns, hash router, settings placeholder.
//   Loaded FIRST. profile.js and feed.js depend on these globals.
// =====================================================================

// ---- CONFIG ----------------------------------------------------------
const API_BASE  = "/integrally/api";
const AUTH_PAGE = "index.html";
const COMPANY_AUTH_PAGE = "company.html";   // dedicated company sign-in / signup page

// ---- shared helpers --------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));

let ME = null;   // current logged-in user (shared across views)

// ---- API helper ------------------------------------------------------
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" }, credentials: "include" };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (res.status === 429) handleRateLimited(data);
  return { ok: res.ok, status: res.status, data };
}

// ---- rate limiting ---------------------------------------------------
// The backend (src/RateLimit.php) throttles per actor and answers 429 with
// { code: "rate_limited", error: "<human message>" }. Surfacing that HERE
// rather than at every call site means a new endpoint gets the behaviour
// for free — callers still see { ok:false } and can render their own
// inline error as usual, they just don't have to know 429 exists.
//
// Guarded against double-firing: several of our views issue parallel
// requests on load, and a burst of six identical toasts helps nobody.
let _rlLastToast = 0;
function handleRateLimited(data) {
  const now = Date.now();
  if (now - _rlLastToast < 3000) return;
  _rlLastToast = now;
  const msg = (data && data.error) || "You're doing that too quickly. Please slow down.";
  toast(msg, "err");
}

// ---- modal system ----------------------------------------------------
function openModal(html, opts) {
  const m = $("modal");
  m.classList.toggle("wide", !!(opts && opts.wide));
  m.innerHTML = html;
  $("overlay").classList.add("show");
}
function closeModal() { $("overlay").classList.remove("show"); const m = $("modal"); m.innerHTML = ""; m.classList.remove("wide"); }

// ---- toast notifications ----------------------------------------------
// Small auto-dismissing confirmation in the bottom-right corner. Use for
// "it worked" feedback that shouldn't interrupt (saves, toggles). Stays
// visible regardless of scroll position, unlike inline status text.
//   toast("Saved.")            -> success styling
//   toast("Failed.", "err")    -> error styling
function toast(message, kind = "ok") {
  let holder = document.getElementById("toast-holder");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "toast-holder";
    document.body.appendChild(holder);
  }
  const t = document.createElement("div");
  t.className = "in-toast " + (kind === "err" ? "err" : "ok");
  t.textContent = message;
  holder.appendChild(t);
  // enter -> hold -> exit -> remove
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2600);
}
// Close on overlay click, but ONLY when the press started on the overlay
// itself. Without the mousedown guard, selecting text inside the modal and
// releasing the mouse outside it registers as an overlay click and closes
// the window — a very easy accidental dismiss.
let overlayPressOnBackdrop = false;
$("overlay").addEventListener("mousedown", e => { overlayPressOnBackdrop = (e.target.id === "overlay"); });
$("overlay").addEventListener("click", e => {
  if (e.target.id === "overlay" && overlayPressOnBackdrop) closeModal();
  overlayPressOnBackdrop = false;
});
window.closeModal = closeModal;   // for inline onclick handlers

// ---- image upload helper (multipart, not JSON) -----------------------
async function uploadImage(file) {
  const fd = new FormData();
  fd.append("image", file);
  try {
    const res = await fetch(API_BASE + "/upload/image.php", { method:"POST", credentials:"include", body:fd });
    const data = await res.json();
    return (res.ok && data.success) ? data.data : null;
  } catch (e) { return null; }
}

// Avatar upload: hits the dedicated endpoint that center-crops + resizes
// to a crisp 256px square (sharp on Retina, small on disk).
async function uploadAvatar(file) {
  const fd = new FormData();
  fd.append("image", file);
  try {
    const res = await fetch(API_BASE + "/upload/avatar.php", { method:"POST", credentials:"include", body:fd });
    const data = await res.json();
    return (res.ok && data.success) ? data.data : null;
  } catch (e) { return null; }
}

// Reusable avatar uploader. Inserts an avatar preview + Upload/Remove
// controls into `mountId`, and tracks the chosen URL on a state object.
// `state.avatarUrl` holds the current value (read it when saving).
// `shape` is "circle" (users) or "square" (companies).
function mountAvatarPicker(mountId, state, opts = {}) {
  const shape = opts.shape === "square" ? "square" : "circle";
  const fallback = (opts.fallbackChar || "?").toString().charAt(0).toUpperCase();
  const host = $(mountId);
  if (!host) return;

  const render = () => {
    const url = state.avatarUrl;
    host.innerHTML = `
      <div class="avatar-picker">
        <div class="avatar-pick-preview ${shape}">${url ? `<img src="${esc(url)}" alt="">` : esc(fallback)}</div>
        <div class="avatar-pick-controls">
          <button type="button" class="in-btn ghost" id="${mountId}-btn" style="flex:none;padding:8px 14px">${url ? "Change photo" : "Upload photo"}</button>
          ${url ? `<button type="button" class="in-btn ghost" id="${mountId}-rm" style="flex:none;padding:8px 14px">Remove</button>` : ""}
          <div class="avatar-pick-msg" id="${mountId}-msg"></div>
        </div>
        <input type="file" id="${mountId}-file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none">
      </div>`;

    $(`${mountId}-btn`).onclick = () => $(`${mountId}-file`).click();
    const rm = $(`${mountId}-rm`);
    if (rm) rm.onclick = () => { state.avatarUrl = null; render(); };

    $(`${mountId}-file`).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const msg = $(`${mountId}-msg`);
      msg.textContent = "Uploading…"; msg.className = "avatar-pick-msg";
      const up = await uploadAvatar(file);
      if (up && up.url) { state.avatarUrl = up.url; render(); }
      else { msg.textContent = "Upload failed. Use a JPG/PNG/GIF/WEBP under 5 MB."; msg.className = "avatar-pick-msg err"; }
    };
  };
  render();
}
window.mountAvatarPicker = mountAvatarPicker;

// =====================================================================
// Rich-text editor: a contentEditable area with a formatting toolbar
// (bold, italic, underline, color, size). Returns an object with
// .getHTML() so callers can read the content on save. Shared by the
// post composer and the job editor.
//
// Security note: this produces HTML, but the SERVER sanitizes it on save
// (src/RichText.php). Never trust this output directly — it's only safe
// because the backend whitelists it.
// =====================================================================
const RT_COLORS = ["#0b1f2a", "#0d9488", "#c0392b", "#2563eb", "#7c3aed", "#d97706", "#16a34a", "#6b8590"];
const RT_SIZES  = [["Small", "12px"], ["Normal", "16px"], ["Large", "24px"], ["Huge", "32px"]];

function mountRichEditor(mountId, opts = {}) {
  const host = $(mountId);
  if (!host) return null;
  const placeholder = opts.placeholder || "Write something…";
  const initialHTML = opts.html || "";

  host.innerHTML = `
    <div class="rt-editor">
      <div class="rt-toolbar">
        <button type="button" class="rt-btn" data-cmd="bold" title="Bold"><b>B</b></button>
        <button type="button" class="rt-btn" data-cmd="italic" title="Italic"><i>I</i></button>
        <button type="button" class="rt-btn" data-cmd="underline" title="Underline"><u>U</u></button>
        <span class="rt-sep"></span>
        <span class="rt-color-wrap">
          <button type="button" class="rt-btn" id="${mountId}-colorbtn" title="Text color">A<span class="rt-color-bar"></span></button>
          <div class="rt-color-menu" id="${mountId}-colormenu">
            ${RT_COLORS.map(c => `<button type="button" class="rt-swatch" data-color="${c}" style="background:${c}"></button>`).join("")}
          </div>
        </span>
        <select class="rt-size" id="${mountId}-size" title="Text size">
          ${RT_SIZES.map(([lbl, px]) => `<option value="${px}"${px === "16px" ? " selected" : ""}>${lbl}</option>`).join("")}
        </select>
      </div>
      <div class="rt-area" id="${mountId}-area" contenteditable="true" data-placeholder="${esc(placeholder)}">${initialHTML}</div>
    </div>`;

  const area = $(`${mountId}-area`);

  // Selection-only formatting: a command applies to highlighted text. With
  // no selection we do nothing and briefly hint, which avoids the whole
  // class of contentEditable "pending format" bugs.
  const hasSelection = () => {
    const sel = window.getSelection();
    return sel && sel.rangeCount && !sel.isCollapsed && area.contains(sel.anchorNode);
  };
  let hintTimer = null;
  function flashHint() {
    const tb = host.querySelector(".rt-toolbar");
    if (!tb) return;
    tb.classList.add("rt-hint");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => tb.classList.remove("rt-hint"), 900);
  }

  const exec = (cmd, val = null) => {
    if (!hasSelection()) { flashHint(); return; }
    area.focus();
    document.execCommand(cmd, false, val);
    syncToolbar();
  };

  host.querySelectorAll(".rt-btn[data-cmd]").forEach(b => {
    b.onmousedown = (e) => { e.preventDefault(); };   // keep selection
    b.onclick = () => exec(b.dataset.cmd);
  });

  // Color menu
  const colorBtn = $(`${mountId}-colorbtn`);
  const colorMenu = $(`${mountId}-colormenu`);
  colorBtn.onmousedown = (e) => e.preventDefault();
  colorBtn.onclick = (e) => { e.preventDefault(); colorMenu.classList.toggle("show"); };
  colorMenu.querySelectorAll(".rt-swatch").forEach(s => {
    s.onmousedown = (e) => e.preventDefault();
    s.onclick = () => {
      if (!hasSelection()) { flashHint(); colorMenu.classList.remove("show"); return; }
      const color = s.dataset.color;
      area.focus();
      document.execCommand("foreColor", false, color);
      area.querySelectorAll("font[color]").forEach(f => {
        const span = document.createElement("span");
        span.style.color = f.getAttribute("color");
        span.innerHTML = f.innerHTML;
        f.parentNode.replaceChild(span, f);
      });
      colorMenu.classList.remove("show");
    };
  });
  document.addEventListener("click", (e) => {
    if (!colorBtn.contains(e.target) && !colorMenu.contains(e.target)) colorMenu.classList.remove("show");
  });

  // Apply a font size to the current selection (wrap in a styled span).
  const sizeSelect = $(`${mountId}-size`);
  const applySize = (px) => {
    if (!px) return;
    area.focus();
    const sel = window.getSelection();
    // Selection-only model: formatting applies to highlighted text. If
    // nothing is selected, do nothing (and nudge the user once).
    if (!sel || !sel.rangeCount || sel.isCollapsed || !area.contains(sel.anchorNode)) {
      flashHint();
      syncToolbar();   // revert the dropdown to reflect the real caret state
      return;
    }
    document.execCommand("fontSize", false, "7");   // tag selection as font[size=7]
    area.querySelectorAll('font[size="7"]').forEach(f => {
      const span = document.createElement("span");
      span.style.fontSize = px;
      span.innerHTML = f.innerHTML;
      f.parentNode.replaceChild(span, f);
    });
    syncToolbar();
  };
  sizeSelect.addEventListener("change", (e) => applySize(e.target.value));

  // --- selection tracking: reflect the current selection's formatting in
  // the toolbar (bold/italic/underline active states + the size dropdown),
  // like a normal word processor. ---
  const sizeFromNode = (node) => {
    let el2 = (node && node.nodeType === 3) ? node.parentElement : node;
    while (el2 && el2 !== area) {
      if (el2.style && el2.style.fontSize) return el2.style.fontSize;
      el2 = el2.parentElement;
    }
    return "16px"; // default
  };

  let syncing = false;
  function syncToolbar() {
    if (syncing) return;
    syncing = true;
    try {
      const sel = window.getSelection();
      const inside = sel && sel.rangeCount && area.contains(sel.anchorNode);
      if (inside) {
        host.querySelector('[data-cmd="bold"]').classList.toggle("active", document.queryCommandState("bold"));
        host.querySelector('[data-cmd="italic"]').classList.toggle("active", document.queryCommandState("italic"));
        host.querySelector('[data-cmd="underline"]').classList.toggle("active", document.queryCommandState("underline"));
        // Reflect the size of wherever the caret/selection is.
        const px = sizeFromNode(sel.anchorNode);
        // Snap to the closest option we offer.
        const opts = Array.from(sizeSelect.options).map(o => o.value);
        if (opts.includes(px)) sizeSelect.value = px;
      }
    } finally { syncing = false; }
  }

  // Update the toolbar as the selection moves within this editor.
  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && area.contains(sel.anchorNode)) syncToolbar();
  });
  area.addEventListener("keyup", syncToolbar);
  area.addEventListener("mouseup", syncToolbar);
  area.addEventListener("focus", syncToolbar);

  return {
    getHTML: () => area.innerHTML,
    getText: () => area.innerText.replace(/\u200B/g, "").trim(),
    clear:   () => { area.innerHTML = ""; },
    focus:   () => area.focus(),
    el: area,
  };
}
window.mountRichEditor = mountRichEditor;

// Set the small nav avatar to an image (if url) or fall back to initials.
function setNavAvatar(url, initial) {
  const ava = $("nav-ava");
  if (!ava) return;
  if (url) { ava.innerHTML = `<img src="${esc(url)}" alt="">`; }
  else { ava.textContent = initial; }
}

// ---- auth guard + boot -----------------------------------------------
async function boot() {
  setupFooter();
  // One identity at a time. Load whichever session exists.
  await loadCompanySession();   // sets CO
  const { ok, data } = await api("/auth/me.php");
  ME = (ok && data?.success) ? data.data : null;

  if (ME) {
    // ---- USER identity ----
    CO = null;                              // enforce single identity in UI
    updateCompanyNav();                     // removes/hides any company tab
    const initial = (ME.username || "?").charAt(0).toUpperCase();
    $("nav-user").textContent = "@" + ME.username;
    setNavAvatar(ME.profile_pic, initial);
    $("profile-menu").style.display = "";
    $("auth-menu").style.display = "none";
    if ($("search-trigger")) $("search-trigger").style.display = "inline-flex";
    document.querySelectorAll("[data-nav]").forEach(b => b.style.display = "");
    // The company-only Feed button stays hidden for users (they have their own).
    const coFeedBtn = document.querySelector('[data-nav="company-feed"]');
    if (coFeedBtn) coFeedBtn.style.display = "none";
    const adminBtn = document.querySelector('[data-nav="admin"]');
    if (adminBtn) adminBtn.style.display = (ME.role === "admin") ? "" : "none";
    if (typeof setupNotifications === "function") setupNotifications();
    if (typeof setupMessaging === "function") setupMessaging();
    routeFromHash();
  } else if (CO) {
    // ---- COMPANY identity ---- (no user signed in)
    $("profile-menu").style.display = "none";
    $("auth-menu").style.display = "none";   // hide user sign in/up to avoid confusion
    if ($("search-trigger")) $("search-trigger").style.display = "inline-flex";
    setupCompanyIdentityNav();               // company avatar + sign-out menu
    // Company sees: Feed, Jobs, Connect (to follow people/companies for
    // its Following feed), and its Company dashboard.
    document.querySelectorAll("[data-nav]").forEach(b => {
      const n = b.dataset.nav;
      b.style.display = (n === "company-feed" || n === "jobs" || n === "connect" || n === "company-dashboard") ? "" : "none";
    });
    updateCompanyNav();
    if (typeof setupNotifications === "function") setupNotifications();
    if (typeof hideMessaging === "function") hideMessaging();   // v1: users only
    const raw = location.hash.replace(/^#/, "");
    if (raw === "jobs" || raw === "notifications" || raw === "connect"
        || raw.startsWith("job/") || raw.startsWith("company")
        || raw.startsWith("user/") || raw.startsWith("post/")
        || FOOTER_PAGES[raw]) routeFromHash();
    else location.hash = "company-dashboard";
  } else {
    // ---- SIGNED OUT ----
    $("profile-menu").style.display = "none";
    $("auth-menu").style.display = "";
    if ($("search-trigger")) $("search-trigger").style.display = "none";
    if (typeof hideNotifications === "function") hideNotifications();
    if (typeof hideMessaging === "function") hideMessaging();
    renderSignedOut();
  }
}

// When logged in as a company, present the company as the nav identity
// (reusing the profile menu area) with a sign-out action.
function setupCompanyIdentityNav() {
  if (!CO) return;
  const menu = $("profile-menu");
  menu.style.display = "";
  const initial = (CO.name || "?").charAt(0).toUpperCase();
  $("nav-user").textContent = CO.name;
  setNavAvatar(CO.logo, initial);
  // Rewire the dropdown for company context.
  const dd = $("profile-dropdown");
  dd.innerHTML = `
    <button data-co-menu="dashboard">Company dashboard</button>
    <button data-co-menu="settings">Settings</button>
    <div class="in-dropdown-sep"></div>
    <button data-co-menu="signout" class="danger">Sign out</button>`;
  dd.querySelectorAll("[data-co-menu]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      dd.classList.remove("show");
      if (b.dataset.coMenu === "dashboard") location.hash = "company-dashboard";
      else if (b.dataset.coMenu === "settings") location.hash = "company-settings";
      else { await api("/company/logout.php", "POST"); CO = null; location.hash = ""; location.reload(); }
    };
  });
}

function renderSignedOut() {
  document.querySelectorAll("[data-nav]").forEach(b => b.style.display = "none");
  // Jobs browsing is public — keep it reachable when signed out.
  const jobsBtn = document.querySelector('[data-nav="jobs"]');
  if (jobsBtn) jobsBtn.style.display = "";
  updateCompanyNav();   // shows the Company tab if a company session exists
  // If the visitor is heading somewhere public, honor it; else welcome.
  const raw = location.hash.replace(/^#/, "");
  if (raw === "jobs" || raw.startsWith("job/") || raw.startsWith("company") || FOOTER_PAGES[raw]) {
    routeFromHash();
    return;
  }
  $("view").innerHTML = `
    <div class="landing">

      <div class="landing-hero">
        <div class="landing-hero-inner">
          <div class="landing-eyebrow">The career network that keeps score</div>
          <h1>Know where you stand.<br><span class="acc">Get where you're going.</span></h1>
          <p>Integrally is a career network with a live scoring engine — see how your skills
             and experience measure up against real job titles and fields, then connect with
             the people and companies that matter.</p>
          <div class="landing-cta-row">
            <button class="in-btn primary landing-cta" id="land-start">Get started — it's free</button>
            <button class="in-btn ghost landing-cta ghost-dark" id="land-jobs">Browse open jobs</button>
          </div>
          <div class="landing-hero-note">Hiring? <a href="#" id="land-co">Create a company page →</a></div>
        </div>
      </div>

      <div class="landing-features">
        <div class="landing-feature">
          <div class="landing-feature-icon">📈</div>
          <h3>Live career scores</h3>
          <p>Your profile is scored against job titles, skills, and whole fields — and the
             numbers move as you grow. No more guessing how you stack up.</p>
        </div>
        <div class="landing-feature">
          <div class="landing-feature-icon">🤝</div>
          <h3>Follow &amp; connect</h3>
          <p>Follow people and companies, share updates, and build a feed of posts and
             conversations that actually matter to your career.</p>
        </div>
        <div class="landing-feature">
          <div class="landing-feature-icon">💼</div>
          <h3>Real openings</h3>
          <p>Browse jobs from verified companies and link your work history to real
             employers — your experience, backed up.</p>
        </div>
      </div>

      <div class="landing-steps">
        <h2>How it works</h2>
        <div class="landing-steps-row">
          <div class="landing-step">
            <div class="landing-step-num">1</div>
            <h4>Build your profile</h4>
            <p>Add your experience, education, and skills — it takes minutes.</p>
          </div>
          <div class="landing-step">
            <div class="landing-step-num">2</div>
            <h4>Get scored</h4>
            <p>The engine evaluates you against titles and fields you care about.</p>
          </div>
          <div class="landing-step">
            <div class="landing-step-num">3</div>
            <h4>Connect &amp; grow</h4>
            <p>Follow companies, engage with your network, and find your next role.</p>
          </div>
        </div>
      </div>

      <div class="landing-coband">
        <div>
          <h3>Hiring? Set up your company page</h3>
          <p>Post openings, share updates, and let candidates follow you.</p>
        </div>
        <div class="landing-coband-btns">
          <button class="in-btn primary" style="flex:none;padding:10px 20px" id="land-co-reg">Create a company account</button>
          <button class="in-btn ghost" style="flex:none;padding:10px 20px" id="land-co-login">Company sign in</button>
        </div>
      </div>

      <div class="landing-final">
        <h2>Ready to see your score?</h2>
        <button class="in-btn primary landing-cta" id="land-start2">Join Integrally</button>
      </div>

    </div>`;

  $("land-start").onclick  = () => { window.location.href = AUTH_PAGE; };
  $("land-start2").onclick = () => { window.location.href = AUTH_PAGE; };
  $("land-jobs").onclick   = () => { location.hash = "jobs"; };
  $("land-co").onclick       = (e) => { e.preventDefault(); window.location.href = COMPANY_AUTH_PAGE + "#register"; };
  $("land-co-reg").onclick   = () => { window.location.href = COMPANY_AUTH_PAGE + "#register"; };
  $("land-co-login").onclick = () => { window.location.href = COMPANY_AUTH_PAGE; };
}

// ---- signed-out auth dropdown (sign up link + inline sign in) ---------
const authDrop = $("auth-dropdown");
$("auth-trigger").onclick = (e) => { e.stopPropagation(); authDrop.classList.toggle("show"); };
authDrop.addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => authDrop.classList.remove("show"));
authDrop.querySelector(".in-auth-signup").onclick = () => { window.location.href = AUTH_PAGE; };
const coAuthLink = authDrop.querySelector('[data-auth="company"]');
if (coAuthLink) coAuthLink.onclick = () => { authDrop.classList.remove("show"); window.location.href = COMPANY_AUTH_PAGE; };
$("qs-go").onclick = async () => {
  const login = $("qs-login").value.trim();
  const password = $("qs-pass").value;
  const msg = $("qs-msg");
  msg.className = "in-auth-msg";
  if (!login || !password) { msg.textContent = "Enter your login and password."; msg.className = "in-auth-msg show"; return; }
  const btn = $("qs-go"); btn.disabled = true; btn.textContent = "Signing in…";
  const r = await api("/auth/login.php", "POST", { login, password });
  if (r.ok && r.data?.success) { location.reload(); }
  else { msg.textContent = r.data?.error || "Sign in failed."; msg.className = "in-auth-msg show"; btn.disabled = false; btn.textContent = "Sign in"; }
};
$("qs-pass").addEventListener("keydown", e => { if (e.key === "Enter") $("qs-go").click(); });

// ---- profile dropdown menu (logged-in) -------------------------------
const dropdown = $("profile-dropdown");
$("profile-trigger").onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle("show"); };
document.addEventListener("click", () => dropdown.classList.remove("show"));
dropdown.querySelectorAll("[data-menu]").forEach(b => {
  b.onclick = async (e) => {
    e.stopPropagation();
    dropdown.classList.remove("show");
    const action = b.dataset.menu;
    if (action === "signout") {
      await api("/auth/logout.php", "POST");
      location.hash = "";
      location.reload();
    } else if (action === "edit") {
      if (location.hash !== "#profile") location.hash = "profile";
      const prof = await api("/profile/get.php");
      const p = prof.data?.data || {};
      editCore(p, p.attributes?.headline?.value || "", p.attributes || {});
    } else if (action === "settings") {
      location.hash = "settings";
    }
  };
});

// ---- nav tabs --------------------------------------------------------
function showTab(name) {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === name));
  if (name === "feed") renderFeed();
  else if (name === "admin") renderAdmin();
  else if (name === "jobs") renderJobs();
  else if (name === "connect") renderConnect();
  else if (name === "company-dashboard") renderCompanyDashboard();
  else if (name === "company-feed") renderCompanyFeed();
  else if (name === "company-employees") renderCompanyEmployees();
  else renderProfile();
}
document.querySelectorAll("[data-nav]").forEach(b => {
  b.onclick = () => {
    if (location.hash !== "#" + b.dataset.nav) location.hash = b.dataset.nav;
    else showTab(b.dataset.nav);
  };
});

// ---- clickable logo -> home (feed) -----------------------------------
const brandHome = $("brand-home");
if (brandHome) {
  const goHome = (e) => {
    if (e) e.preventDefault();
    if (!ME) {
      // Logged in as a COMPANY (no user session): home is the dashboard.
      if (CO) {
        if (location.hash === "#company-dashboard") renderCompanyDashboard();
        else location.hash = "company-dashboard";
        return;
      }
      // Signed out: feed isn't available — show the welcome view.
      if (location.hash) location.hash = "";   // fires hashchange -> guarded router
      else renderSignedOut();                   // already at root -> re-render directly
      return;
    }
    if (location.hash === "#feed" || location.hash === "") {
      showTab("feed");
    } else {
      location.hash = "feed";
    }
  };
  brandHome.addEventListener("click", goHome);
  brandHome.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") goHome(e); });
}

// ---- hash router -----------------------------------------------------
// ---- footer: standard pages (placeholders — content added later) -----
const FOOTER_PAGES = {
  about: {
    title: "About Us",
    body: `<p>Integrally is a career and social networking platform built to help people understand where they stand — and where they can grow — in their professional field.</p>
           <p>This page is a placeholder. Content about our mission, team, and story will go here.</p>`,
  },
  careers: {
    title: "Careers",
    body: `<p>We're not listing open roles yet, but check back soon.</p>
           <p>This page is a placeholder. Open positions and hiring info will go here.</p>`,
  },
  contact: {
    title: "Contact",
    body: `<p>Have a question or feedback? We'd love to hear from you.</p>
           <p>This page is a placeholder. Contact details and a message form will go here.</p>`,
  },
  help: {
    title: "Help",
    body: `<p>Need a hand using Integrally? Answers to common questions will live here.</p>
           <p>This page is a placeholder. A full help center will go here.</p>`,
  },
  privacy: {
    title: "Privacy Policy",
    body: `<p>This Privacy Policy explains how Integrally collects, uses, and protects your information.</p>
           <p>This page is a placeholder. The full privacy policy will go here.</p>`,
  },
  terms: {
    title: "Terms of Service",
    body: `<p>These Terms of Service govern your use of Integrally.</p>
           <p>This page is a placeholder. The full terms will go here.</p>`,
  },
};

function renderFooterPage(key) {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  const page = FOOTER_PAGES[key];
  const view = $("view");
  if (!page) { view.innerHTML = `<div class="in-card2"><div class="in-empty">Page not found.</div></div>`; return; }
  view.innerHTML = "";
  view.appendChild(el(`
    <div class="in-back"><button class="in-back-btn" onclick="history.length>1?history.back():location.hash=''">‹ Back</button></div>`));
  view.appendChild(el(`
    <div class="in-card2 in-staticpage">
      <h1>${esc(page.title)}</h1>
      <div class="in-staticpage-body">${page.body}</div>
    </div>`));
}

function setupFooter() {
  const yearEl = $("footer-year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  document.querySelectorAll("[data-footer-nav]").forEach(b => {
    b.onclick = () => { location.hash = b.dataset.footerNav; };
  });
}

function routeFromHash() {
  const raw = location.hash.replace(/^#/, "");
  // Leaving the search page unpins (and closes) the search bar.
  if (!(raw === "search" || raw.startsWith("search/"))) {
    if (typeof setSearchbarPinned === "function") {
      setSearchbarPinned(false);
      const bar = $("searchbar"), trig = $("search-trigger");
      if (bar) { bar.classList.remove("open"); bar.setAttribute("aria-hidden", "true"); }
      if (trig) { trig.classList.remove("open"); trig.setAttribute("aria-expanded", "false"); }
    }
  }
  if (FOOTER_PAGES[raw]) {
    renderFooterPage(raw);
    return;
  }
  if (raw.startsWith("user/")) {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderPublicProfile(raw.slice("user/".length));
    return;
  }
  if (raw === "settings" || raw.startsWith("settings/")) {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    // #settings/<tab> deep-links straight to a tab (e.g. the score
    // privacy controls, linked from the ⚙ on the profile Scores card).
    const tab = raw.startsWith("settings/") ? raw.slice("settings/".length) : null;
    renderSettings(tab);
    return;
  }
  if (raw === "ai-skillset") {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderAiSkillset();
    return;
  }
  if (raw === "profile-strength") {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderStrengthPage();
    return;
  }
  if (raw.startsWith("score-history/")) {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderScoreHistory(raw.slice("score-history/".length));
    return;
  }
  if (raw.startsWith("score/")) {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderScoreBreakdown(raw.slice("score/".length));
    return;
  }
  if (raw === "admin") {
    showTab("admin");
    return;
  }
  if (raw === "jobs") {
    showTab("jobs");
    return;
  }
  if (raw === "connect") {
    showTab("connect");
    return;
  }
  if (raw === "notifications") {
    renderNotificationsPage();
    return;
  }
  if (raw === "search" || raw.startsWith("search/")) {
    renderSearchPage(raw.startsWith("search/") ? raw.slice("search/".length) : null);
    return;
  }
  if (raw === "messages" || raw.startsWith("messages/")) {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderMessagesPage(raw.startsWith("messages/") ? raw.slice("messages/".length) : null);
    return;
  }
  if (raw.startsWith("post/")) {
    renderSinglePost(raw.slice("post/".length));
    return;
  }
  if (raw === "company-dashboard") {
    showTab("company-dashboard");
    return;
  }
  if (raw === "company-settings") {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderCompanySettings();
    return;
  }
  if (raw === "company-employees") {
    showTab("company-employees");
    return;
  }
  if (raw === "company-feed") {
    showTab("company-feed");
    return;
  }
  if (raw.startsWith("job/")) {
    renderJobDetail(raw.slice("job/".length));
    return;
  }
  if (raw.startsWith("company/")) {
    renderCompanyProfile(raw.slice("company/".length));
    return;
  }
  // Feed and profile require a user session. If signed out, show welcome.
  if (!ME) { renderSignedOut(); return; }
  showTab(raw === "profile" ? "profile" : "feed");
}
window.addEventListener("hashchange", routeFromHash);

// ---- settings view lives in profile.js (renderSettings) --------------
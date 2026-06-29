// =====================================================================
// shell.js — shared core for the Integrally app
//   config, helpers, api(), modal system, auth guard/boot, nav,
//   dropdowns, hash router, settings placeholder.
//   Loaded FIRST. profile.js and feed.js depend on these globals.
// =====================================================================

// ---- CONFIG ----------------------------------------------------------
const API_BASE  = "/integrally/api";
const AUTH_PAGE = "index.html";

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
  return { ok: res.ok, status: res.status, data };
}

// ---- modal system ----------------------------------------------------
function openModal(html) { $("modal").innerHTML = html; $("overlay").classList.add("show"); }
function closeModal() { $("overlay").classList.remove("show"); $("modal").innerHTML = ""; }
$("overlay").addEventListener("click", e => { if (e.target.id === "overlay") closeModal(); });
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
    document.querySelectorAll("[data-nav]").forEach(b => b.style.display = "");
    const adminBtn = document.querySelector('[data-nav="admin"]');
    if (adminBtn) adminBtn.style.display = (ME.role === "admin") ? "" : "none";
    routeFromHash();
  } else if (CO) {
    // ---- COMPANY identity ---- (no user signed in)
    $("profile-menu").style.display = "none";
    $("auth-menu").style.display = "none";   // hide user sign in/up to avoid confusion
    setupCompanyIdentityNav();               // company avatar + sign-out menu
    // Company sees: Jobs + their Company dashboard only.
    document.querySelectorAll("[data-nav]").forEach(b => {
      const n = b.dataset.nav;
      b.style.display = (n === "jobs" || n === "company-dashboard") ? "" : "none";
    });
    updateCompanyNav();
    const raw = location.hash.replace(/^#/, "");
    if (raw === "jobs" || raw.startsWith("job/") || raw.startsWith("company")) routeFromHash();
    else location.hash = "company-dashboard";
  } else {
    // ---- SIGNED OUT ----
    $("profile-menu").style.display = "none";
    $("auth-menu").style.display = "";
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
    <div class="in-dropdown-sep"></div>
    <button data-co-menu="signout" class="danger">Sign out</button>`;
  dd.querySelectorAll("[data-co-menu]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      dd.classList.remove("show");
      if (b.dataset.coMenu === "dashboard") location.hash = "company-dashboard";
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
  if (raw === "jobs" || raw.startsWith("job/") || raw.startsWith("company")) {
    routeFromHash();
    return;
  }
  $("view").innerHTML = `
    <div class="in-card2" style="text-align:center;padding:60px 22px;max-width:480px;margin:40px auto">
      <h2 style="justify-content:center;font-size:22px;text-transform:none;letter-spacing:-0.3px">Welcome to Integrally</h2>
      <div class="in-empty" style="font-style:normal;margin:8px 0 22px">
        Create an account to build your profile, get scored, and connect —
        or sign in from the menu above.
      </div>
      <button class="in-btn primary" style="flex:none;padding:11px 24px" onclick="window.location.href='${AUTH_PAGE}'">Get started</button>
    </div>`;
}

// ---- signed-out auth dropdown (sign up link + inline sign in) ---------
const authDrop = $("auth-dropdown");
$("auth-trigger").onclick = (e) => { e.stopPropagation(); authDrop.classList.toggle("show"); };
authDrop.addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => authDrop.classList.remove("show"));
authDrop.querySelector(".in-auth-signup").onclick = () => { window.location.href = AUTH_PAGE; };
const coAuthLink = authDrop.querySelector('[data-auth="company"]');
if (coAuthLink) coAuthLink.onclick = () => { authDrop.classList.remove("show"); openCompanyAuth("login"); };
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
      editCore(p, p.attributes?.headline?.value || "");
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
function routeFromHash() {
  const raw = location.hash.replace(/^#/, "");
  if (raw.startsWith("user/")) {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderPublicProfile(raw.slice("user/".length));
    return;
  }
  if (raw === "settings") {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderSettings();
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
  if (raw === "company-dashboard") {
    showTab("company-dashboard");
    return;
  }
  if (raw === "company-employees") {
    showTab("company-employees");
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
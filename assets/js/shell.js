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
    $("nav-ava").textContent = initial;
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
  $("nav-ava").textContent = initial;
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
  else if (name === "company-dashboard") renderCompanyDashboard();
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
  if (raw === "company-dashboard") {
    showTab("company-dashboard");
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
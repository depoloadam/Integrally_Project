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
  const { ok, data } = await api("/auth/me.php");
  if (ok && data?.success) {
    ME = data.data;
    const initial = (ME.username || "?").charAt(0).toUpperCase();
    $("nav-user").textContent = "@" + ME.username;
    $("nav-ava").textContent = initial;
    $("profile-menu").style.display = "";
    $("auth-menu").style.display = "none";
    document.querySelectorAll("[data-nav]").forEach(b => b.style.display = "");
    const adminBtn = document.querySelector('[data-nav="admin"]');
    if (adminBtn) adminBtn.style.display = (ME.role === "admin") ? "" : "none";
    routeFromHash();
  } else {
    ME = null;
    $("profile-menu").style.display = "none";
    $("auth-menu").style.display = "";
    renderSignedOut();
  }
}

function renderSignedOut() {
  document.querySelectorAll("[data-nav]").forEach(b => b.style.display = "none");
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
    if (location.hash === "#feed" || location.hash === "") {
      showTab("feed");          // already on feed route -> just (re)render
    } else {
      location.hash = "feed";   // triggers hashchange -> router -> feed
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
  showTab(raw === "profile" ? "profile" : "feed");
}
window.addEventListener("hashchange", routeFromHash);

// ---- settings view lives in profile.js (renderSettings) --------------
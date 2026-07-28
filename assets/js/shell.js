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

// ---- relative timestamps ----------------------------------------------
// CANONICAL timeAgo — used by feed, messages, notifications, and company
// applicant views. Lives here because shell.js loads first; do not
// redefine this in other files (a later declaration silently wins and
// splits the formats).
// "just now" / "5m ago" / "3h ago" / "2d ago" / "3w ago", then a short
// absolute date once relative time stops being useful. MySQL datetimes
// arrive as "YYYY-MM-DD HH:MM:SS" — the " "->"T" swap keeps them
// parseable in every browser (Safari rejects the bare-space form).
function timeAgo(ts) {
  if (!ts) return "";
  const d = new Date(String(ts).replace(" ", "T"));
  if (isNaN(d)) return String(ts);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60)      return "just now";
  if (s < 3600)    return Math.floor(s / 60) + "m ago";
  if (s < 86400)   return Math.floor(s / 3600) + "h ago";
  if (s < 604800)  return Math.floor(s / 86400) + "d ago";
  if (s < 2629800) return Math.floor(s / 604800) + "w ago";
  // Older than ~a month: short date, year only when it differs.
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

let ME = null;   // current logged-in user (shared across views)

// ---- API helper ------------------------------------------------------
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" }, credentials: "include" };
  if (body) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (e) {
    // Network failure (offline, DNS, server down, CORS). Every caller
    // assumes api() resolves to { ok, status, data }; without this a
    // dropped connection becomes an unhandled rejection that silently
    // aborts whatever view was mid-render. status 0 == "never reached
    // the server", distinct from any real HTTP code.
    return { ok: false, status: 0, data: null, networkError: true };
  }
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

// ---- confirm dialog --------------------------------------------------
// Styled, promise-based replacement for the native confirm(). Returns a
// Promise<boolean>. Uses its OWN overlay (not the shared #modal) so it can
// safely layer on top of an already-open modal — e.g. "Remove this entry?"
// fires from inside an edit dialog. Enter confirms, Escape/backdrop cancels.
//
//   if (!(await confirmDialog("Delete this?"))) return;
//   await confirmDialog("Deactivate user?", { confirmText: "Deactivate", danger: true })
function confirmDialog(message, opts = {}) {
  const confirmText = opts.confirmText || "Confirm";
  const cancelText  = opts.cancelText  || "Cancel";
  const danger      = !!opts.danger;
  const title       = opts.title || null;

  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "in-overlay in-confirm-overlay show";
    ov.innerHTML = `
      <div class="in-modal in-confirm" role="alertdialog" aria-modal="true">
        ${title ? `<h3>${esc(title)}</h3>` : ""}
        <div class="in-modal-text">${esc(message)}</div>
        <div class="in-modal-actions">
          <button class="in-btn ghost" data-c="cancel">${esc(cancelText)}</button>
          <button class="in-btn ${danger ? "danger" : "primary"}" data-c="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      ov.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); finish(false); }
      else if (e.key === "Enter") { e.stopPropagation(); finish(true); }
    };
    // Capture phase so our Escape wins over the main modal's Escape handler
    // when this dialog is layered on top of an open modal.
    document.addEventListener("keydown", onKey, true);

    ov.querySelector('[data-c="ok"]').onclick = () => finish(true);
    ov.querySelector('[data-c="cancel"]').onclick = () => finish(false);
    let pressedBackdrop = false;
    ov.addEventListener("mousedown", e => { pressedBackdrop = (e.target === ov); });
    ov.addEventListener("click", e => { if (e.target === ov && pressedBackdrop) finish(false); pressedBackdrop = false; });

    ov.querySelector('[data-c="ok"]').focus();
  });
}
window.confirmDialog = confirmDialog;

// ---- toast notifications ----------------------------------------------
// Small auto-dismissing confirmation in the bottom-right corner. Use for
// "it worked" feedback that shouldn't interrupt (saves, toggles). Stays
// visible regardless of scroll position, unlike inline status text.
//   toast("Saved.")            -> success styling
//   toast("Failed.", "err")    -> error styling
//   toast("Hidden.", "ok", { actionLabel: "Undo", onAction: fn })
//        -> adds an inline action button and holds a little longer
function toast(message, kind = "ok", opts = {}) {
  let holder = document.getElementById("toast-holder");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "toast-holder";
    document.body.appendChild(holder);
  }
  const t = document.createElement("div");
  t.className = "in-toast " + (kind === "err" ? "err" : "ok");
  const msg = document.createElement("span");
  msg.className = "in-toast-msg";
  msg.textContent = message;
  t.appendChild(msg);

  const hasAction = opts && typeof opts.onAction === "function";
  let killTimer = null;
  const dismiss = () => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  };
  if (hasAction) {
    const btn = document.createElement("button");
    btn.className = "in-toast-action";
    btn.textContent = opts.actionLabel || "Undo";
    btn.onclick = () => { if (killTimer) clearTimeout(killTimer); dismiss(); opts.onAction(); };
    t.appendChild(btn);
  }

  holder.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  // Action toasts linger longer so there's time to click Undo.
  killTimer = setTimeout(dismiss, hasAction ? 6000 : 2600);
}

// ---- Theme + motion --------------------------------------------------
// Applied to <html> so CSS var overrides in app.css ([data-theme="dark"])
// take effect globally. 'system' follows the OS preference live.
// Persisted server-side in user_settings ('theme','reduced_motion') so the
// choice syncs across devices; applied during boot() once settings load.
let THEME_MQ = null;
function applyTheme(theme) {
  const root = document.documentElement;
  const mode = (theme === "dark" || theme === "light" || theme === "system") ? theme : "system";
  const resolve = () => {
    let eff = mode;
    if (mode === "system") {
      eff = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    if (eff === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
  };
  // (Re)bind the OS listener only while in system mode.
  if (THEME_MQ) { THEME_MQ.onchange = null; THEME_MQ = null; }
  if (mode === "system" && window.matchMedia) {
    THEME_MQ = window.matchMedia("(prefers-color-scheme: dark)");
    THEME_MQ.onchange = resolve;
  }
  resolve();
}
function applyReducedMotion(on) {
  document.documentElement.classList.toggle("in-reduce-motion", !!on);
}
window.applyTheme = applyTheme;

// ---- Design system -----------------------------------------------------
// The Alternate (original) skin is the DEFAULT. pro.css scopes every rule
// under html[data-design="pro"]; the attribute is present only when the
// Professional skin is explicitly chosen. New/unset visitors, and anyone
// who picks "Alternate", get the original design (no attribute). The
// inline script in app.html's <head> applies this before first paint.
// Stored per device in localStorage("in_design"). Legacy value "original"
// (from the earlier preview phase) resolves to the default too.
function applyDesign(mode) {
  const root = document.documentElement;
  if (mode === "pro") { root.setAttribute("data-design", "pro"); }
  else { root.removeAttribute("data-design"); }
  try { localStorage.setItem("in_design", mode === "pro" ? "pro" : "alternate"); } catch (_) {}
}
window.applyDesign = applyDesign;

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

// Escape closes the modal — the standard expectation for any dialog. Only
// acts when the modal is actually open, so it never swallows Escape from
// other components (the lightbox and composer manage their own Escape).
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("overlay").classList.contains("show")) closeModal();
});

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
          <div class="avatar-pick-hint" id="${mountId}-hint">JPG, PNG, GIF, or WEBP · up to 8 MB. Square images look best; we'll center-crop to a ${shape === "square" ? "square" : "circle"}.</div>
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
      // Client-side pre-check so oversized/wrong-type files fail instantly
      // with a clear reason, before a wasted upload round-trip. The server
      // re-validates regardless (it's the enforcer) — these bounds MIRROR
      // api/upload/avatar.php: 8 MB cap, JPG/PNG/GIF/WEBP only.
      const OK_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
      const MAX_BYTES = 8 * 1024 * 1024;
      if (file.type && !OK_TYPES.includes(file.type)) {
        msg.textContent = "That format isn't supported. Use JPG, PNG, GIF, or WEBP.";
        msg.className = "avatar-pick-msg err";
        e.target.value = "";
        return;
      }
      if (file.size > MAX_BYTES) {
        msg.textContent = "That image is too large. Please use one under 8 MB.";
        msg.className = "avatar-pick-msg err";
        e.target.value = "";
        return;
      }
      msg.textContent = "Uploading…"; msg.className = "avatar-pick-msg";
      const up = await uploadAvatar(file);
      if (up && up.url) { state.avatarUrl = up.url; render(); }
      else { msg.textContent = "Upload failed. Use a JPG, PNG, GIF, or WEBP under 8 MB."; msg.className = "avatar-pick-msg err"; }
      e.target.value = "";   // allow re-picking the same file after an error
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

// ---- rich text editor (Quill 2.0.3, vendored) -------------------------
// Backed by Quill rather than execCommand: Quill keeps its own document
// model and applies edits deterministically, which removes the whole class
// of contentEditable bugs that forced the old selection-only model.
//
// The enabled formats are deliberately the EXACT set src/RichText.php
// whitelists. If Quill could produce a format the sanitizer strips, the
// user would watch their formatting vanish on save.
const RT_FORMATS = [
  "bold", "italic", "underline",
  "list", "blockquote", "code-block", "code",
  "header", "align", "color", "size", "link",
];

let RT_REGISTERED = false;
function registerQuillFormats() {
  if (RT_REGISTERED || typeof Quill === "undefined") return;
  RT_REGISTERED = true;
  // Emit inline styles for size/colour instead of Quill's default classes,
  // because the sanitizer reads `style="font-size:..."` / `style="color:..."`.
  const SizeStyle = Quill.import("attributors/style/size");
  SizeStyle.whitelist = RT_SIZES.map(s => s[1]);
  Quill.register(SizeStyle, true);
  Quill.register(Quill.import("attributors/style/color"), true);
  // Alignment stays on Quill's ql-align-* classes — the sanitizer already
  // normalises those to its own rt-align-* enum.
}

function mountRichEditor(mountId, opts = {}) {
  const host = $(mountId);
  if (!host) return null;
  const placeholder = opts.placeholder || "Write something…";
  const initialHTML = opts.html || "";

  if (typeof Quill === "undefined") {
    // Fail loudly rather than handing the user a dead box.
    host.innerHTML = `<div class="in-empty">The editor failed to load. Please refresh the page.</div>`;
    return null;
  }
  registerQuillFormats();

  host.innerHTML = `<div class="rt-editor"><div id="${mountId}-area"></div></div>`;

  const quill = new Quill($(`${mountId}-area`), {
    theme: "snow",
    placeholder,
    formats: RT_FORMATS,
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }],
        ["bold", "italic", "underline"],
        [{ list: "bullet" }, { list: "ordered" }],
        ["blockquote", "code-block"],
        [{ align: [] }],
        [{ color: RT_COLORS }],
        [{ size: RT_SIZES.map(s => s[1]) }],
        ["link"],
        ["clean"],
      ],
    },
  });

  // Quill 2.0.3 BUG: getSemanticHTML() emits an empty <pre> for code blocks —
  // the text lives in the DOM (.ql-code-block) and the Delta, but the
  // exporter drops it. Everything else exports correctly, so we use the
  // semantic export and repair just the code blocks, in document order.
  const semanticHTML = () => {
    let html = quill.getSemanticHTML();
    const blocks = Array.from(quill.root.querySelectorAll(".ql-code-block-container"));
    if (!blocks.length) return html;
    let i = 0;
    return html.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/g, () => {
      const c = blocks[i++];
      if (!c) return "";
      const text = Array.from(c.querySelectorAll(".ql-code-block"))
        .map(d => d.textContent).join("\n");
      return "<pre>" + esc(text) + "</pre>";
    });
  };

  // Replace all content with HTML. Goes through Quill's clipboard so its
  // document model stays in sync — writing quill.root.innerHTML directly
  // would desync the model from the DOM. Input is either our own saved
  // draft or server-sanitized stored HTML, and Quill drops anything outside
  // RT_FORMATS on the way in; the server re-sanitizes on save regardless.
  const setHTML = (html) => {
    quill.setContents([]);
    if (html) quill.clipboard.dangerouslyPasteHTML(html, "silent");
  };

  if (initialHTML) setHTML(initialHTML);

  return {
    getHTML: semanticHTML,
    getText: () => quill.getText().replace(/\u200B/g, "").trim(),
    setHTML,
    // Insert at the caret (or at the end if the caret isn't in the editor).
    insertText: (t) => {
      const sel = quill.getSelection(true);
      const idx = sel ? sel.index : quill.getLength();
      quill.insertText(idx, t, "user");
      quill.setSelection(idx + t.length, 0);
    },
    clear: () => quill.setContents([]),
    focus: () => quill.focus(),
    el: quill.root,
    quill,
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
    // The bar stays visible for members (it hosts search); only the Plus
    // upsell itself is hidden from existing subscribers.
    setSubnav(true);
    setPlusCta(!(ME && ME.plan === "plus"));
    document.querySelectorAll("[data-nav]").forEach(b => b.style.display = "");
    // The company-only Feed button stays hidden for users (they have their own).
    const coFeedBtn = document.querySelector('[data-nav="company-feed"]');
    if (coFeedBtn) coFeedBtn.style.display = "none";
    const adminBtn = document.querySelector('[data-nav="admin"]');
    if (adminBtn) adminBtn.style.display = (ME.role === "admin") ? "" : "none";
    if (typeof setupNotifications === "function") setupNotifications();
    if (typeof setupMessaging === "function") setupMessaging();
    // Apply persisted appearance prefs (theme + reduced motion) as early as
    // we can. Non-blocking: the route renders regardless of this resolving.
    api("/settings/get.php").then(r => {
      const st = (r.ok && r.data?.data) ? r.data.data : {};
      applyTheme(st.theme || "system");
      applyReducedMotion(st.reduced_motion === "1");
    }).catch(() => {});
    routeFromHash();
  } else if (CO) {
    // ---- COMPANY identity ---- (no user signed in)
    $("profile-menu").style.display = "none";
    $("auth-menu").style.display = "none";   // hide user sign in/up to avoid confusion
    if ($("search-trigger")) $("search-trigger").style.display = "inline-flex";
    // Companies get the same secondary bar as members (it hosts search);
    // they just never see the Plus upsell (Plus is a member-only offer).
    setSubnav(true);
    setPlusCta(false);
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
    // Apply persisted appearance prefs (theme + reduced motion). Company
    // prefs live in company_settings, fetched via the company endpoint.
    api("/company/settings-get.php").then(r => {
      const st = (r.ok && r.data?.data) ? r.data.data : {};
      applyTheme(st.theme || "system");
      applyReducedMotion(st.reduced_motion === "1");
    }).catch(() => {});
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
    // Nothing to show in the bar for a visitor: no upsell, and search is
    // hidden until sign-in — so hide the CTA and collapse the empty bar.
    setPlusCta(false);
    setSubnav(false);
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
    <button data-co-menu="saved">Saved posts</button>
    <button data-co-menu="settings">Settings</button>
    <div class="in-dropdown-sep"></div>
    <button data-co-menu="signout" class="danger">Sign out</button>`;
  dd.querySelectorAll("[data-co-menu]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      dd.classList.remove("show");
      if (b.dataset.coMenu === "dashboard") location.hash = "company-dashboard";
      else if (b.dataset.coMenu === "saved") location.hash = "saved";
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
      location.hash = "edit-profile";
    } else if (action === "saved") {
      location.hash = "saved";
    } else if (action === "jobsearch") {
      location.hash = "job-search";
    } else if (action === "settings") {
      location.hash = "settings";
    }
  };
});

// ---- nav tabs --------------------------------------------------------
function showTab(name) {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === name));
  // The feed is the only view that widens .in-main for its three-column
  // layout (rails + posts). Every other tab gets the standard 980px.
  document.querySelector(".in-main")?.classList.toggle("feed-wide", name === "feed");
  if (name === "feed") renderFeed();
  else if (name === "admin") renderAdmin();
  else if (name === "scores") renderScores();
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

// ---- secondary nav ---------------------------------------------------
// Toggling the class (not an inline display) is deliberate: app.css keys
// both the bar's visibility and --in-subnav-h off html.has-subnav, so the
// sticky search bar below re-offsets itself in the same step. Setting
// display directly here would show the bar but leave the offset stale.
function setSubnav(show) {
  document.documentElement.classList.toggle("has-subnav", !!show);
}

// Show/hide ONLY the "Try PLUS+" upsell button, independent of the bar
// itself — the bar also hosts search, so hiding the CTA must not collapse
// the whole bar. The bar's own visibility is driven separately by
// setSubnav() based on whether anything in it is still visible.
function setPlusCta(show) {
  const btn = document.querySelector('#subnav-inner [data-subnav="plus"]');
  if (btn) btn.style.display = show ? "" : "none";
}

// Re-apply every Plus-dependent surface from the CURRENT ME.plan, so a plan
// change takes effect without a hard refresh. Covers the sub-nav CTA now;
// if the feed is the active view, re-render it so the rail promo card
// re-evaluates too. Company identities never show the upsell.
function applyPlusState() {
  if (ME) setPlusCta(!(ME.plan === "plus"));
  else setPlusCta(false);
  // If the feed is on screen, its rail promo depends on ME.plan — refresh it.
  const raw = location.hash.replace(/^#/, "");
  if ((raw === "" || raw === "feed") && typeof renderFeed === "function") renderFeed();
}
window.applyPlusState = applyPlusState;

// Re-fetch the current user from the server and re-apply plan-dependent UI.
// Call after anything that can change the signed-in user's own plan (admin
// self-change today; the Plus purchase flow later). Returns the fresh ME.
async function refreshMe() {
  try {
    const { ok, data } = await api("/auth/me.php");
    if (ok && data?.success) { ME = data.data; applyPlusState(); }
  } catch (_) { /* leave ME as-is on failure */ }
  return ME;
}
window.refreshMe = refreshMe;

// =====================================================================
// US phone auto-formatting. Attaches to a tel input and formats a US /
// NANP number as (555) 123-4567 while typing. Deliberately hands-off for
// international input: the moment the value starts with "+", we leave it
// completely alone so a country code like +44 20 7946 0958 isn't mangled.
// The server stores whatever string it receives; this is display sugar.
// =====================================================================
function formatUsPhone(raw) {
  // International or explicitly-prefixed: don't touch it.
  if (/^\s*\+/.test(raw)) return raw;

  const digits = raw.replace(/\D/g, "");
  // Allow a leading US country code "1" but don't require it.
  let d = digits;
  let prefix = "";
  if (d.length === 11 && d[0] === "1") { prefix = "1 "; d = d.slice(1); }
  else if (d.length > 10 && d[0] === "1") { prefix = "1 "; d = d.slice(1); }

  // More than 10 significant digits and not a clean US number → likely
  // international typed without "+"; leave the raw input rather than guess.
  if (d.length > 10) return raw;

  const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6, 10);
  let out = "";
  if (d.length > 6)      out = `(${a}) ${b}-${c}`;
  else if (d.length > 3) out = `(${a}) ${b}`;
  else if (d.length > 0) out = `(${a}`;
  return prefix + out;
}

function attachPhoneFormat(input) {
  if (!input || input.dataset.phoneFmt === "1") return;
  input.dataset.phoneFmt = "1";
  // Format the initial value (e.g. a stored number when editing).
  input.value = formatUsPhone(input.value);
  input.addEventListener("input", () => {
    const before = input.value;
    // Preserve caret position sensibly: track distance from the end, since
    // formatting only inserts characters to the left of the cursor for the
    // common append case.
    const fromEnd = before.length - (input.selectionStart ?? before.length);
    const formatted = formatUsPhone(before);
    if (formatted !== before) {
      input.value = formatted;
      const pos = Math.max(0, formatted.length - fromEnd);
      try { input.setSelectionRange(pos, pos); } catch (_) {}
    }
  });
}
window.attachPhoneFormat = attachPhoneFormat;

// Delegated so items added to the bar later work without new wiring.
const subnavInner = $("subnav-inner");
if (subnavInner) {
  subnavInner.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-subnav]");
    if (!btn || !subnavInner.contains(btn)) return;
    switch (btn.dataset.subnav) {
      case "plus":
        // Plus payments aren't built yet; the CTA acknowledges rather than
        // routing to a dead page. Replace with the real route when the
        // Plus cluster ships.
        toast("PLUS+ is coming soon — we'll let you know when it's ready.");
        break;
      default:
        break;
    }
  });
}

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

// Reflect the current route in the browser tab / history entry. Keeps the
// static-label pages simple; dynamic pages (a user's profile, a job, a
// company) set their own richer title from their render fn and just pass
// through the generic fallback here. `document.title` was previously never
// touched, so every tab read identically.
const PAGE_TITLES = {
  "": "Home", feed: "Home", profile: "My profile", "edit-profile": "Edit profile",
  "job-search": "Job Search", "profile-strength": "Profile strength",
  settings: "Settings", connect: "Connect", jobs: "Jobs", messages: "Messages",
  notifications: "Notifications", search: "Search", admin: "Admin",
  "ai-skillset": "AI Skillset", "company-dashboard": "Dashboard",
  "company-settings": "Company settings", "company-employees": "Employees",
  "company-feed": "Following",
};
function setPageTitle(raw) {
  const base = raw.split("/")[0];
  const label = PAGE_TITLES[base];
  document.title = label ? `${label} · Integrally` : "Integrally";
}

function routeFromHash() {
  const raw = location.hash.replace(/^#/, "");
  setPageTitle(raw);
  // Non-feed routes drop back to the standard column width. Feed routes
  // re-add the class inside showTab("feed"), so this is safe to clear
  // unconditionally here.
  document.querySelector(".in-main")?.classList.remove("feed-wide");
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
  if (raw === "edit-profile") {
    if (!ME) { renderSignedOut(); return; }
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderEditProfilePage();
    return;
  }
  if (raw === "job-search") {
    if (!ME) { renderSignedOut(); return; }
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderJobSearchPage();
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
  if (raw === "scores") {
    showTab("scores");
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
  if (raw === "saved") {
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
    renderSavedPage();
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
// =====================================================================
// hover cards — profile / company previews
// ---------------------------------------------------------------------
// Any element carrying
//     data-hover-card="user"|"company"  data-hover-uuid="<uuid>"
// gets a preview card on pointer intent. One delegated listener on
// document handles every surface, so a new view opts in by adding two
// attributes to markup it already renders — there is no per-surface
// wiring to keep in sync, and elements added after load work with no
// re-binding.
//
// Deliberately mouse-only for now: there is no focus/keyboard path, so
// the card's buttons are unreachable by keyboard. That is a known,
// accepted gap. The card is marked `inert` while hidden so it never
// pollutes tab order for people who will never see it, which also
// leaves the door open for adding a focus path later.
//
// PLACEMENT. The card is appended to document.body with position:fixed
// and coordinates from getBoundingClientRect(). It must NOT be appended
// near its trigger: `.in-modal { overflow-y:auto }` clips absolutely
// positioned children, and the profile left column and feed rails are
// now overflow:auto too. Anything else clips.
// =====================================================================

const HOVER_OPEN_DELAY  = 350;   // pointer must rest this long before we fetch
const HOVER_CLOSE_DELAY = 220;   // grace period to travel from trigger to card
const HOVER_CARD_W      = 320;
const HOVER_EDGE_PAD    = 12;

// Session cache keyed "type:uuid". Re-hovering the same person in a feed
// full of their posts costs one request, not one per hover. `null` is a
// legitimate cached value meaning "we asked and there is nothing to show"
// (404 / private / rate-limited), so misses are not retried in a loop.
const HOVER_CACHE = new Map();

let hoverEl        = null;   // the single reused card element
let hoverTrigger   = null;   // element the visible card belongs to
let hoverOpenTimer = null;
let hoverCloseTimer= null;
let hoverToken     = 0;      // guards against out-of-order fetch resolution
let hoverInside    = false;  // pointer is over the card itself

function hoverCardEl() {
  if (hoverEl) return hoverEl;
  hoverEl = document.createElement("div");
  hoverEl.className = "in-hovercard";
  hoverEl.setAttribute("role", "tooltip");
  hoverEl.style.display = "none";
  hoverEl.inert = true;
  hoverEl.addEventListener("mouseenter", () => {
    hoverInside = true;
    clearTimeout(hoverCloseTimer);
  });
  hoverEl.addEventListener("mouseleave", () => {
    hoverInside = false;
    scheduleHoverClose();
  });
  document.body.appendChild(hoverEl);
  return hoverEl;
}

function hideHoverCard() {
  clearTimeout(hoverOpenTimer);
  clearTimeout(hoverCloseTimer);
  hoverToken++;                       // invalidate any in-flight fetch
  hoverInside = false;
  hoverTrigger = null;
  if (!hoverEl) return;
  hoverEl.style.display = "none";
  hoverEl.classList.remove("show");
  hoverEl.inert = true;
  hoverEl.innerHTML = "";
}

function scheduleHoverClose() {
  clearTimeout(hoverCloseTimer);
  hoverCloseTimer = setTimeout(() => {
    if (!hoverInside) hideHoverCard();
  }, HOVER_CLOSE_DELAY);
}

// Position against the trigger, flipping when the preferred placement
// would leave the viewport. Measured after the card has real content so
// the height is the true rendered height, not an estimate.
function placeHoverCard(trigger) {
  const card = hoverCardEl();
  const r = trigger.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  card.style.left = "0px";
  card.style.top  = "0px";
  const h = card.offsetHeight;
  const w = card.offsetWidth || HOVER_CARD_W;

  // Prefer below; flip above when there isn't room and there is room up top.
  let top = r.bottom + 8;
  if (top + h > vh - HOVER_EDGE_PAD && r.top - 8 - h > HOVER_EDGE_PAD) {
    top = r.top - 8 - h;
  }
  top = Math.max(HOVER_EDGE_PAD, Math.min(top, vh - h - HOVER_EDGE_PAD));

  // Prefer left-aligned with the trigger; pull back inside on the right.
  let left = r.left;
  if (left + w > vw - HOVER_EDGE_PAD) left = vw - w - HOVER_EDGE_PAD;
  left = Math.max(HOVER_EDGE_PAD, left);

  card.style.left = Math.round(left) + "px";
  card.style.top  = Math.round(top) + "px";
}

function hoverAvatar(d) {
  const isCo = d.type === "company";
  const label = (d.name || "?").trim().charAt(0).toUpperCase();
  const inner = d.avatar
    ? `<img src="${esc(d.avatar)}" alt="">`
    : esc(label || "?");
  return `<div class="hc-avatar${isCo ? " company" : ""}">${inner}</div>`;
}

// Score pill. target_type is the enum from `scores` ('job_title' |
// 'skill' | 'field'); the label shown is the target_value itself.
function hoverScore(d) {
  if (!d.score) return "";
  return `
    <div class="hc-score">
      <span class="hc-score-val">${esc(String(d.score.value))}</span>
      <span class="hc-score-label">${esc(d.score.target_value)}</span>
    </div>`;
}

function hoverStats(d) {
  if (!d.stats) return "";
  if (d.type === "company") {
    const f = d.stats.followers || 0, o = d.stats.openings || 0;
    return `<div class="hc-stats">
      <span><b>${f}</b> ${f === 1 ? "follower" : "followers"}</span>
      <span><b>${o}</b> open ${o === 1 ? "role" : "roles"}</span>
    </div>`;
  }
  const f = d.stats.followers || 0, g = d.stats.following || 0;
  return `<div class="hc-stats">
    <span><b>${f}</b> ${f === 1 ? "follower" : "followers"}</span>
    <span><b>${g}</b> following</span>
  </div>`;
}

function hoverActions(d) {
  // Own card: nothing to act on.
  if (d.viewer && d.viewer.is_self) return "";

  const signedIn = !!(d.viewer && d.viewer.signed_in);
  const following = !!(d.viewer && d.viewer.following);
  const dis = signedIn ? "" : "disabled";
  const why = signedIn ? "" : ` title="Sign in to do this"`;

  const followBtn = `<button class="hc-btn hc-follow${following ? " following" : ""}" ${dis}${why}
      data-act="follow">${following ? "Following" : "Follow"}</button>`;

  if (d.type === "company") {
    // Companies aren't messageable; openings is the useful second action.
    const n = (d.stats && d.stats.openings) || 0;
    return `<div class="hc-actions">
      ${followBtn}
      <button class="hc-btn hc-openings" data-act="openings" ${n ? "" : "disabled"}
        ${n ? "" : ' title="No open roles right now"'}>View openings</button>
    </div>`;
  }

  const m = d.message || {};
  const mDis = m.available ? "" : "disabled";
  const mWhy = m.reason ? ` title="${esc(m.reason)}"` : "";
  const mLabel = m.pending ? "Request sent" : "Message";
  return `<div class="hc-actions">
    ${followBtn}
    <button class="hc-btn hc-message" data-act="message" ${mDis}${mWhy}>${esc(mLabel)}</button>
  </div>`;
}

function hoverCardHtml(d) {
  const sub = d.type === "company"
    ? [d.industry, d.location].filter(Boolean).join(" · ")
    : [d.headline, d.location].filter(Boolean).join(" · ");

  const verified = d.verified ? ' <span class="hc-verified" title="Verified">✓</span>' : "";
  const handle = d.type === "user" && d.username
    ? `<div class="hc-handle">@${esc(d.username)}</div>` : "";

  return `
    <div class="hc-head">
      ${hoverAvatar(d)}
      <div class="hc-id">
        <div class="hc-name">${esc(d.name || "Unknown")}${verified}</div>
        ${handle}
      </div>
      ${hoverScore(d)}
    </div>
    ${sub ? `<div class="hc-sub">${esc(sub)}</div>` : ""}
    ${d.type === "company" && d.subtitle ? `<div class="hc-desc">${esc(d.subtitle)}</div>` : ""}
    ${hoverStats(d)}
    ${hoverActions(d)}`;
}

// Wire the card's buttons. Follow mirrors the optimistic toggle used on
// the Connect and Search rows; the others just navigate, which closes
// the card via the route change.
function wireHoverActions(d) {
  const card = hoverCardEl();

  const followBtn = card.querySelector(".hc-follow");
  if (followBtn && !followBtn.disabled) {
    followBtn.onclick = async (e) => {
      e.stopPropagation();
      const wasFollowing = followBtn.classList.contains("following");
      followBtn.disabled = true;
      const endpoint = wasFollowing ? "/follow/unfollow.php" : "/follow/follow.php";
      const resp = await api(endpoint, "POST", { target_type: d.type, target_uuid: d.uuid });
      if (resp.ok && resp.data?.success) {
        followBtn.classList.toggle("following");
        followBtn.textContent = followBtn.classList.contains("following") ? "Following" : "Follow";
        // Keep the cache honest so re-hovering shows the new state.
        const key = d.type + ":" + d.uuid;
        const cached = HOVER_CACHE.get(key);
        if (cached && cached.viewer) cached.viewer.following = !wasFollowing;
      } else {
        toast(resp.data?.error || "Could not update follow status.", "err");
      }
      followBtn.disabled = false;
    };
  }

  const msgBtn = card.querySelector(".hc-message");
  if (msgBtn && !msgBtn.disabled) {
    msgBtn.onclick = (e) => {
      e.stopPropagation();
      hideHoverCard();
      location.hash = "messages/" + d.uuid;
    };
  }

  const openBtn = card.querySelector(".hc-openings");
  if (openBtn && !openBtn.disabled) {
    openBtn.onclick = (e) => {
      e.stopPropagation();
      hideHoverCard();
      location.hash = "company/" + d.uuid;
    };
  }
}

async function showHoverCard(trigger, type, uuid) {
  const key = type + ":" + uuid;
  const token = ++hoverToken;

  let data;
  if (HOVER_CACHE.has(key)) {
    data = HOVER_CACHE.get(key);
  } else {
    const resp = await api(`/profile/card.php?type=${encodeURIComponent(type)}&uuid=${encodeURIComponent(uuid)}`);
    // A hover that 404s (private, deleted, not discoverable) or gets
    // throttled simply shows nothing — no toast, because a toast on
    // mouse movement would be intolerable.
    data = (resp.ok && resp.data?.success) ? resp.data.data : null;
    HOVER_CACHE.set(key, data);
  }

  // The pointer may have moved on, or another card may have been
  // requested, while this was in flight.
  if (token !== hoverToken || hoverTrigger !== trigger || !data) return;

  const card = hoverCardEl();
  card.innerHTML = hoverCardHtml(data);
  card.style.display = "block";
  card.inert = false;
  placeHoverCard(trigger);
  // Fade in only after placement, so it never appears mid-flight.
  requestAnimationFrame(() => card.classList.add("show"));
  wireHoverActions(data);
}

// ---- delegated triggers ---------------------------------------------
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest?.("[data-hover-card]");
  if (!t) return;
  const type = t.dataset.hoverCard;
  const uuid = t.dataset.hoverUuid;
  if ((type !== "user" && type !== "company") || !uuid) return;
  if (t === hoverTrigger) { clearTimeout(hoverCloseTimer); return; }

  clearTimeout(hoverOpenTimer);
  clearTimeout(hoverCloseTimer);
  hoverTrigger = t;
  hoverOpenTimer = setTimeout(() => showHoverCard(t, type, uuid), HOVER_OPEN_DELAY);
});

document.addEventListener("mouseout", (e) => {
  const t = e.target.closest?.("[data-hover-card]");
  if (!t || t !== hoverTrigger) return;
  // Moving within the same trigger (e.g. name -> its own avatar) is not a leave.
  if (e.relatedTarget && t.contains(e.relatedTarget)) return;
  clearTimeout(hoverOpenTimer);
  scheduleHoverClose();
});

// Any navigation or resize invalidates the anchor position, so close.
window.addEventListener("hashchange", hideHoverCard);
window.addEventListener("resize", hideHoverCard);

// Scroll is subtler. A capture-phase listener on window fires for EVERY
// scrollable element in the page, and since last session the feed rails
// are `overflow-y:auto` — so the merest wheel movement over the "Add to
// your network" card closed the preview before it could be used, and
// the rail's own sticky settling could kill it outright.
//
// Instead: reposition against the live rect while the trigger is still
// on screen, and only close once it has actually scrolled out of view.
// Non-capture on window still catches page scroll, and the scroller the
// trigger lives in is handled by the same rect check.
function onHoverScroll() {
  if (!hoverTrigger || !hoverEl || hoverEl.style.display === "none") return;
  const r = hoverTrigger.getBoundingClientRect();
  const vh = document.documentElement.clientHeight;
  // Fully out of view (or detached from the DOM) — nothing to anchor to.
  if (r.bottom < 0 || r.top > vh || (r.width === 0 && r.height === 0)) {
    hideHoverCard();
    return;
  }
  placeHoverCard(hoverTrigger);
}
window.addEventListener("scroll", onHoverScroll, true);

document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideHoverCard(); });

// =====================================================================
// mention typeahead — "@" picker for the composer and comment boxes
// ---------------------------------------------------------------------
// attachMentionPicker(el, opts) works on BOTH a contenteditable rich
// editor area and a plain <input>/<textarea>, because posts use the
// former and comments the latter. The two differ only in how you read
// the text around the caret and how you splice a completion back in,
// so those are the only branches.
//
// PLACEMENT. The dropdown is appended to document.body with
// position:fixed, for the same reason the hover cards are: the comment
// composer can sit inside `.in-modal { overflow-y:auto }` and the feed
// rails are overflow:auto, both of which clip absolutely-positioned
// children. Coordinates come from the caret rect where available,
// falling back to the field's own rect.
// =====================================================================

const MENTION_TRIGGER = /(?:^|[\s(])@([A-Za-z0-9_.-]{0,50})$/;
const MENTION_DEBOUNCE = 160;

let mpBox = null;        // the single reused dropdown
let mpItems = [];        // current results
let mpIndex = 0;         // highlighted row
let mpTarget = null;     // field the dropdown belongs to
let mpTimer = null;
let mpToken = 0;
let mpQuery = "";

function mentionBox() {
  if (mpBox) return mpBox;
  mpBox = document.createElement("div");
  mpBox.className = "in-mention-menu";
  mpBox.style.display = "none";
  document.body.appendChild(mpBox);
  return mpBox;
}

function hideMentionMenu() {
  clearTimeout(mpTimer);
  mpToken++;
  mpItems = [];
  mpIndex = 0;
  mpTarget = null;
  mpQuery = "";
  if (mpBox) { mpBox.style.display = "none"; mpBox.innerHTML = ""; }
}

function mentionMenuOpen() {
  return !!mpBox && mpBox.style.display === "block" && mpItems.length > 0;
}

// Caret rectangle, so the menu opens under the "@" rather than under the
// whole field. contenteditable exposes this via the selection range;
// inputs do not, so those fall back to the field box.
function caretRect(field) {
  const sel = window.getSelection();
  if (field.isContentEditable && sel && sel.rangeCount) {
    const r = sel.getRangeAt(0).cloneRange();
    const rects = r.getClientRects();
    if (rects.length) return rects[0];
    // Collapsed range at a line start can report no rects; use a marker.
    const span = document.createElement("span");
    span.textContent = "\u200b";
    r.insertNode(span);
    const rect = span.getBoundingClientRect();
    const parent = span.parentNode;
    span.remove();
    if (parent) parent.normalize();
    if (rect && rect.width + rect.height > 0) return rect;
  }
  return field.getBoundingClientRect();
}

function placeMentionMenu(field) {
  const box = mentionBox();
  const r = caretRect(field);
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  box.style.left = "0px"; box.style.top = "0px";
  const h = box.offsetHeight || 200;
  const w = box.offsetWidth || 260;

  let top = r.bottom + 6;
  if (top + h > vh - 12 && r.top - 6 - h > 12) top = r.top - 6 - h;
  top = Math.max(12, Math.min(top, vh - h - 12));

  let left = r.left;
  if (left + w > vw - 12) left = vw - w - 12;
  left = Math.max(12, left);

  box.style.left = Math.round(left) + "px";
  box.style.top = Math.round(top) + "px";
}

function renderMentionMenu() {
  const box = mentionBox();
  if (!mpItems.length) { hideMentionMenu(); return; }
  box.innerHTML = mpItems.map((u, i) => `
    <div class="in-mention-item${i === mpIndex ? " active" : ""}" data-i="${i}">
      <div class="in-mention-ava">${u.avatar
        ? `<img src="${esc(u.avatar)}" alt="">`
        : esc((u.name || u.username || "?").charAt(0).toUpperCase())}</div>
      <div class="in-mention-meta">
        <div class="in-mention-name">${esc(u.name || u.username)}</div>
        <div class="in-mention-handle">@${esc(u.username)}</div>
      </div>
    </div>`).join("");
  box.style.display = "block";
  box.querySelectorAll(".in-mention-item").forEach(row => {
    // mousedown, not click: click fires after blur, by which point the
    // caret position we need for splicing is gone.
    row.onmousedown = (e) => {
      e.preventDefault();
      applyMention(parseInt(row.dataset.i, 10));
    };
  });
}

// The text immediately before the caret, used to detect an in-progress
// "@handle" token.
function textBeforeCaret(field) {
  if (!field.isContentEditable) {
    return field.value.slice(0, field.selectionStart ?? field.value.length);
  }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return "";
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(field);
  r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return r.toString();
}

// Replace the partial "@handle" before the caret with the chosen one.
function applyMention(i) {
  const u = mpItems[i];
  const field = mpTarget;
  if (!u || !field) return;
  const insert = "@" + u.username + " ";

  if (!field.isContentEditable) {
    const pos = field.selectionStart ?? field.value.length;
    const before = field.value.slice(0, pos);
    const m = MENTION_TRIGGER.exec(before);
    if (!m) { hideMentionMenu(); return; }
    const start = before.length - m[1].length - 1;   // back over "@partial"
    field.value = field.value.slice(0, start) + insert + field.value.slice(pos);
    const caret = start + insert.length;
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { hideMentionMenu(); return; }
    const range = sel.getRangeAt(0);
    const node = range.endContainer;
    if (node.nodeType !== 3) { hideMentionMenu(); return; }
    const offset = range.endOffset;
    const before = node.nodeValue.slice(0, offset);
    const m = MENTION_TRIGGER.exec(before);
    if (!m) { hideMentionMenu(); return; }
    const start = before.length - m[1].length - 1;
    node.nodeValue = node.nodeValue.slice(0, start) + insert + node.nodeValue.slice(offset);
    const caret = start + insert.length;
    const nr = document.createRange();
    nr.setStart(node, Math.min(caret, node.nodeValue.length));
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  hideMentionMenu();
  field.focus();
}

async function queryMentions(field, q) {
  const token = ++mpToken;
  const r = await api("/mentions/search.php?q=" + encodeURIComponent(q) + "&limit=6");
  if (token !== mpToken || mpTarget !== field) return;   // stale
  mpItems = (r.ok && r.data?.success) ? (r.data.data.results || []) : [];
  mpIndex = 0;
  if (!mpItems.length) { hideMentionMenu(); return; }
  renderMentionMenu();
  placeMentionMenu(field);
}

function attachMentionPicker(field) {
  if (!field || field.dataset.mentionsOn === "1") return;
  field.dataset.mentionsOn = "1";

  field.addEventListener("input", () => {
    const before = textBeforeCaret(field);
    const m = MENTION_TRIGGER.exec(before);
    if (!m) { hideMentionMenu(); return; }
    const q = m[1];
    mpTarget = field;
    mpQuery = q;
    clearTimeout(mpTimer);
    // A bare "@" with nothing typed yet shouldn't hit the server.
    if (q === "") { hideMentionMenu(); mpTarget = field; return; }
    mpTimer = setTimeout(() => queryMentions(field, q), MENTION_DEBOUNCE);
  });

  field.addEventListener("keydown", (e) => {
    if (!mentionMenuOpen() || mpTarget !== field) return;
    if (e.key === "ArrowDown") {
      e.preventDefault(); mpIndex = (mpIndex + 1) % mpItems.length; renderMentionMenu();
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); mpIndex = (mpIndex - 1 + mpItems.length) % mpItems.length; renderMentionMenu();
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter picks the highlighted person rather than submitting the
      // comment — the menu being open is an explicit mode.
      e.preventDefault(); e.stopPropagation();
      applyMention(mpIndex);
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation(); hideMentionMenu();
    }
  });

  field.addEventListener("blur", () => setTimeout(hideMentionMenu, 120));
}
window.attachMentionPicker = attachMentionPicker;

window.addEventListener("hashchange", hideMentionMenu);
window.addEventListener("resize", hideMentionMenu);

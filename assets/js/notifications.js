// =====================================================================
// notifications.js — bell badge, dropdown, and #notifications page.
// Works for both user and company identities (the backend resolves the
// current actor from the session).
// =====================================================================

let NOTIF_POLL = null;

// Build a human sentence + target hash for a notification.
function notifText(n) {
  const who = n.actor || {};
  const name = who.full_name || who.name || "Someone";
  const profHash = who.type === "company" ? `company/${who.uuid}` : `user/${who.uuid}`;
  let verb = "";
  if (n.type === "follow")  verb = "started following you";
  else if (n.type === "like")    verb = "liked your post";
  else if (n.type === "comment") verb = "commented on your post";
  const snippet = n.post && n.post.snippet ? n.post.snippet : "";
  return { name, profHash, verb, snippet, avatar: who.avatar, isCompany: who.type === "company" };
}

function notifRowHTML(n) {
  const t = notifText(n);
  const av = t.avatar ? `<img src="${esc(t.avatar)}" alt="">` : esc((t.name || "?").charAt(0).toUpperCase());
  return `
    <div class="in-notif-item ${n.is_read ? "" : "unread"}" data-id="${n.id}" data-prof="${esc(t.profHash)}">
      <div class="in-notif-ava ${t.isCompany ? "company" : ""}">${av}</div>
      <div class="in-notif-body">
        <div class="in-notif-text"><strong>${esc(t.name)}</strong> ${esc(t.verb)}</div>
        ${t.snippet ? `<div class="in-notif-snip">${esc(t.snippet)}</div>` : ""}
        <div class="in-notif-when">${esc(timeAgo(n.created_at))}</div>
      </div>
      ${n.is_read ? "" : `<span class="in-notif-dot"></span>`}
    </div>`;
}

function timeAgo(ts) {
  const d = new Date(ts.replace(" ", "T"));
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return d.toLocaleDateString();
}

async function refreshNotifBadge() {
  const r = await api("/notifications/list.php?unread_count_only=1");
  if (!r.ok || !r.data?.success) return;
  const n = r.data.data.unread || 0;
  const badge = $("notif-badge");
  if (!badge) return;
  if (n > 0) { badge.textContent = n > 99 ? "99+" : n; badge.style.display = ""; }
  else { badge.style.display = "none"; }
}

async function openNotifDropdown() {
  const list = $("notif-list");
  list.innerHTML = `<div class="in-loading" style="padding:20px 0">Loading…</div>`;
  const r = await api("/notifications/list.php?limit=8");
  const items = (r.ok && r.data?.success) ? r.data.data.notifications : [];
  if (!items.length) {
    list.innerHTML = `<div class="in-empty" style="padding:20px 14px;text-align:center">No notifications yet.</div>`;
    return;
  }
  list.innerHTML = items.map(notifRowHTML).join("");
  list.querySelectorAll(".in-notif-item").forEach(row => {
    row.onclick = async () => {
      const id = row.dataset.id;
      await api("/notifications/mark-read.php", "POST", { id: Number(id) });
      const prof = row.dataset.prof;
      $("notif-dropdown").classList.remove("show");
      if (prof) location.hash = prof;
      refreshNotifBadge();
    };
  });
}

function setupNotifications() {
  const menu = $("notif-menu");
  if (!menu) return;
  menu.style.display = "";

  const trigger = $("notif-trigger");
  const dropdown = $("notif-dropdown");

  trigger.onclick = (e) => {
    e.stopPropagation();
    const show = dropdown.classList.toggle("show");
    if (show) openNotifDropdown();
  };
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) dropdown.classList.remove("show");
  });

  $("notif-readall").onclick = async (e) => {
    e.stopPropagation();
    await api("/notifications/mark-read.php", "POST", { all: true });
    openNotifDropdown();
    refreshNotifBadge();
  };
  $("notif-seeall").onclick = () => { dropdown.classList.remove("show"); location.hash = "notifications"; };

  refreshNotifBadge();
  // Poll the badge periodically.
  if (NOTIF_POLL) clearInterval(NOTIF_POLL);
  NOTIF_POLL = setInterval(refreshNotifBadge, 45000);
}

function hideNotifications() {
  const menu = $("notif-menu");
  if (menu) menu.style.display = "none";
  if (NOTIF_POLL) { clearInterval(NOTIF_POLL); NOTIF_POLL = null; }
}

// ---- full page (#notifications) ----
async function renderNotificationsPage() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  const card = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px;display:flex;align-items:center">
        Notifications
        <button class="in-btn ghost" id="np-readall" style="flex:none;margin-left:auto;padding:7px 14px">Mark all read</button>
      </h2>
      <div id="np-list"><div class="in-loading">Loading…</div></div>
    </div>`);
  wrap.appendChild(card);

  const load = async () => {
    const r = await api("/notifications/list.php?limit=50");
    const items = (r.ok && r.data?.success) ? r.data.data.notifications : [];
    const list = $("np-list");
    if (!items.length) { list.innerHTML = `<div class="in-empty">No notifications yet.</div>`; return; }
    list.innerHTML = items.map(notifRowHTML).join("");
    list.querySelectorAll(".in-notif-item").forEach(row => {
      row.onclick = async () => {
        await api("/notifications/mark-read.php", "POST", { id: Number(row.dataset.id) });
        if (row.dataset.prof) location.hash = row.dataset.prof;
        refreshNotifBadge();
      };
    });
  };

  $("np-readall").onclick = async () => {
    await api("/notifications/mark-read.php", "POST", { all: true });
    load(); refreshNotifBadge();
  };
  load();
}
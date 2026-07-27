// =====================================================================
// notifications.js — bell badge, dropdown, and #notifications page.
// Works for both user and company identities (the backend resolves the
// current actor from the session).
// =====================================================================

let NOTIF_POLL = null;

function notifTarget(n) {
  // Like/comment notifications open the post; follow opens the follower.
  if ((n.type === "like" || n.type === "comment" || n.type === "mention") && n.post && n.post.id) {
    return "post/" + n.post.id;
  }
  if (n.type === "message_request") {
    return n.message && n.message.conversation_id
      ? "messages/" + n.message.conversation_id
      : "messages";
  }
  const who = n.actor || {};
  return who.type === "company" ? `company/${who.uuid}` : `user/${who.uuid}`;
}

// Build a human sentence + target hash for a notification.
// Every branch MUST leave `verb` non-empty: a row with an empty verb
// renders as a bare bold name with no indication of what happened, which
// is what 'endorsement' did before it was handled here. The final
// fallback derives readable text from the type itself, so a new server
// type added without a client update degrades to something legible
// rather than silently producing a nameless notification.
function notifText(n) {
  const who = n.actor || {};
  const name = who.full_name || who.name || "Someone";
  const profHash = who.type === "company" ? `company/${who.uuid}` : `user/${who.uuid}`;
  let verb = "";
  if (n.type === "follow")  verb = "started following you";
  else if (n.type === "like")    verb = "liked your post";
  else if (n.type === "comment") verb = "commented on your post";
  else if (n.type === "message_request") verb = "sent you a message request";
  // Endorsements carry no post/comment id and the notifications table has
  // no column for the endorsed skill, so the sentence stays general until
  // there's a migration to name it.
  else if (n.type === "endorsement") verb = "endorsed one of your skills";
  // A mention carries comment_id when it happened in a comment, so the
  // sentence can say where without a second lookup.
  else if (n.type === "mention") verb = n.comment_id
    ? "mentioned you in a comment"
    : "mentioned you in a post";
  else verb = n.type
    ? `sent you a ${String(n.type).replace(/_/g, " ")} notification`
    : "sent you a notification";
  const snippet = (n.message && n.message.snippet)
    ? n.message.snippet
    : (n.post && n.post.snippet ? n.post.snippet : "");
  return { name, profHash, verb, snippet, avatar: who.avatar, isCompany: who.type === "company" };
}

// Collapse UNREAD like/comment notifications that share a post into one
// row: five people liking the same post is one event to the reader, not
// five. Deliberate constraints:
//   - unread only. A read row is history; collapsing it would rewrite
//     something the user already saw as separate items.
//   - like/comment only, and never across types — "liked" and
//     "commented" are different actions and must not merge.
//   - same post only. Grouping needs a post id; anything without one
//     (follow, endorsement, message_request) passes through untouched.
//   - a group of one is left as a plain row, so nothing renders as
//     "Dana and 0 others".
// Order is preserved: the group lands at the position of its newest
// member, so nothing jumps around relative to ungrouped rows.
const NOTIF_GROUPABLE = new Set(["like", "comment"]);

function groupNotifications(items) {
  const out = [];
  const groups = new Map();   // key -> group object already pushed to `out`
  for (const n of items || []) {
    const postId = n.post && n.post.id;
    const canGroup = !n.is_read && NOTIF_GROUPABLE.has(n.type) && postId;
    if (!canGroup) { out.push(n); continue; }
    const key = `${n.type}:${postId}`;
    const g = groups.get(key);
    if (!g) {
      // First of its kind: hold the real notification, upgrade in place
      // only if a second one shows up.
      const seed = { __group: true, type: n.type, post: n.post, items: [n],
                     created_at: n.created_at, is_read: false };
      groups.set(key, seed);
      out.push(seed);
    } else {
      g.items.push(n);
      // Newest member wins the timestamp (list arrives newest-first, so
      // the seed is already newest; keep the max defensively).
      if (new Date(n.created_at) > new Date(g.created_at)) g.created_at = n.created_at;
    }
  }
  // Unwrap singletons back into ordinary notifications.
  return out.map(x => (x.__group && x.items.length === 1) ? x.items[0] : x);
}

// Distinct actors in a group, in order, de-duplicated by uuid so one
// person liking twice (or a re-notified action) isn't counted as two.
function groupActors(g) {
  const seen = new Set();
  const list = [];
  for (const n of g.items) {
    const a = n.actor || {};
    const key = a.uuid || a.full_name || a.name || Math.random();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(a);
  }
  return list;
}

// "Dana Reed", "Dana Reed and Sam Ito", "Dana Reed and 4 others".
function groupNames(actors) {
  const nameOf = a => a.full_name || a.name || "Someone";
  if (actors.length === 1) return nameOf(actors[0]);
  if (actors.length === 2) return `${nameOf(actors[0])} and ${nameOf(actors[1])}`;
  const others = actors.length - 1;
  return `${nameOf(actors[0])} and ${others} other${others === 1 ? "" : "s"}`;
}

function groupRowHTML(g) {
  const actors = groupActors(g);
  const names = groupNames(actors);
  const verb = g.type === "like" ? "liked your post" : "commented on your post";
  const snippet = g.post && g.post.snippet ? g.post.snippet : "";
  const ids = g.items.map(n => n.id);
  // Up to three stacked avatars; the rest are implied by the name line.
  const avatars = actors.slice(0, 3).map(a => {
    const inner = a.avatar
      ? `<img src="${esc(a.avatar)}" alt="">`
      : esc(((a.full_name || a.name || "?").charAt(0) || "?").toUpperCase());
    return `<div class="in-notif-ava ${a.type === "company" ? "company" : ""}">${inner}</div>`;
  }).join("");
  return `
    <div class="in-notif-item unread" data-ids="${esc(ids.join(","))}" data-prof="post/${esc(g.post.id)}">
      <div class="in-notif-avastack">${avatars}</div>
      <div class="in-notif-body">
        <div class="in-notif-text"><strong>${esc(names)}</strong> ${esc(verb)}</div>
        ${snippet ? `<div class="in-notif-snip">${esc(snippet)}</div>` : ""}
        <div class="in-notif-when">${esc(timeAgo(g.created_at))}</div>
      </div>
      <span class="in-notif-dot"></span>
    </div>`;
}

// Single entry point both surfaces use, so the dropdown and the full page
// can never drift in how they render a row.
function notifAnyRowHTML(n) {
  return n.__group ? groupRowHTML(n) : notifRowHTML(n);
}

function notifRowHTML(n) {
  const t = notifText(n);
  const av = t.avatar ? `<img src="${esc(t.avatar)}" alt="">` : esc((t.name || "?").charAt(0).toUpperCase());
  return `
    <div class="in-notif-item ${n.is_read ? "" : "unread"}" data-id="${n.id}" data-prof="${esc(notifTarget(n))}">
      <div class="in-notif-ava ${t.isCompany ? "company" : ""}">${av}</div>
      <div class="in-notif-body">
        <div class="in-notif-text"><strong>${esc(t.name)}</strong> ${esc(t.verb)}</div>
        ${t.snippet ? `<div class="in-notif-snip">${esc(t.snippet)}</div>` : ""}
        <div class="in-notif-when">${esc(timeAgo(n.created_at))}</div>
      </div>
      ${n.is_read ? "" : `<span class="in-notif-dot"></span>`}
    </div>`;
}

// timeAgo() moved to shell.js (loads first, shared by feed/messages/
// company views). A duplicate declaration here would silently override
// it for every file — don't re-add one.

async function refreshNotifBadge() {
  const r = await api("/notifications/list.php?unread_count_only=1");
  if (!r.ok || !r.data?.success) return;
  const n = r.data.data.unread || 0;
  const badge = $("notif-badge");
  if (!badge) return;
  if (n > 0) { badge.textContent = n > 99 ? "99+" : n; badge.style.display = ""; }
  else { badge.style.display = "none"; }
}

// Shared click wiring. A grouped row carries data-ids (several); a plain
// row carries data-id (one). Both clear before navigating, so the badge
// never keeps counting rows the user has visibly dealt with.
function wireNotifRows(container, onDone) {
  container.querySelectorAll(".in-notif-item").forEach(row => {
    row.onclick = async () => {
      const many = row.dataset.ids;
      if (many) {
        const ids = many.split(",").map(Number).filter(Boolean);
        if (ids.length) await api("/notifications/mark-read.php", "POST", { ids });
      } else if (row.dataset.id) {
        await api("/notifications/mark-read.php", "POST", { id: Number(row.dataset.id) });
      }
      if (typeof onDone === "function") onDone();
      if (row.dataset.prof) location.hash = row.dataset.prof;
      refreshNotifBadge();
    };
  });
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
  list.innerHTML = groupNotifications(items).map(notifAnyRowHTML).join("");
  wireNotifRows(list, () => { $("notif-dropdown").classList.remove("show"); });
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
    list.innerHTML = groupNotifications(items).map(notifAnyRowHTML).join("");
    wireNotifRows(list);
  };

  $("np-readall").onclick = async () => {
    await api("/notifications/mark-read.php", "POST", { all: true });
    load(); refreshNotifBadge();
  };
  load();
}
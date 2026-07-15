// =====================================================================
// messages.js — private messaging (v1: user <-> user).
//   - Nav envelope + unread badge (45s poll, same cadence as the bell)
//   - #messages page: Requests + Inbox list, thread view, composer
//   - Message request flow: pending until accepted, unless the
//     recipient already follows the sender (backend auto-accepts)
//   - "Message" button on public profiles opens a compose modal
// Depends on shell.js (api, $, el, esc, openModal, closeModal) and
// notifications.js (timeAgo). Loaded after both.
// =====================================================================

let MSG_POLL = null;         // envelope badge poll
let MSG_THREAD_POLL = null;  // open-thread refresh poll
let MSG_OPEN_CONV = null;    // id of the thread currently on screen

// ---- nav envelope -----------------------------------------------------

function setupMessaging() {
  const menu = $("msg-menu");
  if (!menu) return;
  menu.style.display = "";
  $("msg-trigger").onclick = () => { location.hash = "messages"; };
  refreshMsgBadge();
  if (MSG_POLL) clearInterval(MSG_POLL);
  MSG_POLL = setInterval(refreshMsgBadge, 45000);
}

function hideMessaging() {
  const menu = $("msg-menu");
  if (menu) menu.style.display = "none";
  if (MSG_POLL) { clearInterval(MSG_POLL); MSG_POLL = null; }
  stopThreadPoll();
}

async function refreshMsgBadge() {
  const r = await api("/messages/unread-count.php");
  if (!r.ok || !r.data?.success) return;
  const n = (r.data.data.unread || 0) + (r.data.data.requests || 0);
  const badge = $("msg-badge");
  if (!badge) return;
  if (n > 0) { badge.textContent = n > 99 ? "99+" : n; badge.style.display = ""; }
  else { badge.style.display = "none"; }
}

function stopThreadPoll() {
  if (MSG_THREAD_POLL) { clearInterval(MSG_THREAD_POLL); MSG_THREAD_POLL = null; }
  MSG_OPEN_CONV = null;
}

// Leaving the messages page kills the thread poll.
window.addEventListener("hashchange", () => {
  const raw = location.hash.replace(/^#/, "");
  if (raw !== "messages" && !raw.startsWith("messages/")) stopThreadPoll();
});

// ---- compose modal (from "Message" button on a profile) ---------------

function openMessageModal(uuid, username) {
  openModal(`
    <h2>Message @${esc(username)}</h2>
    <p class="in-msg-modal-hint">If they don't follow you yet, this will be sent as a
    message request — they'll see your first message and can accept or decline.</p>
    <textarea id="msg-compose-body" class="in-msg-compose" rows="4"
      maxlength="5000" placeholder="Write your message…"></textarea>
    <div class="in-set-msg" id="msg-compose-err"></div>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="msg-compose-send">Send</button>
    </div>`);

  $("msg-compose-send").onclick = async () => {
    const body = $("msg-compose-body").value.trim();
    const errEl = $("msg-compose-err");
    if (!body) { errEl.textContent = "Message cannot be empty."; return; }
    const btn = $("msg-compose-send");
    btn.disabled = true;
    const r = await api("/messages/start.php", "POST", { target_uuid: uuid, body });
    btn.disabled = false;
    if (r.ok && r.data?.success) {
      closeModal();
      location.hash = "messages/" + r.data.data.conversation_id;
      refreshMsgBadge();
    } else {
      errEl.textContent = r.data?.error || "Could not send the message.";
    }
  };
}

// ---- #messages page ----------------------------------------------------

async function renderMessagesPage(openId) {
  stopThreadPoll();
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  if (!ME) { renderSignedOut(); return; }

  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`
    <div class="in-msgs ${openId ? "thread-open" : ""}">
      <div class="in-msgs-list">
        <div class="in-msgs-list-head"><h2>Messages</h2></div>
        <div id="msgs-requests"></div>
        <div id="msgs-inbox"><div class="in-loading" style="padding:20px">Loading…</div></div>
      </div>
      <div class="in-msgs-thread" id="msgs-thread">
        <div class="in-msgs-placeholder">Select a conversation</div>
      </div>
    </div>`);
  view.appendChild(wrap);

  await loadConversationList(openId ? Number(openId) : null);
  if (openId) renderThread(Number(openId));
}

async function loadConversationList(activeId) {
  const r = await api("/messages/conversations.php");
  const reqBox = $("msgs-requests"), inboxBox = $("msgs-inbox");
  if (!reqBox || !inboxBox) return;
  if (!r.ok || !r.data?.success) {
    inboxBox.innerHTML = `<div class="in-empty" style="padding:20px">Could not load conversations.</div>`;
    return;
  }
  const convs = r.data.data.conversations || [];
  const requestsIn  = convs.filter(c => c.status === "pending" && !c.i_started);
  const requestsOut = convs.filter(c => c.status === "pending" && c.i_started);
  const inbox       = convs.filter(c => c.status === "accepted");

  const rowHTML = (c, tag) => {
    const peer = c.peer || {};
    const name = peer.full_name || peer.name || "Unknown";
    const av = peer.avatar ? `<img src="${esc(peer.avatar)}" alt="">` : esc(name.charAt(0).toUpperCase());
    const prev = c.last_message
      ? `${c.last_message.mine ? "You: " : ""}${esc(c.last_message.text)}${c.last_message.text.length >= 80 ? "…" : ""}`
      : "";
    return `
      <div class="in-msgs-row ${c.unread > 0 ? "unread" : ""} ${activeId === c.id ? "active" : ""}" data-conv="${c.id}">
        <div class="in-notif-ava">${av}</div>
        <div class="in-msgs-row-body">
          <div class="in-msgs-row-top">
            <span class="in-msgs-row-name">${esc(name)}${c.muted ? ` <span class="in-msgs-row-muted" title="Muted">🔕</span>` : ""}</span>
            <span class="in-msgs-row-when">${esc(timeAgo(c.last_message_at))}</span>
          </div>
          <div class="in-msgs-row-prev">${tag || prev}</div>
        </div>
        ${c.unread > 0 ? `<span class="in-msgs-unread">${c.unread > 99 ? "99+" : c.unread}</span>` : ""}
      </div>`;
  };

  let reqHtml = "";
  if (requestsIn.length) {
    reqHtml += `<div class="in-msgs-section-label">Requests</div>` +
      requestsIn.map(c => rowHTML(c)).join("");
  }
  if (requestsOut.length) {
    reqHtml += `<div class="in-msgs-section-label">Sent requests</div>` +
      requestsOut.map(c => rowHTML(c, `<em>Request pending</em>`)).join("");
  }
  reqBox.innerHTML = reqHtml;

  inboxBox.innerHTML = inbox.length
    ? (requestsIn.length || requestsOut.length ? `<div class="in-msgs-section-label">Inbox</div>` : "") +
      inbox.map(c => rowHTML(c)).join("")
    : (convs.length ? "" : `<div class="in-empty" style="padding:20px;text-align:center">
        No conversations yet.<br>Visit someone's profile and hit <strong>Message</strong> to start one.</div>`);

  document.querySelectorAll(".in-msgs-row").forEach(row => {
    row.onclick = () => { location.hash = "messages/" + row.dataset.conv; };
  });
}

// ---- thread view -------------------------------------------------------

async function renderThread(convId) {
  stopThreadPoll();
  MSG_OPEN_CONV = convId;
  const box = $("msgs-thread");
  if (!box) return;
  box.innerHTML = `<div class="in-loading" style="padding:24px">Loading…</div>`;

  const r = await api("/messages/thread.php?id=" + convId);
  if (!r.ok || !r.data?.success) {
    box.innerHTML = `<div class="in-empty" style="padding:24px">${esc(r.data?.error || "Could not load this conversation.")}</div>`;
    return;
  }
  const d = r.data.data;
  const conv = d.conversation, peer = conv.peer || {};
  const name = peer.full_name || peer.name || "Unknown";
  const av = peer.avatar ? `<img src="${esc(peer.avatar)}" alt="">` : esc(name.charAt(0).toUpperCase());
  const profHash = peer.type === "company" ? `company/${peer.uuid}` : `user/${peer.uuid}`;

  const pendingMine   = conv.status === "pending" && conv.i_started;
  const pendingTheirs = conv.status === "pending" && !conv.i_started;
  const composerDisabled = pendingMine || conv.blocked;

  // Blocked notice text depends on whether the block is mine to lift.
  const blockedNotice = conv.blocked
    ? (conv.i_blocked
        ? `You've blocked this user. Unblock from the menu above to message again.`
        : `Messaging is unavailable with this user.`)
    : "";

  box.innerHTML = `
    <div class="in-msgs-thread-head">
      <button class="in-msgs-back" id="msgs-back" title="Back">←</button>
      <div class="in-notif-ava">${av}</div>
      <a class="in-msgs-thread-name" href="#${esc(profHash)}">${esc(name)}</a>
      <div class="in-msgs-menu-wrap">
        <button class="in-msgs-menu-btn" id="msgs-menu-btn" title="Conversation options" aria-label="Conversation options">⋯</button>
        <div class="in-msgs-menu" id="msgs-menu" hidden>
          <button class="in-msgs-menu-item" data-act="mute">${conv.muted ? "Unmute conversation" : "Mute conversation"}</button>
          <button class="in-msgs-menu-item ${conv.i_blocked ? "" : "danger"}" data-act="block">${conv.i_blocked ? "Unblock user" : "Block user"}</button>
        </div>
      </div>
    </div>
    ${pendingTheirs ? `
      <div class="in-msgs-banner">
        <div><strong>@${esc(peer.name || "")}</strong> wants to message you.</div>
        <div class="in-msgs-banner-actions">
          <button class="in-btn primary" id="msgs-accept">Accept</button>
          <button class="in-btn ghost" id="msgs-decline">Decline</button>
        </div>
      </div>` : ""}
    ${pendingMine ? `
      <div class="in-msgs-banner muted">Request pending — you can send more messages once they accept.
      Replying to you also counts as accepting.</div>` : ""}
    ${conv.blocked ? `<div class="in-msgs-banner muted">${esc(blockedNotice)}</div>` : ""}
    <div class="in-msgs-scroll" id="msgs-scroll"></div>
    <div class="in-msgs-composer">
      <textarea id="msgs-input" rows="1" maxlength="5000"
        placeholder="${composerDisabled ? "Sending is disabled" : "Write a message…"}"
        ${composerDisabled ? "disabled" : ""}></textarea>
      <button class="in-btn primary" id="msgs-send" ${composerDisabled ? "disabled" : ""}>Send</button>
    </div>`;

  renderThreadMessages(d.messages, d.peer_last_read_id || 0, convId);

  $("msgs-back").onclick = () => { location.hash = "messages"; };
  wireThreadMenu(convId, conv);

  const acceptBtn = $("msgs-accept");
  if (acceptBtn) acceptBtn.onclick = async () => {
    const r2 = await api("/messages/accept.php", "POST", { conversation_id: convId });
    if (r2.ok && r2.data?.success) { renderThread(convId); loadConversationList(convId); }
    else toast(r2.data?.error || "Could not accept the request.", "err");
  };
  const declineBtn = $("msgs-decline");
  if (declineBtn) declineBtn.onclick = async () => {
    if (!(await confirmDialog("Decline this message request? The conversation will be removed.", { confirmText: "Decline", danger: true }))) return;
    const r2 = await api("/messages/decline.php", "POST", { conversation_id: convId });
    if (r2.ok && r2.data?.success) { location.hash = "messages"; refreshMsgBadge(); }
    else toast(r2.data?.error || "Could not decline the request.", "err");
  };

  const input = $("msgs-input"), sendBtn = $("msgs-send");
  const doSend = async () => {
    const body = input.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    const r2 = await api("/messages/send.php", "POST", { conversation_id: convId, body });
    sendBtn.disabled = false;
    if (r2.ok && r2.data?.success) {
      input.value = "";
      await refreshOpenThread(convId);
      loadConversationList(convId);
    } else {
      toast(r2.data?.error || "Could not send the message.", "err");
    }
  };
  if (sendBtn) sendBtn.onclick = doSend;
  if (input) input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  // Opening the thread marks it read; keep it fresh while it's open.
  api("/messages/mark-read.php", "POST", { conversation_id: convId }).then(refreshMsgBadge);
  MSG_THREAD_POLL = setInterval(() => refreshOpenThread(convId, true), 15000);
}

function renderThreadMessages(messages, peerLastReadId, convId) {
  const scroll = $("msgs-scroll");
  if (!scroll) return;

  peerLastReadId = peerLastReadId || 0;

  // The "Seen" receipt hangs off the newest message I sent that the peer
  // has actually read — but not if that message was since deleted.
  let seenAfterId = 0;
  for (const m of messages) {
    if (m.mine && !m.deleted && m.id <= peerLastReadId) seenAfterId = m.id;
  }

  scroll.innerHTML = messages.length
    ? messages.map(m => {
        const canDelete = m.mine && !m.deleted;
        const bubble = m.deleted
          ? `<div class="in-msg-bubble deleted"><em>Message deleted</em><span class="in-msg-time">${esc(timeAgo(m.created_at))}</span></div>`
          : `<div class="in-msg-bubble">${esc(m.body)}<span class="in-msg-time">${esc(timeAgo(m.created_at))}</span></div>`;
        const del = canDelete
          ? `<button class="in-msg-del" data-msg="${m.id}" title="Delete message" aria-label="Delete message">🗑</button>`
          : "";
        const seen = (m.id === seenAfterId)
          ? `<div class="in-msg-receipt">Seen</div>` : "";
        return `
          <div class="in-msg-bubble-row ${m.mine ? "mine" : ""}">
            ${m.mine ? del + bubble : bubble}
          </div>${seen}`;
      }).join("")
    : `<div class="in-empty" style="padding:24px;text-align:center">No messages yet.</div>`;

  // Wire delete buttons.
  scroll.querySelectorAll(".in-msg-del").forEach(btn => {
    btn.onclick = async () => {
      if (!(await confirmDialog("Delete this message? This can't be undone.", { confirmText: "Delete", danger: true }))) return;
      const msgId = Number(btn.dataset.msg);
      btn.disabled = true;
      const r = await api("/messages/delete.php", "POST", { message_id: msgId });
      if (r.ok && r.data?.success) {
        if (typeof convId === "number") { refreshOpenThread(convId); loadConversationList(convId); }
      } else {
        btn.disabled = false;
        toast(r.data?.error || "Could not delete the message.", "err");
      }
    };
  });

  scroll.scrollTop = scroll.scrollHeight;
}

// Re-fetch the open thread's messages (after send, or on the 15s poll).
async function refreshOpenThread(convId, fromPoll) {
  if (MSG_OPEN_CONV !== convId) return;   // user navigated away
  const r = await api("/messages/thread.php?id=" + convId);
  if (!r.ok || !r.data?.success || MSG_OPEN_CONV !== convId) return;
  const d = r.data.data;
  // A poll can catch a request being accepted/declined out from under us;
  // rebuild the whole pane so banners/composer state stay correct.
  const hadBanner = !!document.querySelector(".in-msgs-banner");
  if (fromPoll && hadBanner && d.conversation.status === "accepted") {
    renderThread(convId);
    return;
  }
  // A block/unblock can land from either side between polls; if the
  // composer-disabled state no longer matches, rebuild the whole pane.
  const composerNowDisabled = !!(d.conversation.blocked);
  const composerWasDisabled = !!($("msgs-input") && $("msgs-input").disabled);
  if (fromPoll && composerNowDisabled !== composerWasDisabled) {
    renderThread(convId);
    return;
  }
  renderThreadMessages(d.messages, d.peer_last_read_id || 0, convId);
  api("/messages/mark-read.php", "POST", { conversation_id: convId }).then(refreshMsgBadge);
}

// ---- thread overflow menu (mute / block) ------------------------------

function wireThreadMenu(convId, conv) {
  const btn  = $("msgs-menu-btn");
  const menu = $("msgs-menu");
  if (!btn || !menu) return;

  const closeMenu = () => { menu.hidden = true; };
  const onDocClick = (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) closeMenu();
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (!menu.hidden) document.addEventListener("click", onDocClick, { once: true });
  };

  menu.querySelectorAll(".in-msgs-menu-item").forEach(item => {
    item.onclick = async () => {
      closeMenu();
      const act = item.dataset.act;
      if (act === "mute") {
        const r = await api("/messages/mute.php", "POST",
          { conversation_id: convId, muted: conv.muted ? "0" : "1" });
        if (r.ok && r.data?.success) { renderThread(convId); loadConversationList(convId); }
        else toast(r.data?.error || "Could not update mute setting.", "err");
      } else if (act === "block") {
        if (conv.i_blocked) {
          const r = await api("/messages/unblock.php", "POST", { conversation_id: convId });
          if (r.ok && r.data?.success) { renderThread(convId); loadConversationList(convId); }
          else toast(r.data?.error || "Could not unblock this user.", "err");
        } else {
          if (!(await confirmDialog("Block this user? Neither of you will be able to send messages until you unblock them.", { confirmText: "Block", danger: true }))) return;
          const r = await api("/messages/block.php", "POST", { conversation_id: convId });
          if (r.ok && r.data?.success) { renderThread(convId); loadConversationList(convId); }
          else toast(r.data?.error || "Could not block this user.", "err");
        }
      }
    };
  });
}

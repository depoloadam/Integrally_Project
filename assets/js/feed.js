// =====================================================================
// feed.js — feed view: composer (with image upload), main/explore
//   tabs, and post rendering (incl. cert cards, delete, clickable
//   authors).
//   Depends on shell.js globals: api, $, el, esc, ME, uploadImage.
// =====================================================================

let FEED_TAB = "main";   // 'main' | 'explore'

async function renderFeed() {
  const view = $("view");
  view.innerHTML = "";

  // ---- composer (user identity) ----
  buildComposer({
    parent: view,
    avatarHTML: ME.profile_pic ? `<img src="${esc(ME.profile_pic)}" alt="">` : esc((ME.username || "?").charAt(0).toUpperCase()),
    placeholder: `Share an update, @${ME.username}…`,
    onPosted: renderFeed,
  });

  // ---- tabs + post list ----
  await renderFeedList(view);
}

// Builds a post composer (rich editor + image + link preview + visibility).
// Identity-agnostic: works for a user OR a company session — the backend
// attributes the post to whichever session is active. opts:
//   avatarHTML  — inner HTML for the avatar circle
//   placeholder — editor placeholder text
//   onPosted    — callback after a successful post
function buildComposer(opts) {
  const composer = el(`
    <div class="in-card2 in-composer">
      <div class="comp-top">
        <div class="comp-avatar">${opts.avatarHTML}</div>
        <div id="comp-editor" style="flex:1;min-width:0"></div>
      </div>
      <div id="comp-preview" class="comp-preview" style="display:none">
        <img id="comp-preview-img" src="" alt="">
        <button id="comp-preview-x" title="Remove image">✕</button>
      </div>
      <div id="comp-link" class="comp-link" style="display:none"></div>
      <div class="comp-actions">
        <input type="file" id="comp-file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none">
        <button class="comp-imgbtn" id="comp-img" title="Add image">🖼️ Image</button>
        <select id="comp-vis" title="Who can see this">
          <option value="public">🌐 Public</option>
          <option value="followers">👥 Followers</option>
        </select>
        <button class="in-btn primary" id="comp-post" style="flex:none;padding:9px 18px">Post</button>
      </div>
    </div>`);

  // The editor mounts by element id, so the composer MUST be in the DOM
  // before mounting. Append to the provided parent first.
  if (opts.parent) opts.parent.appendChild(composer);

  const editor = mountRichEditor("comp-editor", { placeholder: opts.placeholder });
  const bodyText = () => editor.getText();

  let attachedUrl = null;
  const fileInput = composer.querySelector("#comp-file");
  const preview = composer.querySelector("#comp-preview");
  const previewImg = composer.querySelector("#comp-preview-img");
  composer.querySelector("#comp-img").onclick = () => fileInput.click();
  composer.querySelector("#comp-preview-x").onclick = () => { attachedUrl = null; fileInput.value = ""; preview.style.display = "none"; previewImg.src = ""; };
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { alert("Image must be 5 MB or smaller."); fileInput.value = ""; return; }
    previewImg.src = URL.createObjectURL(f);
    preview.style.display = "block";
    const imgBtn = composer.querySelector("#comp-img"); imgBtn.disabled = true; imgBtn.textContent = "Uploading…";
    const up = await uploadImage(f);
    imgBtn.disabled = false; imgBtn.textContent = "🖼️ Image";
    if (up?.url) { attachedUrl = up.url; }
    else { alert("Image upload failed. Please try another file."); attachedUrl = null; fileInput.value = ""; preview.style.display = "none"; previewImg.src = ""; }
  };
  // ---- link preview ----
  let linkPreview   = null;
  let lastLinkUrl   = null;
  let dismissedUrls = new Set();
  const linkBox = composer.querySelector("#comp-link");

  const findUrl = (text) => {
    const m = text.match(/https?:\/\/[^\s<>"']+/i);
    if (!m) return null;
    const raw = m[0];
    const clean = raw.replace(/[.,;:!?)\]]+$/, "");
    return { raw, clean };
  };

  const renderLinkCard = (lk) => {
    const host = (() => { try { return new URL(lk.url).hostname.replace(/^www\./, ""); } catch (e) { return lk.site || ""; } })();
    linkBox.innerHTML = `
      ${lk.image ? `<div class="comp-link-img"><img src="${esc(lk.image)}" alt="" onerror="this.parentNode.remove()"></div>` : ""}
      <div class="comp-link-text">
        <div class="post-link-site">${esc(lk.site || host)}</div>
        ${lk.title ? `<div class="post-link-title">${esc(lk.title)}</div>` : ""}
        ${lk.description ? `<div class="post-link-desc">${esc(lk.description)}</div>` : ""}
      </div>
      <button class="comp-link-x" title="Remove preview">✕</button>`;
    linkBox.style.display = "flex";
    linkBox.querySelector(".comp-link-x").onclick = () => {
      if (lastLinkUrl) dismissedUrls.add(lastLinkUrl);
      linkPreview = null;
      linkBox.style.display = "none";
      linkBox.innerHTML = "";
    };
  };

  const fetchLinkPreview = async () => {
    const found = findUrl(bodyText());
    if (!found) {
      if (!linkPreview) { lastLinkUrl = null; linkBox.style.display = "none"; linkBox.innerHTML = ""; }
      return;
    }
    const url = found.clean;
    if (url === lastLinkUrl || dismissedUrls.has(url)) return;
    lastLinkUrl = url;
    linkBox.style.display = "flex";
    linkBox.innerHTML = `<div class="comp-link-loading">Loading link preview…</div>`;
    const r = await api("/posts/link-preview.php", "POST", { url });
    const still = findUrl(bodyText());
    if (!still || still.clean !== url) return;
    if (r.ok && r.data?.success) {
      linkPreview = r.data.data;
      renderLinkCard(linkPreview);
    } else {
      linkPreview = null;
      linkBox.style.display = "none";
      linkBox.innerHTML = "";
    }
  };

  let linkTimer = null;
  editor.el.addEventListener("input", () => {
    clearTimeout(linkTimer);
    linkTimer = setTimeout(fetchLinkPreview, 600);
  });

  composer.querySelector("#comp-post").onclick = async () => {
    const html = editor.getHTML();
    const plain = editor.getText();
    const hasCard = !!(linkPreview && linkPreview.url);
    if (!plain && !attachedUrl && !hasCard) return;
    if (!plain && attachedUrl && !hasCard) { if (!confirm("Post this image without any text?")) return; }

    const btn = composer.querySelector("#comp-post"); btn.disabled = true; btn.textContent = "Posting…";
    const payload = { body: html, visibility: composer.querySelector("#comp-vis").value, media_url: attachedUrl };
    if (hasCard) payload.meta = { link: linkPreview };
    await api("/posts/create.php", "POST", payload);
    if (opts.onPosted) opts.onPosted();
  };

  return composer;
}

async function renderFeedList(view) {
  // ---- sub-tabs ----
  const tabs = el(`
    <div class="in-feedtabs">
      <button data-ftab="main" class="${FEED_TAB==="main"?"active":""}">Following</button>
      <button data-ftab="explore" class="${FEED_TAB==="explore"?"active":""}">Explore</button>
    </div>`);
  view.appendChild(tabs);
  tabs.querySelectorAll("[data-ftab]").forEach(b => b.onclick = () => { FEED_TAB = b.dataset.ftab; renderFeed(); });

  // ---- posts ----
  const list = el(`<div id="feed-list"></div>`);
  view.appendChild(list);
  const endpoint = FEED_TAB === "main" ? "/feed/main.php" : "/feed/explore.php";
  const res = await api(endpoint);
  const items = res.data?.data?.items || [];
  if (!items.length) {
    list.appendChild(el(`<div class="in-card2"><div class="in-empty" style="text-align:center">${
      FEED_TAB === "main"
        ? "Your feed is quiet. Follow people and companies, or share your first post above."
        : "Nothing to explore yet. Public posts from across Integrally will show here."
    }</div></div>`));
    return;
  }
  const container = el(`<div class="in-card2 in-post-list"></div>`);
  items.forEach(it => container.appendChild(renderPost(it)));
  list.appendChild(container);
}

// =====================================================================
// Company feed (used on the company dashboard). A company can post,
// browse others' public posts (Explore), and see its own posts.
// Companies have no personalised "Following" feed (feed_items is keyed by
// user), so their tabs are Explore + Your posts.
// =====================================================================
let CO_FEED_TAB = "explore";   // 'explore' | 'mine'

async function renderCompanyFeedInto(view) {
  if (!CO) { view.appendChild(el(`<div class="in-card2"><div class="in-empty">Company sign-in required.</div></div>`)); return; }

  // Composer (company identity).
  buildComposer({
    parent: view,
    avatarHTML: CO.logo ? `<img src="${esc(CO.logo)}" alt="">` : esc((CO.name || "?").charAt(0).toUpperCase()),
    placeholder: `Share an update from ${CO.name}…`,
    onPosted: () => { CO_FEED_TAB = "mine"; renderCompanyFeed(); },
  });

  // Tabs.
  const tabs = el(`
    <div class="in-feedtabs">
      <button data-cftab="explore" class="${CO_FEED_TAB==="explore"?"active":""}">Explore</button>
      <button data-cftab="mine" class="${CO_FEED_TAB==="mine"?"active":""}">Your posts</button>
    </div>`);
  view.appendChild(tabs);
  tabs.querySelectorAll("[data-cftab]").forEach(b => b.onclick = () => { CO_FEED_TAB = b.dataset.cftab; renderCompanyFeed(); });

  // List.
  const list = el(`<div></div>`);
  view.appendChild(list);

  let items = [];
  if (CO_FEED_TAB === "explore") {
    const res = await api("/feed/explore.php");
    items = res.data?.data?.items || [];
    if (!items.length) { list.appendChild(el(`<div class="in-card2"><div class="in-empty" style="text-align:center">Nothing to explore yet.</div></div>`)); return; }
  } else {
    const res = await api("/posts/personal.php?type=company&uuid=" + encodeURIComponent(CO.uuid));
    const data = res.data?.data || {};
    const posts = data.posts || [];
    // personal.php returns the author at the top level, but renderPost
    // expects it per-post — attach the company author to each.
    const author = data.author || { type: "company", uuid: CO.uuid, name: CO.name, avatar: CO.logo };
    items = posts.map(p => ({ ...p, post_id: p.post_id ?? p.id, author }));
    if (!items.length) { list.appendChild(el(`<div class="in-card2"><div class="in-empty" style="text-align:center">You haven't posted yet. Share your first update above.</div></div>`)); return; }
  }
  const container = el(`<div class="in-card2 in-post-list"></div>`);
  items.forEach(it => container.appendChild(renderPost(it)));
  list.appendChild(container);
}

// ---- single post page (#post/<id>) ----------------------------------
async function renderSinglePost(id) {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  const view = $("view");
  view.innerHTML = `<div class="in-loading" style="padding:40px 0;text-align:center">Loading post…</div>`;

  const r = await api("/posts/get.php?id=" + encodeURIComponent(id));
  if (!r.ok || !r.data?.success) {
    view.innerHTML = `<div class="in-admin"><div class="in-card2"><div class="in-empty">This post could not be found.</div></div></div>`;
    return;
  }

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  wrap.appendChild(el(`<div class="in-back"><button class="in-back-btn" onclick="history.length>1?history.back():location.hash='feed'">‹ Back</button></div>`));
  const listWrap = el(`<div class="in-card2 in-post-list" style="padding:0"></div>`);
  const card = renderPost(r.data.data);
  listWrap.appendChild(card);
  wrap.appendChild(listWrap);
  view.appendChild(wrap);

  // Auto-open the comments thread on the dedicated page.
  const commentBtn = card.querySelector(".post-commentbtn");
  if (commentBtn) commentBtn.click();
}

// ---- single post card ------------------------------------------------
function renderPost(it) {
  const a = it.author || {};
  const initial = (a.name || "?").charAt(0).toUpperCase();
  const when = new Date(it.created_at).toLocaleString();
  const isCompany = a.type === "company";
  const isMine = (a.type === "user" && a.uuid && ME && a.uuid === ME.uuid)
              || (a.type === "company" && a.uuid && CO && a.uuid === CO.uuid);
  const isAdmin = (ME && ME.role === "admin");
  // Admins can delete ANY post; everyone else only their own.
  const canDelete = isMine || isAdmin;

  let contentHtml;
  if (it.post_type === "cert" && it.meta) {
    const m = it.meta;
    contentHtml = `
      <div class="post-cert">
        <div class="cert-icon">🎓</div>
        <div>
          <div class="cert-label">Earned a certification</div>
          <div class="cert-name">${esc(m.name || "")}</div>
          ${m.issuer ? `<div class="cert-issuer">${esc(m.issuer)}</div>` : ""}
        </div>
      </div>
      ${it.body ? `<div class="post-body" style="margin-top:12px">${esc(it.body).replace(/\n/g,"<br>")}</div>` : ""}`;
  } else {
    // Body is server-sanitized rich-text HTML (src/RichText.php), safe to render.
    contentHtml = it.body ? `<div class="post-body rich-content">${it.body}</div>` : "";
  }

  // Link preview card (from meta.link), shown under the body.
  let linkHtml = "";
  const lk = it.meta && it.meta.link;
  if (lk && lk.url) {
    const host = (() => { try { return new URL(lk.url).hostname.replace(/^www\./, ""); } catch (e) { return lk.site || ""; } })();
    linkHtml = `
      <a class="post-link" href="${esc(lk.url)}" target="_blank" rel="noopener noreferrer nofollow">
        ${lk.image ? `<div class="post-link-img"><img src="${esc(lk.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : ""}
        <div class="post-link-text">
          <div class="post-link-site">${esc(lk.site || host)}</div>
          ${lk.title ? `<div class="post-link-title">${esc(lk.title)}</div>` : ""}
          ${lk.description ? `<div class="post-link-desc">${esc(lk.description)}</div>` : ""}
        </div>
      </a>`;
  }

  // Author name/avatar links to their profile — users to #user/<uuid>,
  // companies to #company/<uuid>. Works regardless of who is viewing.
  const clickable = !!a.uuid && (a.type === "user" || a.type === "company");
  const profileHash = a.type === "company" ? `company/${esc(a.uuid)}` : `user/${esc(a.uuid)}`;
  const nameClass = clickable ? "post-name linkable" : "post-name";
  const avaClass  = "post-avatar" + (isCompany ? " company" : "") + (clickable ? " linkable" : "");
  const goProfile = clickable ? `onclick="location.hash='${profileHash}'"` : "";

  const likes = it.likes || 0;
  const comments = it.comments || 0;
  const liked = !!it.liked;
  const canEngage = !!(ME || CO);   // must be signed in (user or company)

  const card = el(`
    <div class="in-post-item">
      <div class="post-head">
        <div class="${avaClass}" ${goProfile}>${a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : esc(initial)}</div>
        <div>
          <div class="${nameClass}" ${goProfile}>${esc(a.name || "Unknown")}${isCompany ? ' <span class="post-tag">Company</span>' : ""}</div>
          <div class="post-when"><span class="post-when-link" onclick="location.hash='post/${esc(String(it.post_id))}'" style="cursor:pointer">${esc(when)}</span>${it.reason === "self" ? " · You" : ""}</div>
        </div>
        ${canDelete ? `<button class="post-del" title="${isMine ? "Delete post" : "Delete (admin)"}">🗑</button>` : ""}
      </div>
      ${contentHtml}
      ${linkHtml}
      ${it.media_url ? `<img class="post-media" src="${esc(it.media_url)}" alt="">` : ""}
      <div class="post-actions">
        <button class="post-act post-like ${liked ? "liked" : ""}" ${canEngage ? "" : "disabled"}>
          <span class="pa-icon">${liked ? "♥" : "♡"}</span> <span class="pa-likes">${likes}</span>
        </button>
        <button class="post-act post-commentbtn">
          <span class="pa-icon">💬</span> <span class="pa-comments">${comments}</span>
          <span class="pa-caret">▾</span>
        </button>
      </div>
      <div class="post-comments" style="display:none"></div>
    </div>`);

  if (canDelete) {
    card.querySelector(".post-del").onclick = async () => {
      const msg = isMine ? "Delete this post? This cannot be undone."
                         : "Delete this post as admin? This cannot be undone.";
      if (!confirm(msg)) return;
      const r = await api("/posts/delete.php", "POST", { id: it.post_id });
      if (r.ok && r.data?.success) card.remove();
      else alert(r.data?.error || "Could not delete the post.");
    };
  }

  // ---- like ----
  const likeBtn = card.querySelector(".post-like");
  let likedState = liked, likeCount = likes;
  if (canEngage) {
    likeBtn.onclick = async () => {
      likeBtn.disabled = true;
      const next = !likedState;
      const r = await api("/posts/like.php", "POST", { post_id: it.post_id, like: next });
      if (r.ok && r.data?.success) {
        likedState = r.data.data.liked;
        likeCount = r.data.data.likes;
        likeBtn.classList.toggle("liked", likedState);
        likeBtn.querySelector(".pa-icon").textContent = likedState ? "♥" : "♡";
        likeBtn.querySelector(".pa-likes").textContent = likeCount;
      }
      likeBtn.disabled = false;
    };
  }

  // ---- comments (toggle thread) ----
  const commentBtn = card.querySelector(".post-commentbtn");
  const commentsBox = card.querySelector(".post-comments");
  let commentsLoaded = false;
  const setOpen = (open) => {
    commentsBox.style.display = open ? "block" : "none";
    commentBtn.classList.toggle("open", open);
    commentBtn.title = open ? "Hide comments" : "Show comments";
  };
  commentBtn.onclick = async () => {
    const open = commentsBox.style.display !== "none";
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!commentsLoaded) { commentsLoaded = true; await loadComments(it.post_id, commentsBox, commentBtn, canEngage, setOpen); }
  };

  return card;
}

// Load + render a post's comment thread into `box`. Includes an add-comment
// composer when signed in. Updates the post's comment counter on change.
async function loadComments(postId, box, commentBtn, canEngage, setOpen) {
  box.innerHTML = `<div class="in-loading" style="padding:16px 0">Loading comments…</div>`;
  const r = await api("/posts/comment-list.php?post_id=" + encodeURIComponent(postId));
  const comments = (r.ok && r.data?.success) ? r.data.data.comments : [];

  box.innerHTML = "";

  const listEl = el(`<div class="pc-list"></div>`);
  box.appendChild(listEl);

  const updateCount = (n) => { const c = commentBtn.querySelector(".pa-comments"); if (c) c.textContent = n; };

  const addCommentEl = (c) => {
    const who = c.author || {};
    const nm = who.full_name || who.name || "Unknown";
    const av = who.avatar ? `<img src="${esc(who.avatar)}" alt="">` : esc((nm || "?").charAt(0).toUpperCase());
    const profHash = who.type === "company" ? `company/${esc(who.uuid)}` : `user/${esc(who.uuid)}`;
    const row = el(`
      <div class="pc-item">
        <div class="pc-ava ${who.type === "company" ? "company" : ""}" ${who.uuid ? `onclick="location.hash='${profHash}'" style="cursor:pointer"` : ""}>${av}</div>
        <div class="pc-body">
          <div class="pc-meta"><span class="pc-name" ${who.uuid ? `onclick="location.hash='${profHash}'" style="cursor:pointer"` : ""}>${esc(nm)}</span> <span class="pc-when">${esc(new Date(c.created_at).toLocaleString())}</span></div>
          <div class="pc-text">${esc(c.body)}</div>
        </div>
        ${c.mine ? `<button class="pc-del" title="Delete">✕</button>` : ""}
      </div>`);
    if (c.mine) {
      row.querySelector(".pc-del").onclick = async () => {
        if (!confirm("Delete this comment?")) return;
        const dr = await api("/posts/comment-delete.php", "POST", { id: c.id });
        if (dr.ok && dr.data?.success) {
          row.remove();
          updateCount(listEl.querySelectorAll(".pc-item").length);
        }
      };
    }
    return row;
  };

  if (!comments.length) {
    listEl.appendChild(el(`<div class="in-empty" style="padding:8px 0">No comments yet.${canEngage ? " Be the first." : ""}</div>`));
  } else {
    comments.forEach(c => listEl.appendChild(addCommentEl(c)));
  }

  if (canEngage) {
    const composer = el(`
      <div class="pc-composer">
        <input type="text" class="pc-input" placeholder="Write a comment…" maxlength="2000">
        <button class="in-btn primary pc-send" style="flex:none;padding:8px 16px">Send</button>
      </div>`);
    box.appendChild(composer);
    const input = composer.querySelector(".pc-input");
    const send = composer.querySelector(".pc-send");
    const submit = async () => {
      const body = input.value.trim();
      if (!body) return;
      send.disabled = true;
      const cr = await api("/posts/comment-add.php", "POST", { post_id: postId, body });
      if (cr.ok && cr.data?.success) {
        const empty = listEl.querySelector(".in-empty"); if (empty) empty.remove();
        listEl.appendChild(addCommentEl(cr.data.data));
        input.value = "";
        updateCount(listEl.querySelectorAll(".pc-item").length);
      } else {
        alert(cr.data?.error || "Could not post comment.");
      }
      send.disabled = false;
    };
    send.onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  if (setOpen) {
    const hideRow = el(`<button class="pc-hide">Hide comments ▴</button>`);
    hideRow.onclick = () => setOpen(false);
    box.appendChild(hideRow);
  }
}
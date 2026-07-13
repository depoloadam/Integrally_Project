// =====================================================================
// feed.js — feed view: composer (with image upload), main/explore
//   tabs, and post rendering (incl. cert cards, delete, clickable
//   authors).
//   Depends on shell.js globals: api, $, el, esc, ME, uploadImage.
// =====================================================================

let FEED_TAB = "main";   // 'main' | 'explore'

// ---- post length rules -------------------------------------------------
// POST_MAX_CHARS mirrors the server cap in api/posts/create.php — the
// server is the enforcer, this is just the early warning. If you change
// one, change BOTH.
// POST_PREVIEW_CHARS is how much of a post's text the feed shows before
// cutting off with a "keep reading" link. The dedicated post page
// (#post/<id>) always shows everything.
const POST_MAX_CHARS     = 3000;
const POST_PREVIEW_CHARS = 300;

// Admins post without a cap (mirrors the Auth::isAdmin() exemption in
// api/posts/create.php). Companies are NOT exempt — a company session has
// no role, and the server check reads the users table.
const postCapExempt = () => !!(ME && ME.role === "admin");

// ---- image upload rules ------------------------------------------------
// Mirrors api/upload/image.php. The server is the enforcer; these just let
// us reject an impossible file instantly instead of after a slow upload.
const IMAGE_MAX_BYTES  = 10 * 1024 * 1024;   // 10 MB
const IMAGE_MAX_PIXELS = 50000000;           // 50 MP — matches ImageProcessor::MAX_PIXELS

// ---- lightbox ----------------------------------------------------------
// Feed images are height-capped by CSS (.post-media), so clicking one
// opens the full-size version. Closes on click, on the X, or on Escape.
function openLightbox(src) {
  if (!src) return;
  const box = el(`
    <div class="img-lightbox">
      <button class="img-lightbox-x" title="Close">✕</button>
      <img src="${esc(src)}" alt="">
    </div>`);

  const close = () => {
    box.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  box.onclick = close;
  // Clicking the image itself shouldn't close it — only the backdrop.
  box.querySelector("img").onclick = (e) => e.stopPropagation();
  box.querySelector(".img-lightbox-x").onclick = close;
  document.addEventListener("keydown", onKey);

  document.body.appendChild(box);
}

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
    <div class="in-card2 in-composer collapsed">
      <div class="comp-top">
        <div class="comp-avatar">${opts.avatarHTML}</div>
        <div id="comp-editor" style="flex:1;min-width:0"></div>
      </div>
      <button type="button" class="comp-expand" id="comp-expand" title="Expand composer" aria-label="Expand composer">
        <span class="comp-expand-chev">⌄</span>
      </button>
      <div id="comp-draftbar" class="comp-draftbar" style="display:none">
        <span>Draft restored</span>
        <button id="comp-draft-discard" type="button">Discard</button>
      </div>
      <div id="comp-preview" class="comp-preview" style="display:none">
        <img id="comp-preview-img" src="" alt="">
        <button id="comp-preview-x" title="Remove image">✕</button>
      </div>
      <div id="comp-link" class="comp-link" style="display:none"></div>
      <div class="comp-actions">
        <input type="file" id="comp-file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none">
        <button class="comp-imgbtn" id="comp-img" title="Add image">🖼️ Image</button>
        <span class="comp-emojis" id="comp-emojis" title="Insert emoji"></span>
        <select id="comp-vis" title="Who can see this">
          <option value="public">🌐 Public</option>
          <option value="followers">👥 Followers</option>
        </select>
        <span class="comp-count" id="comp-count"></span>
        <button class="in-btn primary" id="comp-post" title="Post (Ctrl+Enter)" style="flex:none;padding:9px 18px">Post</button>
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
  composer.querySelector("#comp-preview-x").onclick = () => {
    attachedUrl = null; fileInput.value = "";
    preview.style.display = "none"; previewImg.src = "";
    syncExpandBtn();   // removing the image may have made the composer empty again
  };
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;

    const reset = () => {
      attachedUrl = null; fileInput.value = "";
      preview.style.display = "none"; previewImg.src = "";
    };

    // Fail fast on the obvious cases. The server checks all of this too —
    // the point here is to not make someone wait through a 40 MB upload
    // just to be told no at the end of it.
    if (f.size > IMAGE_MAX_BYTES) {
      toast(`Image must be ${(IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB or smaller — this one is ${(f.size / 1024 / 1024).toFixed(1)} MB.`, "err");
      reset();
      return;
    }

    // Read the dimensions before uploading, so a decompression bomb (a
    // tiny file that decodes to 20000x20000) is caught on the client too.
    const dims = await new Promise((res) => {
      const probe = new Image();
      probe.onload = () => res({ w: probe.naturalWidth, h: probe.naturalHeight });
      probe.onerror = () => res(null);
      probe.src = URL.createObjectURL(f);
    });
    if (dims && dims.w * dims.h > IMAGE_MAX_PIXELS) {
      toast(`That image is too large to process (${dims.w} × ${dims.h}). Please resize it first.`, "err");
      reset();
      return;
    }

    previewImg.src = URL.createObjectURL(f);
    preview.style.display = "block";
    const imgBtn = composer.querySelector("#comp-img"); imgBtn.disabled = true; imgBtn.textContent = "Uploading…";
    const up = await uploadImage(f);
    imgBtn.disabled = false; imgBtn.textContent = "🖼️ Image";
    if (up?.url) {
      attachedUrl = up.url;
      // Show the processed preview, not the local original — so what you
      // see in the composer is exactly what will appear in the feed.
      previewImg.src = up.url;
    } else {
      toast("Image upload failed. Please try another file.", "err");
      reset();
    }
    syncExpandBtn();   // an attached image counts as content
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
      syncExpandBtn();
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

  // ---- live character counter ----
  // Always visible from the first keystroke, so the budget is never a
  // surprise. Three states:
  //   normal  — "412 / 3,000"
  //   warn    — amber inside the last 10% (2,700+)
  //   over    — red, Post disabled
  // Admins are uncapped, so they get a plain count with no denominator
  // and no disabling.
  const countEl = composer.querySelector("#comp-count");
  const postBtn = composer.querySelector("#comp-post");
  const exempt  = postCapExempt();
  const updateCount = () => {
    const len = editor.getText().length;

    if (exempt) {
      countEl.textContent = len ? `${len.toLocaleString()} characters` : "";
      countEl.className = "comp-count";
      postBtn.disabled = false;
      postBtn.title = "";
      return;
    }

    const over = len > POST_MAX_CHARS;
    const warn = !over && len >= POST_MAX_CHARS * 0.9;
    countEl.textContent = `${len.toLocaleString()} / ${POST_MAX_CHARS.toLocaleString()}`;
    countEl.className = "comp-count" + (over ? " over" : warn ? " warn" : "");
    postBtn.disabled = over;
    postBtn.title = over ? `Posts are limited to ${POST_MAX_CHARS.toLocaleString()} characters.` : "";
    // Emptiness may have changed, which decides whether collapse is offered.
    syncExpandBtn();
  };

  // ---- collapsed-until-focused --------------------------------------
  // The composer starts as one quiet line ("Share an update…"); toolbar
  // and action row reveal on first focus. Clicking the field is easy to
  // MISS as an affordance, so the chevron underneath does it explicitly.
  //
  // The chevron is a TOGGLE, but collapse is only offered when the
  // composer is EMPTY. Collapsing hides the action row — including the
  // Post button — so allowing it mid-draft would look like the post had
  // been swallowed. Once there's text, an image, or a link, the only way
  // out is to publish it or clear it.
  //
  // Note there's still no auto-collapse on BLUR: that would mean fighting
  // focus events every time someone clicks the image button or the
  // visibility select. Collapse stays a deliberate, user-driven act.
  const expandBtn = composer.querySelector("#comp-expand");

  const isEmpty = () =>
    !editor.getText() && !attachedUrl && !(linkPreview && linkPreview.url);

  function syncExpandBtn() {
    const collapsed = composer.classList.contains("collapsed");
    // Show when collapsed (as "open me"), or when expanded AND empty
    // (as "close me"). Hidden while a draft is in progress.
    expandBtn.classList.toggle("show", collapsed || isEmpty());
    expandBtn.classList.toggle("up", !collapsed);
    expandBtn.title = collapsed ? "Expand composer" : "Collapse composer";
    expandBtn.setAttribute("aria-label", expandBtn.title);
    expandBtn.setAttribute("aria-expanded", String(!collapsed));
  }

  const expand = () => { composer.classList.remove("collapsed"); syncExpandBtn(); };
  const collapse = () => {
    if (!isEmpty()) return;          // never strand a draft behind a hidden Post button
    composer.classList.add("collapsed");
    editor.el.blur();                // otherwise focus would instantly re-expand it
    syncExpandBtn();
  };

  editor.el.addEventListener("focus", expand, { once: false });
  composer.querySelector(".comp-top").addEventListener("click", () => { expand(); editor.el.focus(); });

  expandBtn.onclick = () => {
    if (composer.classList.contains("collapsed")) {
      expand();
      editor.el.focus();
    } else {
      collapse();
    }
  };

  // Escape collapses an empty composer — the same instinct as dismissing
  // any other open panel. With a draft in it, Escape does nothing rather
  // than hiding your work.
  editor.el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isEmpty()) {
      e.preventDefault();
      collapse();
    }
  });

  // Initial paint. Must come AFTER expandBtn is declared: updateCount()
  // calls syncExpandBtn(), which would otherwise hit the const's temporal
  // dead zone and throw on the very first render.
  updateCount();
  syncExpandBtn();

  // ---- draft autosave -------------------------------------------------
  // Half-written posts survive navigation and reloads. Keyed per identity
  // so a user draft and a company draft never bleed into each other.
  // localStorage is fine here: it's our own site, and the body is
  // sanitized server-side at post time regardless of what's stored.
  const draftKey = "integrally_draft_" + (ME?.uuid ? "u" + ME.uuid : CO?.uuid ? "c" + CO.uuid : "anon");
  const draftBar = composer.querySelector("#comp-draftbar");
  let draftTimer = null;

  const saveDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        const plain = editor.getText();
        if (plain) {
          localStorage.setItem(draftKey, JSON.stringify({
            html: editor.getHTML(),
            vis:  composer.querySelector("#comp-vis").value,
            t:    Date.now(),
          }));
        } else {
          localStorage.removeItem(draftKey);   // emptied it manually — no ghost draft
        }
      } catch (e) { /* storage full/blocked — drafts are a nicety, not a promise */ }
    }, 400);
  };
  const clearDraft = () => {
    clearTimeout(draftTimer);
    try { localStorage.removeItem(draftKey); } catch (e) {}
    draftBar.style.display = "none";
  };

  // Restore on build (drafts older than 7 days are stale — let them go).
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
    if (saved?.html && Date.now() - (saved.t || 0) < 7 * 86400e3) {
      editor.el.innerHTML = saved.html;
      composer.querySelector("#comp-vis").value = saved.vis || "public";
      draftBar.style.display = "flex";
      expand();
      updateCount();
    } else if (saved) {
      localStorage.removeItem(draftKey);
    }
  } catch (e) {}

  composer.querySelector("#comp-draft-discard").onclick = () => {
    editor.clear();
    clearDraft();
    updateCount();
  };
  // Typing past the restore point is an implicit "yes, keeping it".
  editor.el.addEventListener("input", () => { draftBar.style.display = "none"; }, { once: true });
  composer.querySelector("#comp-vis").onchange = saveDraft;

  // ---- quick emojis ---------------------------------------------------
  // A handful of one-tap reactions people actually use in professional
  // posts. Inserted at the caret; falls back to the end of the text if
  // the caret is elsewhere on the page.
  const EMOJIS = ["👍", "🎉", "💡", "🚀", "✅", "📈"];
  const emojiWrap = composer.querySelector("#comp-emojis");
  EMOJIS.forEach(em => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "comp-emoji";
    b.textContent = em;
    // mousedown-preventDefault keeps the caret where it is in the editor,
    // same trick the rich-text toolbar buttons use.
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      expand();
      editor.el.focus();
      const sel = window.getSelection();
      if (!sel.rangeCount || !editor.el.contains(sel.anchorNode)) {
        // Caret isn't in the editor — put it at the end.
        const range = document.createRange();
        range.selectNodeContents(editor.el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand("insertText", false, em);
      editor.el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    emojiWrap.appendChild(b);
  });

  // ---- Ctrl+Enter / Cmd+Enter to post ----------------------------------
  editor.el.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      const btn = composer.querySelector("#comp-post");
      if (!btn.disabled) btn.click();
    }
  });

  let linkTimer = null;
  editor.el.addEventListener("input", () => {
    updateCount();
    saveDraft();
    clearTimeout(linkTimer);
    linkTimer = setTimeout(fetchLinkPreview, 600);
  });

  composer.querySelector("#comp-post").onclick = async () => {
    const html = editor.getHTML();
    const plain = editor.getText();
    const hasCard = !!(linkPreview && linkPreview.url);
    if (!plain && !attachedUrl && !hasCard) return;
    if (!postCapExempt() && plain.length > POST_MAX_CHARS) {
      toast(`Posts are limited to ${POST_MAX_CHARS.toLocaleString()} characters — this one is ${plain.length.toLocaleString()}.`, "err");
      return;
    }
    if (!plain && attachedUrl && !hasCard) { if (!confirm("Post this image without any text?")) return; }

    const btn = composer.querySelector("#comp-post"); btn.disabled = true; btn.textContent = "Posting…";
    const payload = { body: html, visibility: composer.querySelector("#comp-vis").value, media_url: attachedUrl };
    if (hasCard) payload.meta = { link: linkPreview };
    const r = await api("/posts/create.php", "POST", payload);
    if (r.ok && r.data?.success) {
      clearDraft();   // BEFORE onPosted — the feed re-render rebuilds the composer, which would restore it
      if (opts.onPosted) opts.onPosted();
    } else {
      // Server said no (too long, throttled, session expired…). Keep the
      // composer contents so nothing is lost — the OLD behaviour refreshed
      // the feed regardless, silently discarding the text AND the error.
      btn.disabled = false; btn.textContent = "Post";
      toast(r.data?.error || "Could not publish the post. Please try again.", "err");
    }
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
// follow people/companies and read their posts (Following), browse
// public posts (Explore), and see its own posts.
// The Following tab reads /feed/company.php — computed at read time
// from the follows table (feed_items stays user-keyed).
// =====================================================================
let CO_FEED_TAB = "following";   // 'following' | 'explore' | 'mine'

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
      <button data-cftab="following" class="${CO_FEED_TAB==="following"?"active":""}">Following</button>
      <button data-cftab="explore" class="${CO_FEED_TAB==="explore"?"active":""}">Explore</button>
      <button data-cftab="mine" class="${CO_FEED_TAB==="mine"?"active":""}">Your posts</button>
    </div>`);
  view.appendChild(tabs);
  tabs.querySelectorAll("[data-cftab]").forEach(b => b.onclick = () => { CO_FEED_TAB = b.dataset.cftab; renderCompanyFeed(); });

  // List.
  const list = el(`<div></div>`);
  view.appendChild(list);

  let items = [];
  if (CO_FEED_TAB === "following") {
    const res = await api("/feed/company.php");
    items = res.data?.data?.items || [];
    if (!items.length) {
      list.appendChild(el(`
        <div class="in-card2"><div class="in-empty" style="text-align:center">
          Your feed is quiet. Follow people and companies to see their posts here.
          <div style="margin-top:14px"><button class="in-btn primary" style="flex:none;padding:9px 20px" onclick="location.hash='connect'">Find people to follow</button></div>
        </div></div>`));
      return;
    }
  } else if (CO_FEED_TAB === "explore") {
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
  const card = renderPost(r.data.data, { full: true });
  listWrap.appendChild(card);
  wrap.appendChild(listWrap);
  view.appendChild(wrap);

  // Auto-open the comments thread on the dedicated page.
  const commentBtn = card.querySelector(".post-commentbtn");
  if (commentBtn) commentBtn.click();
}

// ---- feed truncation ---------------------------------------------------
// Cuts a rendered post body down to `limit` TEXT characters, keeping the
// rich formatting of what remains. Works on the live DOM node rather than
// the HTML string — slicing HTML as a string would sever tags mid-element
// (e.g. cutting inside a <strong>), which the DOM walk cannot do.
//
// If the body fits, does nothing. If it doesn't, it becomes a TOGGLE:
// "keep reading" expands to the full text, "show less" collapses it back.
// Both states are rebuilt from the original HTML each time, so repeated
// toggling can't accumulate stray ellipses or drift the markup.
function truncateInPlace(bodyEl, limit) {
  const fullText = bodyEl.textContent.replace(/\u200B/g, "");
  if (fullText.length <= limit + 40) return;   // grace zone: don't clip 20 chars for a link

  const fullHtml = bodyEl.innerHTML;

  // Builds the clipped DOM from a fresh copy of the original every time.
  const buildClipped = () => {
    const frag = document.createElement("div");
    frag.innerHTML = fullHtml;
    let remaining = limit;

    const prune = (node) => {
      for (const kid of Array.from(node.childNodes)) {
        if (remaining <= 0) { node.removeChild(kid); continue; }
        if (kid.nodeType === Node.TEXT_NODE) {
          const t = kid.textContent;
          if (t.length > remaining) {
            // Cut, then back off to the last word boundary so we don't end
            // mid-word ("keep read" reads worse than "keep").
            kid.textContent = t.slice(0, remaining).replace(/\s+\S*$/, "") + "…";
            remaining = 0;
          } else {
            remaining -= t.length;
          }
        } else {
          prune(kid);
          // An element left empty by pruning is just phantom margin — drop it.
          if (!kid.textContent && !kid.querySelector?.("img")) kid.remove();
        }
      }
    };
    prune(frag);
    return frag.innerHTML;
  };

  const clippedHtml = buildClipped();

  const toggle = (expanded) => {
    bodyEl.innerHTML = expanded ? fullHtml : clippedHtml;
    const link = document.createElement("a");
    link.className = "post-more";
    link.textContent = expanded ? "show less" : "keep reading";
    link.onclick = (e) => { e.stopPropagation(); toggle(!expanded); };
    // Collapsed: the link trails the "…" inline. Expanded: it sits on its
    // own line under the post, where a trailing inline link would look
    // like part of the sentence.
    if (expanded) link.classList.add("block");
    bodyEl.appendChild(link);
  };

  toggle(false);
}

// ---- single post card ------------------------------------------------
// opts.full — render the complete body with no truncation (used by the
// dedicated #post/<id> page). Feed/profile/company surfaces omit it and
// get the POST_PREVIEW_CHARS cutoff with a "keep reading" link.
function renderPost(it, opts = {}) {
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

  // Feed preview: clamp long bodies to POST_PREVIEW_CHARS. The dedicated
  // post page passes opts.full and always shows everything. Covers both
  // plain text posts and the body under cert cards (same .post-body class).
  if (!opts.full) {
    const bodyEl = card.querySelector(".post-body");
    if (bodyEl) truncateInPlace(bodyEl, POST_PREVIEW_CHARS);
  }

  // Feed images are capped in height by CSS, so give people a way to see
  // the whole thing: click opens a full-size lightbox.
  const media = card.querySelector(".post-media");
  if (media) media.onclick = () => openLightbox(media.src);

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
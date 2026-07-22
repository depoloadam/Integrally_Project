// =====================================================================
// feed.js — feed view: composer (with image upload), main/explore
//   tabs, and post rendering (incl. cert cards, delete, clickable
//   authors).
//   Depends on shell.js globals: api, $, el, esc, ME, uploadImage.
// =====================================================================

let FEED_TAB = "main";   // 'main' | 'explore'
let FEED_SORT = "newest"; // 'newest' | 'oldest' | 'engagement' | 'relevance'

// Sort options offered on every post list (feed, saved, profile activity).
// Order here is the menu order. Labels are shared so the control reads the
// same everywhere.
const SORT_OPTIONS = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["engagement", "Most engaged"],
  ["relevance", "Relevance"],
];
const SORT_LABEL = Object.fromEntries(SORT_OPTIONS);


// Builds a small right-aligned "Sort: X ▾" dropdown. `current` is the
// active key at build time, `onPick(key)` fires when a new one is chosen.
// The control persists across re-sorts (only the list body reloads), so it
// tracks the active key internally: each pick updates it and refreshes the
// button label, and the menu reads the live value on every open so the
// checkmark never goes stale. The menu is spawned on document.body
// (position:fixed) so no overflow can clip it.
function buildSortControl(current, onPick, opts = {}) {
  const options = opts.options || SORT_OPTIONS;
  const labels = opts.labels || SORT_LABEL;
  let active = current;   // live selected key
  const wrap = el(`<div class="sort-control"></div>`);
  const btn = el(`<button class="sort-btn" aria-haspopup="true" aria-expanded="false">
      <span class="sort-btn-label">Sort: <strong>${esc(labels[active] || "Newest")}</strong></span>
      <span class="sort-caret">▾</span>
    </button>`);
  wrap.appendChild(btn);

  let menu = null;
  const close = () => {
    if (menu) { menu.remove(); menu = null; }
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", close, true);
  };
  const onDoc = (e) => { if (menu && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  btn.onclick = (e) => {
    e.stopPropagation();
    if (menu) { close(); return; }
    menu = el(`<div class="sort-menu" role="menu"></div>`);
    options.forEach(([key, label]) => {
      const isActive = key === active;
      const item = el(`<button class="sort-menu-item${isActive ? " active" : ""}" role="menuitemradio" aria-checked="${isActive}">
          <span class="sort-check">${isActive ? "✓" : ""}</span><span>${esc(label)}</span>
        </button>`);
      item.onclick = (ev) => {
        ev.stopPropagation(); close();
        if (key === active) return;
        active = key;
        const strong = btn.querySelector(".sort-btn-label strong");
        if (strong) strong.textContent = labels[key] || key;
        onPick(key);
      };
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    btn.setAttribute("aria-expanded", "true");
    // position: right-aligned under the trigger, flip up / clamp if needed
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight, pad = 8;
    let left = r.right - mw, top = r.bottom + 6;
    if (left < pad) left = pad;
    if (left + mw > window.innerWidth - pad) left = window.innerWidth - mw - pad;
    if (top + mh > window.innerHeight - pad) top = r.top - mh - 6;
    menu.style.left = Math.round(left) + "px";
    menu.style.top  = Math.round(top) + "px";
    document.addEventListener("click", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
  };
  return wrap;
}

// ---- action icons ------------------------------------------------------
// Inline SVGs (outline style, stroke:currentColor via CSS). The liked
// state fills the heart with CSS (.post-like.liked .pa-icon svg) — the JS
// like handler only toggles the class, it never swaps icon markup.
const ICON_HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>`;
const ICON_COMMENT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`;
const ICON_KEBAB = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;

// Small inline glyphs for the post overflow menu. Stroke-based to match
// the action icons; sized by CSS (.pm-ico svg).
const PM_ICONS = {
  save:   `<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  saved:  `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>`,
  hide:   `<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>`,
  mute:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  link:   `<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>`,
  report: `<svg viewBox="0 0 24 24"><path d="M4 22V4h13l-2 4 2 4H4"/></svg>`,
};

// Report reasons — mirror of PostActions::REASONS (server validates).
const REPORT_REASONS = [
  ["spam", "Spam or misleading"],
  ["harassment", "Harassment or hate"],
  ["nudity", "Nudity or sexual content"],
  ["violence", "Violence or dangerous content"],
  ["misinfo", "False information"],
  ["ip", "Intellectual-property violation"],
  ["other", "Something else"],
];

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

  // ---- two-column scaffold ----
  // Left: identity card, then "Add to your network" and "Recent
  // openings" stacked beneath it. Right: composer + tabs + posts. The
  // whole grid lives inside the standard 980px column, same width as
  // the top nav. The rail hides itself at narrow widths (CSS), and the
  // discover cards self-omit if their data calls fail, so the feed
  // itself never blocks on them.
  const grid = el(`
    <div class="feed-grid">
      <aside class="feed-rail-left"></aside>
      <div class="feed-center"></div>
    </div>`);
  view.appendChild(grid);
  const center = grid.querySelector(".feed-center");
  const rail   = grid.querySelector(".feed-rail-left");

  // ---- composer (user identity) ----
  buildComposer({
    parent: center,
    avatarHTML: ME.profile_pic ? `<img src="${esc(ME.profile_pic)}" alt="">` : esc((ME.username || "?").charAt(0).toUpperCase()),
    placeholder: `Share an update, @${ME.username}…`,
    onPosted: renderFeed,
  });

  // Rail cards load in the background — they must never delay the posts.
  // The identity card appends synchronously inside buildIdentityRail, so
  // the discover cards always land below it even though both are async.
  buildIdentityRail(rail);
  buildDiscoverRail(rail);

  // ---- tabs + post list ----
  await renderFeedList(center);
}

// ---- left rail: identity card ----------------------------------------
// Avatar + name + location, follower counts, and the latest career score
// (or a "set up scoring" CTA — the score is the product, so the rail
// should always point at it). Everything degrades quietly: any failed
// call just leaves that piece out.
async function buildIdentityRail(mount) {
  if (!mount || !ME) return;   // shared mount — never remove it

  const avaHTML = ME.profile_pic
    ? `<img src="${esc(ME.profile_pic)}" alt="">`
    : esc((ME.username || "?").charAt(0).toUpperCase());
  const loc = [ME.city, ME.state].filter(Boolean).join(", ");

  const card = el(`
    <div class="idcard">
      <div class="idcard-cover"></div>
      <div class="idcard-body">
        <div class="idcard-ava" title="View profile">${avaHTML}</div>
        <div class="idcard-name">@${esc(ME.username || "")}</div>
        ${loc ? `<div class="idcard-loc">${esc(loc)}</div>` : ""}
        <div class="idcard-stats" style="display:none">
          <div class="idcard-stat"><b class="idc-followers">–</b><span>Followers</span></div>
          <div class="idcard-stat"><b class="idc-following">–</b><span>Following</span></div>
        </div>
        <div class="idcard-score"></div>
        <button class="idcard-saved" title="View your saved posts">
          <span class="pm-ico">${PM_ICONS.saved}</span> Saved posts
        </button>
      </div>
    </div>`);
  const goProfile = () => { location.hash = "profile"; };
  card.querySelector(".idcard-ava").onclick = goProfile;
  card.querySelector(".idcard-name").onclick = goProfile;
  card.querySelector(".idcard-saved").onclick = () => { location.hash = "saved"; };
  mount.appendChild(card);

  // Follower counts.
  try {
    const r = await api(`/follow/counts.php?type=user&uuid=${encodeURIComponent(ME.uuid)}`);
    const d = r.data?.data;
    if (r.ok && d) {
      card.querySelector(".idc-followers").textContent = d.followers ?? 0;
      card.querySelector(".idc-following").textContent = d.following ?? 0;
      const stats = card.querySelector(".idcard-stats");
      stats.style.display = "";
      // Tappable stats open the unified follower/following modal on the
      // matching tab. This is the owner's own card, so lists always open.
      const fWrap = card.querySelector(".idc-followers").closest(".idcard-stat");
      const gWrap = card.querySelector(".idc-following").closest(".idcard-stat");
      fWrap.classList.add("tappable");
      gWrap.classList.add("tappable");
      fWrap.onclick = () => openFollowList(ME.uuid, "followers");
      gWrap.onclick = () => openFollowList(ME.uuid, "following");
    }
  } catch (_) { /* counts stay hidden */ }

  // Latest score — show the newest one as a chip, else the setup CTA.
  try {
    const r = await api("/score/latest.php");
    const scores = r.data?.data?.scores || [];
    const box = card.querySelector(".idcard-score");
    if (r.ok && scores.length) {
      const s = scores[0];
      box.appendChild(el(`
        <button class="idcard-score-chip" title="View score history">
          <span class="idcard-score-val">${esc(String(Math.round(s.score_value)))}</span>
          <span>${esc(s.target_value || "Career score")}</span>
        </button>`));
      box.querySelector(".idcard-score-chip").onclick = () => { location.hash = "profile"; };
    } else {
      box.appendChild(el(`<button class="idcard-score-cta">See your career score →</button>`));
      box.querySelector(".idcard-score-cta").onclick = goProfile;
    }
  } catch (_) { /* score box stays empty */ }
}

// ---- discover cards (left rail, under the identity card) --------------
// "Add to your network" (connect suggestions with inline follow) and
// "Recent openings" (top open jobs). Both cards simply omit themselves
// if their endpoint returns nothing. The mount is SHARED with the
// identity card, so never remove it from here.
async function buildDiscoverRail(mount) {
  if (!mount || !(ME || CO)) return;

  // People & companies to follow.
  try {
    const r = await api("/connect/suggestions.php?type=all&limit=4");
    const results = (r.data?.data?.results || []).filter(x => !x.following).slice(0, 4);
    if (r.ok && results.length) {
      const cardEl = el(`<div class="railcard"><h3>Add to your network</h3><div class="rail-list"></div><button class="rail-more">Show more on Connect</button></div>`);
      const listEl = cardEl.querySelector(".rail-list");
      results.forEach(s => {
        const isCo = s.kind === "company";
        const row = el(`
          <div class="rail-row">
            <div class="rail-ava${isCo ? " company" : ""}">${s.image ? `<img src="${esc(s.image)}" alt="">` : esc((s.title || "?").charAt(0).toUpperCase())}</div>
            <div class="rail-info">
              <div class="rail-name">${esc(s.title || "")}</div>
              <div class="rail-sub">${esc(s.subtitle || s.reason || "")}</div>
            </div>
            <button class="rail-follow">Follow</button>
          </div>`);
        const goTo = () => { location.hash = (isCo ? "company/" : "user/") + s.uuid; };
        row.querySelector(".rail-ava").onclick = goTo;
        row.querySelector(".rail-name").onclick = goTo;
        const btn = row.querySelector(".rail-follow");
        btn.onclick = async () => {
          btn.disabled = true;
          const res = await api("/follow/follow.php", "POST", { target_type: s.kind, target_uuid: s.uuid });
          if (res.ok) { btn.textContent = "Following"; btn.classList.add("done"); }
          else { btn.disabled = false; toast(res.data?.error || "Could not follow.", "err"); }
        };
        listEl.appendChild(row);
      });
      cardEl.querySelector(".rail-more").onclick = () => { location.hash = "connect"; };
      mount.appendChild(cardEl);
    }
  } catch (_) { /* card omitted */ }

  // Recent open roles.
  try {
    const r = await api("/jobs/list.php?limit=3");
    const jobs = (r.data?.data?.jobs || []).slice(0, 3);
    if (r.ok && jobs.length) {
      const cardEl = el(`<div class="railcard"><h3>Recent openings</h3><div class="rail-jobs"></div><button class="rail-more">Browse all jobs</button></div>`);
      const listEl = cardEl.querySelector(".rail-jobs");
      jobs.forEach(j => {
        const sub = [j.company_name, j.location].filter(Boolean).join(" · ");
        let pay = "";
        if (j.salary_min || j.salary_max) {
          const per = j.pay_period === "hourly" ? "/hr" : "/yr";
          const fmt = (n) => j.pay_period === "hourly" ? `$${n}` : `$${Math.round(n / 1000)}k`;
          pay = [j.salary_min, j.salary_max].filter(Boolean).map(fmt).join("–") + per;
        }
        const row = el(`
          <div class="rail-job">
            <div class="rail-job-title">${esc(j.title || "")}</div>
            ${sub ? `<div class="rail-job-sub">${esc(sub)}</div>` : ""}
            ${pay ? `<div class="rail-job-pay">${esc(pay)}</div>` : ""}
          </div>`);
        row.onclick = () => { location.hash = "job/" + j.uuid; };
        listEl.appendChild(row);
      });
      cardEl.querySelector(".rail-more").onclick = () => { location.hash = "jobs"; };
      mount.appendChild(cardEl);
    }
  } catch (_) { /* card omitted */ }
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
      <div id="comp-linkinput" class="comp-linkinput" style="display:none">
        <input type="url" id="comp-linkurl" placeholder="Paste a link — https://example.com" autocomplete="off">
        <button type="button" class="in-btn primary" id="comp-linkadd">Add</button>
        <button type="button" class="comp-linkcancel" id="comp-linkcancel">Cancel</button>
      </div>
      <div id="comp-link" class="comp-link" style="display:none"></div>
      <div class="comp-actions">
        <input type="file" id="comp-file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none">
        <button class="comp-imgbtn" id="comp-img" title="Add image">🖼️ Image</button>
        <button class="comp-imgbtn" id="comp-linkbtn" title="Add a link">🔗 Link</button>
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

  // Turn what a person actually typed into a usable URL, or null if it
  // isn't one. Shared by the "Add link" button and the paste handler so
  // the two can't drift apart.
  const normalizeUrl = (raw) => {
    let url = String(raw || "").trim();
    if (!url) return null;
    // Be forgiving: "example.com" is what people type. Add the scheme
    // rather than reject them for omitting it.
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
      const u = new URL(url);
      if (!u.hostname.includes(".")) return null;   // "https://localhost" isn't shareable
      return url;
    } catch (e) {
      return null;
    }
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

  // Loads a preview card for one URL.
  //
  // fromBody=true  — the URL was TYPED into the post. It stays in the text
  //                  (it's part of the sentence the person wrote), and we
  //                  re-check it is still there before rendering, so a
  //                  slow response can't resurrect a card for a URL that
  //                  has since been deleted.
  // fromBody=false — the URL came from the "Add link" button. The card IS
  //                  the link; no raw URL is left in the body, so there is
  //                  nothing to re-check against.
  const loadPreview = async (url, { fromBody }) => {
    lastLinkUrl = url;
    linkBox.style.display = "flex";
    linkBox.innerHTML = `<div class="comp-link-loading">Loading link preview…</div>`;

    const r = await api("/posts/link-preview.php", "POST", { url });

    if (fromBody) {
      const still = findUrl(bodyText());
      if (!still || still.clean !== url) return;   // they deleted/changed it while we fetched
    }

    if (r.ok && r.data?.success) {
      linkPreview = r.data.data;
      renderLinkCard(linkPreview);

      // If the WHOLE message is nothing but this URL, the raw text is
      // pure noise now that the card exists — drop it. This is the
      // typed-it-out-by-hand equivalent of pasting a bare link.
      //
      // Only when it's the whole message. A URL sitting inside a sentence
      // ("see https://x.com for details") is part of what the person
      // wrote, and deleting it would leave "see for details".
      if (fromBody && bodyText().trim() === url) {
        editor.clear();
        editor.el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } else {
      linkPreview = null;
      linkBox.style.display = "none";
      linkBox.innerHTML = "";
      if (!fromBody) toast("Couldn't load a preview for that link.", "err");
    }
    syncExpandBtn();
  };

  const fetchLinkPreview = async () => {
    const found = findUrl(bodyText());
    if (!found) {
      // No URL in the text. Only clear the card if it CAME from the text —
      // a card added via the button has no URL in the body by design, and
      // must survive every keystroke.
      if (!linkPreview) { lastLinkUrl = null; linkBox.style.display = "none"; linkBox.innerHTML = ""; }
      return;
    }
    const url = found.clean;
    if (url === lastLinkUrl || dismissedUrls.has(url)) return;
    await loadPreview(url, { fromBody: true });
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

  // ---- pasting a link --------------------------------------------------
  // Pasting a URL is the single most common way a link gets into a post,
  // and it went through the typing pipeline — which leaves the raw URL
  // sitting in the message text next to the preview card. Same ugly
  // duplication the "Add link" button avoids.
  //
  // So: if the ENTIRE paste is one URL, intercept it. The card is the
  // link; no text goes into the body.
  //
  // "Entire paste" is the load-bearing condition. Pasting a paragraph that
  // happens to contain a link is not the same act — that text is content
  // the person means to publish, so it falls through untouched and the
  // normal auto-detect handles the URL inside it.
  editor.el.addEventListener("paste", (e) => {
    const clip = (e.clipboardData || window.clipboardData);
    if (!clip) return;

    const pasted = (clip.getData("text/plain") || "").trim();
    if (!pasted) return;

    // Require a scheme or a leading "www." before treating this as a link.
    // A looser test would swallow ordinary text — "Node.js", "e.g." and
    // "index.php" all look like bare domains to a naive pattern.
    const looksLikeUrl = /^https?:\/\/\S+$/i.test(pasted) || /^www\.\S+\.\S+$/i.test(pasted);
    if (!looksLikeUrl) return;

    const url = normalizeUrl(pasted);
    if (!url) return;   // couldn't parse it — let it paste as plain text

    e.preventDefault();
    dismissedUrls.delete(url);   // pasting it again is a clear "I do want this"
    closeLinkRow();
    clearTimeout(linkTimer);
    loadPreview(url, { fromBody: false });
  });

  // ---- "Add link" button -----------------------------------------------
  // Links in the body are ALREADY picked up automatically — but that is
  // invisible, and nobody discovers a feature that never announces itself.
  // This button makes it explicit.
  //
  // It deliberately does NOT run its own preview fetch. It writes the URL
  // into the editor and lets the existing auto-detect pipeline handle it,
  // for two reasons: the preview machinery re-checks that the URL is still
  // present in the body before rendering (so a parallel path would fight
  // it), and a link a reader can't see in the text is a link they can't
  // copy if the preview card fails to load.
  const linkRow    = composer.querySelector("#comp-linkinput");
  const linkField  = composer.querySelector("#comp-linkurl");
  const linkBtn    = composer.querySelector("#comp-linkbtn");

  const closeLinkRow = () => {
    linkRow.style.display = "none";
    linkField.value = "";
    linkField.classList.remove("invalid");
  };

  linkBtn.onclick = () => {
    expand();
    const open = linkRow.style.display !== "none";
    if (open) { closeLinkRow(); return; }
    linkRow.style.display = "flex";
    linkField.focus();
  };

  composer.querySelector("#comp-linkcancel").onclick = () => {
    closeLinkRow();
    editor.el.focus();
  };

  const submitLink = () => {
    const url = normalizeUrl(linkField.value);
    if (!url) {
      linkField.classList.add("invalid");
      linkField.focus();
      return;
    }

    // If this URL's preview was dismissed earlier, adding it deliberately
    // is a clear "actually, I do want it" — honour that.
    dismissedUrls.delete(url);

    // NOTE: we do NOT write the URL into the body. The preview card IS the
    // link — leaving a raw "https://…" in the message text as well is the
    // ugly duplication this button exists to avoid. The card carries the
    // URL through to the post via meta.link, and the server accepts a post
    // whose only content is a link.
    closeLinkRow();
    clearTimeout(linkTimer);
    loadPreview(url, { fromBody: false });
    editor.el.focus();
  };

  composer.querySelector("#comp-linkadd").onclick = submitLink;
  linkField.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { e.preventDefault(); submitLink(); }
    if (e.key === "Escape") { e.preventDefault(); closeLinkRow(); editor.el.focus(); }
  });
  linkField.addEventListener("input", () => linkField.classList.remove("invalid"));

  composer.querySelector("#comp-post").onclick = async () => {
    const html = editor.getHTML();
    const plain = editor.getText();
    const hasCard = !!(linkPreview && linkPreview.url);
    if (!plain && !attachedUrl && !hasCard) return;
    if (!postCapExempt() && plain.length > POST_MAX_CHARS) {
      toast(`Posts are limited to ${POST_MAX_CHARS.toLocaleString()} characters — this one is ${plain.length.toLocaleString()}.`, "err");
      return;
    }
    if (!plain && attachedUrl && !hasCard) { if (!(await confirmDialog("Post this image without any text?", { confirmText: "Post" }))) return; }

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
  // ---- header row: sub-tabs (left) + sort control (right) ----
  // The header (tabs + sort control) is built ONCE and left in place.
  // Switching tab or sort only refreshes the list body below it, so the
  // composer and rails never repaint — no full-page flicker.
  const head = el(`<div class="feed-listhead"></div>`);
  const tabs = el(`
    <div class="in-feedtabs">
      <button data-ftab="main" class="${FEED_TAB==="main"?"active":""}">Following</button>
      <button data-ftab="explore" class="${FEED_TAB==="explore"?"active":""}">Explore</button>
    </div>`);
  head.appendChild(tabs);

  const list = el(`<div id="feed-list"></div>`);

  // Loads the current tab+sort into the list body, replacing whatever was
  // there. Only this runs on tab/sort change.
  const loadList = async () => {
    // Preserve height during the swap so the page doesn't jump, then
    // release it once the new content is in.
    const prevH = list.offsetHeight;
    if (prevH) list.style.minHeight = prevH + "px";
    list.classList.add("is-loading");

    const base = FEED_TAB === "main" ? "/feed/main.php" : "/feed/explore.php";
    const res = await api(base + "?sort=" + encodeURIComponent(FEED_SORT));
    const items = res.data?.data?.items || [];

    const next = document.createDocumentFragment();
    if (!items.length) {
      next.appendChild(el(`<div class="in-card2"><div class="in-empty" style="text-align:center">${
        FEED_TAB === "main"
          ? "Your feed is quiet. Follow people and companies, or share your first post above."
          : "Nothing to explore yet. Public posts from across Integrally will show here."
      }</div></div>`));
    } else {
      const container = el(`<div class="in-card2 in-post-list"></div>`);
      items.forEach(it => container.appendChild(renderPost(it)));
      next.appendChild(container);
    }
    list.replaceChildren(next);
    list.classList.remove("is-loading");
    list.style.minHeight = "";
  };

  tabs.querySelectorAll("[data-ftab]").forEach(b => b.onclick = () => {
    if (FEED_TAB === b.dataset.ftab) return;
    FEED_TAB = b.dataset.ftab;
    tabs.querySelectorAll("[data-ftab]").forEach(x => x.classList.toggle("active", x.dataset.ftab === FEED_TAB));
    loadList();
  });
  head.appendChild(buildSortControl(FEED_SORT, (key) => {
    FEED_SORT = key;
    loadList();
  }));

  view.appendChild(head);
  view.appendChild(list);
  await loadList();
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

// =====================================================================
// Saved posts page (#saved). Lists the current actor's bookmarked
// posts, reusing renderPost. Reached from the profile dropdown and a
// small link on the feed page. Sortable; default is most-recently-saved.
// =====================================================================
let SAVED_SORT = "saved";
const SAVED_SORT_OPTIONS = [
  ["saved", "Recently saved"],
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["engagement", "Most engaged"],
];

async function renderSavedPage() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  const view = $("view");
  if (!(ME || CO)) { view.innerHTML = `<div class="in-admin"><div class="in-card2"><div class="in-empty">Sign in to see your saved posts.</div></div></div>`; return; }

  // Build the page shell (back link, header, sort control) ONCE. Re-sorting
  // swaps only the list body, so the header never repaints/flickers.
  const savedLabels = Object.fromEntries(SAVED_SORT_OPTIONS);
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  wrap.appendChild(el(`
    <div class="in-back"><button class="in-back-btn" onclick="history.length>1?history.back():location.hash='feed'">‹ Back</button></div>`));
  const head = el(`<div class="saved-head"><div class="saved-head-text"><h2>Saved posts</h2><p>Only you can see what you've saved.</p></div></div>`);
  wrap.appendChild(head);
  const list = el(`<div id="saved-list"></div>`);
  wrap.appendChild(list);
  view.appendChild(wrap);

  let sortControl = null;
  const loadList = async () => {
    const prevH = list.offsetHeight;
    if (prevH) list.style.minHeight = prevH + "px";
    list.classList.add("is-loading");

    const r = await api("/posts/saved.php?sort=" + encodeURIComponent(SAVED_SORT));
    const items = r.data?.data?.items || [];

    // Show the sort control only when there's more than one post to sort.
    // Add it once; afterwards just keep its label in sync.
    if (items.length > 1 && !sortControl) {
      sortControl = buildSortControl(SAVED_SORT, (key) => { SAVED_SORT = key; loadList(); }, { options: SAVED_SORT_OPTIONS, labels: savedLabels });
      head.appendChild(sortControl);
    } else if (items.length <= 1 && sortControl) {
      sortControl.remove(); sortControl = null;
    }

    const next = document.createDocumentFragment();
    if (!r.ok || !items.length) {
      next.appendChild(el(`<div class="in-card2"><div class="in-empty" style="text-align:center">Nothing saved yet. Use the ••• menu on any post and choose <strong>Save post</strong> to keep it here.</div></div>`));
    } else {
      const inner = el(`<div class="in-card2 in-post-list"></div>`);
      items.forEach(it => inner.appendChild(renderPost(it)));
      next.appendChild(inner);
    }
    list.replaceChildren(next);
    list.classList.remove("is-loading");
    list.style.minHeight = "";
  };
  await loadList();
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
// ---- post overflow menu helpers --------------------------------------

// Positions a body-level menu just under (and right-aligned to) the
// trigger, flipping above / clamping to the viewport when it would
// overflow. Fixed positioning means it ignores any clipping ancestor.
function positionMenu(menu, trigger) {
  const r = trigger.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const pad = 8;
  let left = r.right - mw;                        // right-align to trigger
  let top  = r.bottom + 6;                        // below by default
  if (left < pad) left = pad;
  if (left + mw > window.innerWidth - pad) left = window.innerWidth - mw - pad;
  if (top + mh > window.innerHeight - pad) top = r.top - mh - 6;   // flip up
  if (top < pad) top = pad;
  menu.style.left = Math.round(left) + "px";
  menu.style.top  = Math.round(top) + "px";
}

// Copies a direct link to a post to the clipboard, with a manual-copy
// fallback for insecure contexts / older browsers.
async function copyPostLink(postId) {
  const url = location.origin + location.pathname + "#post/" + postId;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      toast("Link copied.");
      return;
    }
    throw new Error("no clipboard");
  } catch (_) {
    // Fallback: transient textarea + execCommand.
    try {
      const ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("Link copied.");
    } catch (e) {
      toast("Could not copy link.", "err");
    }
  }
}

// Report dialog: pick a reason, optional detail, submit. Uses the shared
// modal. Captures post id in a local so closeModal() (which wipes the
// modal DOM) can't strand it.
function openReportDialog(postId) {
  const pid = postId;
  const rows = REPORT_REASONS.map(([key, label], i) => `
    <label class="rep-reason">
      <input type="radio" name="rep-reason" value="${esc(key)}" ${i === 0 ? "checked" : ""}>
      <span>${esc(label)}</span>
    </label>`).join("");
  openModal(`
    <div class="in-modal-head"><h3>Report post</h3></div>
    <div class="rep-body">
      <p class="rep-intro">Tell us what's wrong with this post. Reports are reviewed by our team.</p>
      <div class="rep-reasons">${rows}</div>
      <textarea id="rep-detail" class="rep-detail" maxlength="500" placeholder="Add any details (optional)"></textarea>
    </div>
    <div class="in-modal-actions">
      <button class="in-btn ghost" id="rep-cancel">Cancel</button>
      <button class="in-btn danger" id="rep-submit">Submit report</button>
    </div>`);
  $("rep-cancel").onclick = () => closeModal();
  $("rep-submit").onclick = async () => {
    const reason = document.querySelector('input[name="rep-reason"]:checked')?.value;
    const detail = $("rep-detail")?.value || "";
    if (!reason) { toast("Pick a reason.", "err"); return; }
    const btn = $("rep-submit"); btn.disabled = true;
    const r = await api("/posts/report.php", "POST", { post_id: pid, reason, detail });
    closeModal();
    if (r.ok && r.data?.success) toast("Thanks — your report was submitted.");
    else toast(r.data?.error || "Could not submit the report.", "err");
  };
}

function renderPost(it, opts = {}) {
  const a = it.author || {};
  const initial = (a.name || "?").charAt(0).toUpperCase();
  // Relative time in the card ("3h", "2d"); the exact timestamp moves to
  // a hover title so nothing is lost.
  const whenFull = new Date(it.created_at).toLocaleString();
  const when = (typeof timeAgo === "function") ? timeAgo(it.created_at) : whenFull;
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
      <div class="post-milestone cert">
        <div class="ms-icon">🎓</div>
        <div class="ms-text">
          <div class="ms-label">Earned a certification</div>
          <div class="ms-name">${esc(m.name || "")}</div>
          ${m.issuer ? `<div class="ms-sub">${esc(m.issuer)}</div>` : ""}
        </div>
      </div>
      ${it.body ? `<div class="post-body rich-content" style="margin-top:12px">${it.body}</div>` : ""}`;
  } else if (it.post_type === "job" && it.meta) {
    const m = it.meta;
    // "at Acme · Started March 2026" — build the sub-line from whatever
    // parts we actually have, so a missing company or date never leaves a
    // stray separator behind.
    const bits = [];
    if (m.company) bits.push(esc(m.company));
    if (m.start_label) bits.push(esc(m.start_label));
    contentHtml = `
      <div class="post-milestone job">
        <div class="ms-icon">💼</div>
        <div class="ms-text">
          <div class="ms-label">${m.is_promotion ? "New role" : "Started a new position"}</div>
          <div class="ms-name">${esc(m.title || "")}</div>
          ${bits.length ? `<div class="ms-sub">${bits.join(" · ")}</div>` : ""}
        </div>
      </div>
      ${it.body ? `<div class="post-body rich-content" style="margin-top:12px">${it.body}</div>` : ""}`;
  } else if (it.post_type === "edu" && it.meta) {
    const m = it.meta;
    // Name line: "Degree, Field" when both exist, else whichever is present.
    const nameParts = [m.degree, m.field].filter(Boolean).map(esc);
    const name = nameParts.join(", ") || esc(m.institution || "");
    // Sub-line: "Institution · 2026" — drop missing parts so no stray dot.
    const bits = [];
    if (nameParts.length && m.institution) bits.push(esc(m.institution));
    if (m.year_label) bits.push(esc(m.year_label));
    contentHtml = `
      <div class="post-milestone edu">
        <div class="ms-icon">📚</div>
        <div class="ms-text">
          <div class="ms-label">Completed education</div>
          <div class="ms-name">${name}</div>
          ${bits.length ? `<div class="ms-sub">${bits.join(" · ")}</div>` : ""}
        </div>
      </div>
      ${it.body ? `<div class="post-body rich-content" style="margin-top:12px">${it.body}</div>` : ""}`;
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
          <div class="post-when"><span class="post-when-link" onclick="location.hash='post/${esc(String(it.post_id))}'" style="cursor:pointer" title="${esc(whenFull)}">${esc(when)}</span>${it.reason === "self" ? " · You" : ""}</div>
        </div>
        ${canEngage ? `<button class="post-menu-btn" aria-label="Post options" aria-haspopup="true" aria-expanded="false">${ICON_KEBAB}</button>` : ""}
      </div>
      ${contentHtml}
      ${linkHtml}
      ${it.media_url ? `<img class="post-media" src="${esc(it.media_url)}" alt="">` : ""}
      <div class="post-actions">
        <button class="post-act post-like ${liked ? "liked" : ""}" ${canEngage ? "" : "disabled"}>
          <span class="pa-icon">${ICON_HEART}</span> <span class="pa-likes">${likes}</span>
        </button>
        <button class="post-act post-commentbtn">
          <span class="pa-icon">${ICON_COMMENT}</span> <span class="pa-comments">${comments}</span>
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

  // ---- overflow menu (save / hide / mute / copy link / report / delete) ----
  // Available to any signed-in actor (user or company). Menu contents
  // depend on who's viewing: everyone gets save/copy-link/report; hide +
  // "show fewer" only appear for posts that aren't yours; delete only for
  // your own posts (or admins). The menu is spawned on document.body with
  // position:fixed so .in-post-item / .in-modal overflow can't clip it —
  // same escape pattern as the typeahead and resume popover.
  const menuBtn = card.querySelector(".post-menu-btn");
  if (menuBtn) {
    let savedState = !!it.saved;
    let openMenu = null;

    const closeMenu = () => {
      if (openMenu) { openMenu.remove(); openMenu = null; }
      menuBtn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
    const onDocClick = (e) => { if (openMenu && !openMenu.contains(e.target) && e.target !== menuBtn) closeMenu(); };
    const onKey = (e) => { if (e.key === "Escape") closeMenu(); };

    const buildItems = () => {
      const items = [];
      // Save (toggles)
      items.push({
        key: "save",
        icon: savedState ? PM_ICONS.saved : PM_ICONS.save,
        label: savedState ? "Saved" : "Save post",
        run: async () => {
          const next = !savedState;
          const r = await api("/posts/save.php", "POST", { post_id: it.post_id, save: next });
          if (r.ok && r.data?.success) { savedState = next; toast(next ? "Saved to your list." : "Removed from saved."); }
          else toast(r.data?.error || "Could not update saved state.", "err");
        },
      });
      // Hide + show-fewer only for posts that aren't the viewer's own.
      if (!isMine) {
        items.push({
          key: "hide",
          icon: PM_ICONS.hide,
          label: "Hide this post",
          run: async () => {
            const r = await api("/posts/hide.php", "POST", { post_id: it.post_id, hide: true });
            if (r.ok && r.data?.success) { removeWithUndo("Post hidden.", () => api("/posts/hide.php", "POST", { post_id: it.post_id, hide: false })); }
            else toast(r.data?.error || "Could not hide the post.", "err");
          },
        });
        items.push({
          key: "mute",
          icon: PM_ICONS.mute,
          label: `Show fewer from ${a.name || "this author"}`,
          run: async () => {
            const r = await api("/posts/mute-author.php", "POST", { post_id: it.post_id, mute: true });
            if (r.ok && r.data?.success) { removeWithUndo("You'll see fewer posts like this.", () => api("/posts/mute-author.php", "POST", { post_id: it.post_id, mute: false })); }
            else toast(r.data?.error || "Could not update your preferences.", "err");
          },
        });
      }
      // Copy link (client-only)
      items.push({
        key: "link",
        icon: PM_ICONS.link,
        label: "Copy link to post",
        run: async () => { await copyPostLink(it.post_id); },
      });
      // Report only for posts that aren't yours.
      if (!isMine) {
        items.push({ key: "report", icon: PM_ICONS.report, label: "Report post", danger: true, run: () => openReportDialog(it.post_id) });
      }
      // Delete for own posts / admins.
      if (canDelete) {
        items.push({
          key: "delete",
          icon: PM_ICONS.report, // reuse flag glyph; distinct danger styling
          label: isMine ? "Delete post" : "Delete (admin)",
          danger: true,
          run: async () => {
            const msg = isMine ? "Delete this post? This cannot be undone."
                               : "Delete this post as admin? This cannot be undone.";
            if (!(await confirmDialog(msg, { confirmText: "Delete", danger: true }))) return;
            const r = await api("/posts/delete.php", "POST", { id: it.post_id });
            if (r.ok && r.data?.success) card.remove();
            else toast(r.data?.error || "Could not delete the post.", "err");
          },
        });
      }
      return items;
    };

    // Removes the card from view with a toast that offers Undo. Undo runs
    // the provided reverse call and re-inserts the card in place.
    const removeWithUndo = (msg, reverseFn) => {
      const anchor = document.createComment("post-slot");
      card.replaceWith(anchor);
      const undo = async () => {
        const r = await reverseFn();
        if (r && r.ok && r.data?.success) { anchor.replaceWith(card); }
        else { toast("Could not undo.", "err"); }
      };
      toast(msg, "ok", { actionLabel: "Undo", onAction: undo });
    };

    menuBtn.onclick = (e) => {
      e.stopPropagation();
      if (openMenu) { closeMenu(); return; }
      const menu = el(`<div class="post-menu" role="menu"></div>`);
      buildItems().forEach(item => {
        const b = el(`<button class="post-menu-item${item.danger ? " danger" : ""}" role="menuitem"><span class="pm-ico">${item.icon}</span><span class="pm-label">${esc(item.label)}</span></button>`);
        b.onclick = async (ev) => { ev.stopPropagation(); closeMenu(); await item.run(); };
        menu.appendChild(b);
      });
      document.body.appendChild(menu);
      openMenu = menu;
      menuBtn.setAttribute("aria-expanded", "true");
      positionMenu(menu, menuBtn);
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", closeMenu);
      window.addEventListener("scroll", closeMenu, true);
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
        // The heart is an inline SVG; .liked fills it via CSS, so the
        // class toggle is the whole state change. Never set textContent
        // on .pa-icon — that would wipe the SVG markup.
        likeBtn.classList.toggle("liked", likedState);
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
        if (!(await confirmDialog("Delete this comment?", { confirmText: "Delete", danger: true }))) return;
        const dr = await api("/posts/comment-delete.php", "POST", { id: c.id });
        if (dr.ok && dr.data?.success) {
          row.remove();
          updateCount(listEl.querySelectorAll(".pc-item").length);
          // If that was the last comment, restore the empty-state line.
          if (!listEl.querySelector(".pc-item")) {
            listEl.appendChild(el(`<div class="in-empty" style="padding:8px 0">No comments yet.${canEngage ? " Be the first." : ""}</div>`));
          }
          syncHide();
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
        syncHide();
      } else {
        toast(cr.data?.error || "Could not post comment.", "err");
      }
      send.disabled = false;
    };
    send.onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  // "Hide comments" should exist only while there's a thread to hide, and
  // stay in sync as comments are added to / removed from an empty thread.
  const syncHide = () => {
    if (!setOpen) return;
    const has = listEl.querySelectorAll(".pc-item").length > 0;
    let hideRow = box.querySelector(".pc-hide");
    if (has && !hideRow) {
      hideRow = el(`<button class="pc-hide">Hide comments ▴</button>`);
      hideRow.onclick = () => setOpen(false);
      box.appendChild(hideRow);   // always the last child
    } else if (!has && hideRow) {
      hideRow.remove();
    } else if (has && hideRow) {
      box.appendChild(hideRow);   // keep it after the composer
    }
  };
  syncHide();
}
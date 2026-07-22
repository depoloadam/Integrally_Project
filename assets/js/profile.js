// =====================================================================
// profile.js — profile view, public profile, score breakdown, and all
//   profile-related modals (edit, add records, bulk onboarding menus).
//   Depends on shell.js globals: api, $, el, esc, ME, openModal, etc.
// =====================================================================

// ===================================================================
// Follower / following counts — shared between own + public profiles.
// Renders a compact bar of two tappable stats. When `hidden` is true
// (viewer isn't the owner and the target hides their lists) the stats
// render as plain, non-tappable text. `isOwner` lets the owner always
// open their own lists regardless of the hide setting.
// ===================================================================
function followCountsHtml(followers, following, hidden, isOwner) {
  const tappable = isOwner || !hidden;
  const cls = tappable ? "in-followstat tappable" : "in-followstat";
  const attr = tappable ? "" : ' aria-disabled="true"';
  return `
    <div class="in-followcounts">
      <button class="${cls}" data-follow-list="followers"${attr}>
        <span class="n">${followers}</span> follower${followers === 1 ? "" : "s"}
      </button>
      <button class="${cls}" data-follow-list="following"${attr}>
        <span class="n">${following}</span> following
      </button>
    </div>`;
}

// Wire the two stat buttons inside a rendered header to open the list
// modal. `container` is the header element; `uuid` is the profile owner.
function wireFollowCounts(container, uuid, hidden, isOwner) {
  container.querySelectorAll("[data-follow-list]").forEach(btn => {
    if (!btn.classList.contains("tappable")) return;
    btn.onclick = () => openFollowList(uuid, btn.getAttribute("data-follow-list"));
  });
}

// Open a modal listing a profile's followers or the accounts it follows.
// Rows are tappable and navigate to that account's profile. Users go to
// their public profile; companies to the company page.
// Open the unified follower/following modal. `mode` selects which tab is
// active on open ('followers' or 'following'). Both tabs live in one
// popup; each tab's list is fetched lazily the first time it's shown and
// cached for the life of the modal.
async function openFollowList(uuid, mode) {
  const active = mode === "following" ? "following" : "followers";
  openModal(`
    <div class="in-followmodal">
      <div class="in-followtabs" role="tablist">
        <button class="in-followtab ${active === "followers" ? "active" : ""}" data-tab="followers" role="tab">Followers</button>
        <button class="in-followtab ${active === "following" ? "active" : ""}" data-tab="following" role="tab">Following</button>
      </div>
      <div class="in-followlist" id="follow-list-body">
        <div class="in-loading" style="padding:20px">Loading…</div>
      </div>
    </div>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Close</button></div>
  `);

  const cache = {};              // mode -> rendered DocumentFragment content
  const modalEl = $("modal");    // used to scope tab queries

  const showTab = async (tab) => {
    // Toggle active tab styling.
    modalEl.querySelectorAll(".in-followtab").forEach(b =>
      b.classList.toggle("active", b.getAttribute("data-tab") === tab));
    const body = $("follow-list-body");
    if (!body) return;

    if (cache[tab]) { body.replaceChildren(...cache[tab].cloneNode(true).childNodes); return; }
    body.innerHTML = `<div class="in-loading" style="padding:20px">Loading…</div>`;

    const endpoint = tab === "followers"
      ? "/follow/followers.php?type=user&uuid=" + encodeURIComponent(uuid)
      : "/follow/following.php?uuid=" + encodeURIComponent(uuid);
    const r = await api(endpoint);
    const b2 = $("follow-list-body");
    if (!b2) return; // modal closed while loading

    const frag = document.createDocumentFragment();

    if (r.data?.code === "follow_lists_hidden") {
      frag.appendChild(el(`<div class="in-empty" style="padding:20px;text-align:center">This list is private.</div>`));
    } else if (!r.ok || !r.data?.success) {
      frag.appendChild(el(`<div class="in-empty" style="padding:20px;text-align:center">Couldn't load this list.</div>`));
    } else {
      const rows = r.data.data || [];
      if (!rows.length) {
        const msg = tab === "followers" ? "No followers yet." : "Not following anyone yet.";
        frag.appendChild(el(`<div class="in-empty" style="padding:20px;text-align:center">${msg}</div>`));
      } else {
        rows.forEach(row => {
          // followers.php uses follower_type; following.php uses target_type.
          const kind = row.follower_type || row.target_type || "user";
          const name = row.name || row.username || "";
          const avatar = row.avatar || row.profile_pic || row.logo || "";
          const rowUuid = row.uuid;
          const initial = (name || "?").charAt(0).toUpperCase();
          const hash = kind === "company" ? "#company/" + rowUuid : "#user/" + rowUuid;
          const item = el(`
            <button class="in-followrow" type="button">
              <span class="in-followrow-av">${avatar ? `<img src="${esc(avatar)}" alt="">` : esc(initial)}</span>
              <span class="in-followrow-name">${kind === "company" ? "" : "@"}${esc(name)}</span>
              ${kind === "company" ? `<span class="in-followrow-tag">Company</span>` : ""}
            </button>`);
          item.onclick = () => { closeModal(); location.hash = hash; };
          frag.appendChild(item);
        });
      }
    }

    // Cache a copy and paint.
    cache[tab] = frag.cloneNode(true);
    b2.replaceChildren(...frag.childNodes);
  };

  modalEl.querySelectorAll(".in-followtab").forEach(btn => {
    btn.onclick = () => showTab(btn.getAttribute("data-tab"));
  });

  await showTab(active);
}

// ===================================================================
// VIEW: PROFILE (own, editable)
// ===================================================================
async function renderProfile() {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading your profile…</div>`;

  const [prof, jobs, edu, certs, skills, scores, settings] = await Promise.all([
    api("/profile/get.php"),
    api("/profile/jobs/list.php"),
    api("/profile/education/list.php"),
    api("/profile/certs/list.php"),
    api("/profile/skills/list.php"),
    api("/score/latest.php"),
    api("/settings/get.php"),
  ]);

  const p = prof.data?.data || {};
  const attrs = p.attributes || {};
  const headline = effectiveHeadline(attrs, jobs.data?.data);
  const initial = (p.username || "?").charAt(0).toUpperCase();
  const loc = [p.city, p.state, p.country].filter(Boolean).join(", ");

  // Own follow counts (owner always sees + can open both lists).
  let ownFollowers = 0, ownFollowing = 0;
  if (p.uuid) {
    const c = await api("/follow/counts.php?type=user&uuid=" + encodeURIComponent(p.uuid));
    ownFollowers = c.data?.data?.followers ?? 0;
    ownFollowing = c.data?.data?.following ?? 0;
  }

  view.innerHTML = "";

  // ---- profile strength (unified onboarding + completeness) ----------
  // Two layers in ONE card:
  //   1) Required steps (gate) — unchanged keys/semantics; scoring stays
  //      locked until these are done.
  //   2) Strength items — the full modern profile checklist. Score-
  //      relevant items mirror ScoreEngine's profile_strength thresholds;
  //      presentation items never affect the score.
  const st = settings.data?.data || {};
  const lists = {
    jobs:      jobs.data?.data      || [],
    edu:       edu.data?.data       || [],
    certs:     certs.data?.data     || [],
    skills:    skills.data?.data    || [],
  };

  const gateSteps = buildGateSteps(st, lists);
  const gateDone = gateSteps.every(s => s.done);
  if (gateDone && st.onboarding_complete !== "1") {
    await api("/settings/set.php", "POST", { key:"onboarding_complete", value:"1" });
    st.onboarding_complete = "1"; // reflect immediately so scoring unlocks this render
  }

  const strength = computeStrength(p, attrs, headline, lists, st);

  // One-time celebration the first time the profile reaches 100%.
  if (strength.pct === 100 && st.strength_complete_seen !== "1") {
    api("/settings/set.php", "POST", { key:"strength_complete_seen", value:"1" });
    st.strength_complete_seen = "1";
    toast("Your profile is 100% complete 🎉");
  }

  const strengthCtx = { p, attrs, headline, st, gateSteps, gateDone, strength };
  if (strength.pct < 100 && !(gateDone && st.strength_hidden === "1")) {
    view.appendChild(renderStrengthCard(strengthCtx));
  }

  // ---- two-column layout: sticky profile box (left) + sections (right) ----
  const grid = el(`<div class="in-profile-grid"></div>`);
  view.appendChild(grid);
  const leftCol  = el(`<div class="in-col-left"></div>`);
  const rightCol = el(`<div class="in-col-right"></div>`);
  grid.appendChild(leftCol);
  grid.appendChild(rightCol);

  // header (left column, sticky) with options menu
  const ownHead = el(`
    <div class="in-phead">
      <button class="in-phead-menu" id="phead-menu-btn" title="Options">👤</button>
      <div class="in-phead-dropdown" id="phead-dropdown">
        <button data-pmenu="edit">Edit profile</button>
      </div>
      ${avatarWithRing(p, initial, strength)}
      <div class="in-phead-info">
        <h1>@${esc(p.username || "")}</h1>
        <div class="loc">${esc(loc || "No location set")}</div>
        ${headline ? `<div class="headline">${esc(headline)}</div>` : ""}
        ${followCountsHtml(ownFollowers, ownFollowing, false, true)}
      </div>
      ${socialLinksHtml(attrs)}
    </div>`);
  leftCol.appendChild(ownHead);
  // Owner can always open their own follower/following lists.
  if (p.uuid) wireFollowCounts(ownHead, p.uuid, false, true);
  const pheadBtn = $("phead-menu-btn");
  const pheadDrop = $("phead-dropdown");
  pheadBtn.onclick = (e) => { e.stopPropagation(); pheadDrop.classList.toggle("show"); };
  document.addEventListener("click", () => pheadDrop.classList.remove("show"));
  pheadDrop.querySelector('[data-pmenu="edit"]').onclick = (e) => {
    e.stopPropagation(); pheadDrop.classList.remove("show"); editCore(p, headline, attrs);
  };

  // Ring badge: if the strength card was hidden, un-hide and bring it
  // back; if it's visible, just scroll up to it.
  const pctBadge = $("avatar-pct-badge");
  if (pctBadge) {
    pctBadge.onclick = async (e) => {
      e.stopPropagation();
      if (document.querySelector(".in-strength")) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      await api("/settings/set.php", "POST", { key:"strength_hidden", value:"0" });
      refreshAfterProfileChange();
    };
  }

  // Skills — moved to the left column, directly under the identity box.
  chipSection(leftCol, "Skills", skills.data?.data, s => `
    ${esc(s.name)}`,
    addSkill, s => ({ id:s.id, kind:"skill" }), "skill");

  // AI Skillset box (left column, below Skills). Owner sees it always so
  // they can enable it; visitors see it only once it's enabled + saved.
  leftCol.appendChild(renderAiBox(st, true));

  // bio — distinct shape from the standard section cards, sits at the
  // very top of the right column, above scores.
  rightCol.appendChild(renderBioBox(attrs, true));

  // scores panel
  const onboardingDone = (st.onboarding_complete === "1");
  const scoreRows = (scores.data?.data || []);
  const scoreCard = el(`<div class="in-card2"><h2>Scores<button class="add" id="score-privacy-btn" title="Score privacy settings" aria-label="Score privacy settings">⚙</button></h2><div id="score-body"></div></div>`);
  rightCol.appendChild(scoreCard);
  $("score-privacy-btn").onclick = () => { location.hash = "settings/scores"; };
  const sb = $("score-body");
  if (!scoreRows.length) {
    sb.appendChild(el(`<div class="in-empty">${onboardingDone
      ? "No scores yet. Use “Score Me!” below to measure yourself against a role or skill."
      : "Scoring unlocks once your profile setup is complete."}</div>`));
  } else {
    scoreRows.forEach(s => sb.appendChild(renderScoreRow(s, true)));
  }
  if (onboardingDone) {
    sb.appendChild(el(`<div style="margin-top:14px"><button class="in-btn primary" style="flex:none;padding:10px 16px" id="score-me">Score Me!</button></div>`));
    $("score-me").onclick = scoreMe;
  } else {
    const locked = el(`
      <div class="score-locked">
        <span class="lock">🔒</span>
        <span>Finish setting up your profile to unlock Score Me!</span>
        <button class="in-btn ghost" style="flex:none;padding:7px 14px;margin-left:auto" id="score-finish">Finish setup</button>
      </div>`);
    sb.appendChild(locked);
    locked.querySelector("#score-finish").onclick = () => window.scrollTo({ top:0, behavior:"smooth" });
  }

  // sections
  section(rightCol, "Experience", jobs.data?.data, j => {
    const companyDisplay = j.company_uuid
      ? `<a href="#company/${esc(j.company_uuid)}" class="emp-link" onclick="event.stopPropagation()">${esc(j.company_name || "")}</a>`
      : esc(j.company_name || "");
    return `
    <div class="meta"><div class="t">${esc(j.title)}</div>
    <div class="s">${companyDisplay}${j.start_date ? " · " + j.start_date + (j.end_date ? " – " + j.end_date : " – Present") : ""}</div></div>`;
  }, "jobs", addJob, j => j.id, j => addJob(j));

  section(rightCol, "Education", edu.data?.data, e => `
    <div class="meta"><div class="t">${esc(e.degree || e.institution)}</div>
    <div class="s">${esc([e.institution, e.field].filter(Boolean).join(" · "))}${e.end_year ? " · " + e.end_year : ""}</div></div>`,
    "education", addEdu, e => e.id, e => addEdu(e));

  section(rightCol, "Certifications", certs.data?.data, c => `
    <div class="meta"><div class="t">${esc(c.name)}</div>
    <div class="s">${certSubLine(c)}</div></div>`,
    "certs", addCert, c => c.id, c => addCert(c));

  // AI Skillset display — sits under Certifications. Shown when the owner
  // has enabled it; visitors see it only if enabled + has endorsed skills.
  const aiBoxRight = renderAiSkillsDisplay(st, true);
  if (aiBoxRight) rightCol.appendChild(aiBoxRight);

  renderPersonalFeed(rightCol, p.uuid);
}

// ---- personal feed (own posts at bottom of profile) ------------------
// Activity feed. Shows a first page of posts with a "See more" button
// rather than everything at once — a long history used to bury the rest
// of the profile (and anything past the old hard LIMIT 50 was simply
// unreachable). Each click appends the next page in place.
const PERSONAL_FEED_PAGE = 10;
let PERSONAL_SORT = "newest";

async function renderPersonalFeed(col, uuid) {
  const card = el(`<div class="in-card2"><div class="activity-head"><h2>Activity</h2></div><div class="body"><div class="in-empty">Loading…</div></div></div>`);
  col.appendChild(card);
  const body = card.querySelector(".body");
  const headEl = card.querySelector(".activity-head");
  let sortControl = null;

  const fetchPage = (offset) => api(
    "/posts/personal.php?type=user&uuid=" + encodeURIComponent(uuid) +
    "&sort=" + encodeURIComponent(PERSONAL_SORT) +
    "&limit=" + PERSONAL_FEED_PAGE + "&offset=" + offset
  );

  // (Re)loads the first page into the card body. On sort change only this
  // runs — the card and its "Activity" header stay put, so nothing above
  // flickers. Body height is held across the swap to avoid a jump.
  const loadFirstPage = async () => {
    const prevH = body.offsetHeight;
    if (prevH) body.style.minHeight = prevH + "px";
    body.classList.add("is-loading");

    const res = await fetchPage(0);
    const posts = res.data?.data?.posts || [];
    const author = res.data?.data?.author || {};

    // Sort control appears once there's more than one post to order. Built
    // once and kept; afterwards only its label updates.
    if (typeof buildSortControl === "function" && (posts.length > 1 || PERSONAL_SORT !== "newest")) {
      if (!sortControl) {
        sortControl = buildSortControl(PERSONAL_SORT, (key) => {
          PERSONAL_SORT = key;
          loadFirstPage();
        });
        headEl.appendChild(sortControl);
      }
    } else if (sortControl) {
      sortControl.remove(); sortControl = null;
    }

    const frag = document.createDocumentFragment();
    if (!posts.length) {
      frag.appendChild(el(`<div class="in-empty">No posts yet. Updates you share will appear here.</div>`));
      body.replaceChildren(frag);
      body.classList.remove("is-loading"); body.style.minHeight = "";
      return;
    }

    const list = el(`<div class="in-post-list" style="border:none;padding:0"></div>`);
    const addPosts = (rows) => rows.forEach(po => list.appendChild(renderPost({
      post_id:po.id, post_type:po.post_type, body:po.body, media_url:po.media_url, meta:po.meta,
      created_at:po.created_at, reason:"self",
      author:{ type:"user", uuid:author.uuid, name:author.name, avatar:author.avatar },
    })));
    addPosts(posts);
    frag.appendChild(list);

    let offset = posts.length;
    if (res.data?.data?.has_more) {
      const moreWrap = el(`<div class="feed-more-wrap"></div>`);
      const btn = el(`<button class="in-btn ghost feed-more">See more…</button>`);
      moreWrap.appendChild(btn);
      frag.appendChild(moreWrap);
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "Loading…";
        const r = await fetchPage(offset);
        if (!r.ok || !r.data?.success) {
          btn.disabled = false; btn.textContent = "See more…";
          toast("Could not load more posts.", "err");
          return;
        }
        const more = r.data.data.posts || [];
        offset += more.length;
        addPosts(more);
        if (r.data.data.has_more && more.length) { btn.disabled = false; btn.textContent = "See more…"; }
        else { moreWrap.remove(); }
      };
    }

    body.replaceChildren(frag);
    body.classList.remove("is-loading");
    body.style.minHeight = "";
  };

  await loadFirstPage();
}

// ---- score row (badge, gradient bar, mini-breakdown, full link) ------
// `showOwnerControls` — pass true only when rendering on the OWNER's own
// profile, to show the per-score hide/unhide toggle.
function renderScoreRow(s, showOwnerControls) {
  const val = Math.max(0, Math.min(100, Math.round(s.score_value)));
  const date = new Date(s.created_at).toLocaleDateString();
  const typeLabel = esc(s.target_type.replace("_", " "));
  const isHidden = !!s.hidden;
  let miniRows = "";
  if (Array.isArray(s.breakdown) && s.breakdown.length) {
    miniRows = s.breakdown.map(f => `
      <div class="mini-row">
        <span class="mini-factor">${esc(f.factor ? f.factor.replace(/_/g," ") : "factor")}</span>
        <span class="mini-detail">${esc(f.detail || "")}</span>
        ${f.points != null ? `<span class="mini-points">+${esc(f.points)}</span>` : ""}
      </div>`).join("");
  } else {
    miniRows = `<div class="in-empty" style="padding:8px 0">No breakdown detail stored for this score yet.</div>`;
  }
  const row = el(`
    <div class="in-score-card ${isHidden ? "score-hidden" : ""}">
      <div class="in-score-row">
        <div class="in-score-badge">${val}</div>
        <div class="meta"><div class="t">${esc(s.target_value)}${isHidden ? '<span class="score-hidden-tag">Hidden</span>' : ""}</div><div class="s">${typeLabel} · ${date}</div></div>
        ${showOwnerControls ? `<button class="score-hide-toggle" title="${isHidden ? "Unhide from your profile" : "Hide from your profile"}">${isHidden ? "🙈" : "👁"}</button>` : ""}
        <button class="score-expand" title="Show breakdown">▾</button>
      </div>
      <div class="score-bar">
        <div class="score-bar-track"></div>
        <div class="score-bar-marker" style="left:${val}%"><div class="score-bar-arrow"></div></div>
      </div>
      <div class="score-detail" style="display:none">
        <div class="score-compare-slot"></div>
        <div class="score-mini">${miniRows}</div>
        <div class="score-detail-actions">
          <button class="in-btn ghost score-fullbtn" style="flex:none;padding:8px 14px">View full breakdown →</button>
          <button class="in-btn ghost score-histbtn" style="flex:none;padding:8px 14px">View history →</button>
          ${showOwnerControls ? `<button class="in-btn danger-ghost score-delbtn" style="flex:none;padding:8px 14px">Remove score</button>` : ""}
        </div>
      </div>
    </div>`);
  const detail = row.querySelector(".score-detail");
  const caret = row.querySelector(".score-expand");
  let compareLoaded = false;
  caret.onclick = () => {
    const open = detail.style.display !== "none";
    detail.style.display = open ? "none" : "block";
    caret.textContent = open ? "▾" : "▴";
    // Lazy-load the "Top X%" comparison the first time the row is opened,
    // and only for the owner (comparing your own standing).
    if (!open && !compareLoaded && showOwnerControls && !isHidden) {
      compareLoaded = true;
      loadScoreComparison(s, row.querySelector(".score-compare-slot"), s.id);
    }
  };
  row.querySelector(".score-fullbtn").onclick = () => { location.hash = "score/" + s.id; };
  row.querySelector(".score-histbtn").onclick = () => {
    location.hash = "score-history/" + encodeURIComponent(s.target_type + "|" + s.target_value);
  };
  if (showOwnerControls) {
    const hideBtn = row.querySelector(".score-hide-toggle");
    hideBtn.onclick = async (e) => {
      e.stopPropagation();
      hideBtn.disabled = true;
      const next = !isHidden;
      const r = await api("/score/hide.php", "POST", { target_type: s.target_type, target_value: s.target_value, hide: next });
      hideBtn.disabled = false;
      if (r.ok && r.data?.success) {
        s.hidden = next;
        row.replaceWith(renderScoreRow(s, true));
      } else {
        toast(r.data?.error || "Could not update visibility.", "err");
      }
    };

    const delBtn = row.querySelector(".score-delbtn");
    if (delBtn) {
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        openScoreRemoveDialog(s, typeLabel);
      };
    }
  }
  return row;
}

// ---- score removal dialog --------------------------------------------
// The profile panel shows only the LATEST score per target, so a target
// can hide a stack of older re-scores behind it. Removing the visible one
// silently reveals the next — which looks like the delete failed. This
// dialog makes that explicit: when history exists, it names the score
// that would resurface and offers "remove just this one" vs "remove all".
async function openScoreRemoveDialog(s, typeLabel, onDone) {
  const val = Math.round(s.score_value);

  // Peek this target's full history (newest first) to know how many
  // scores stack behind the visible one, and what would resurface.
  const params = new URLSearchParams({ target_type: s.target_type, target_value: s.target_value });
  const r = await api("/score/history.php?" + params.toString());
  const hist = (r.ok && r.data?.success && Array.isArray(r.data.data)) ? r.data.data : [];
  const total = hist.length;

  // The "next in line" is the newest score that ISN'T the one being
  // removed (history is newest-first; the visible row is normally hist[0]).
  const next = hist.find(h => h.id !== s.id) || null;
  const escT = esc(s.target_value);

  // Single score (or history unavailable): nothing will resurface, so a
  // plain one-choice confirm is enough.
  if (total <= 1) {
    openModal(`
      <h3>Remove score?</h3>
      <p class="in-modal-text">This permanently deletes your ${esc(typeLabel)} score of <b>${val}</b> for “${escT}”. This can't be undone.</p>
      <div class="in-modal-actions">
        <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
        <button class="in-btn danger" id="score-rm-confirm">Remove</button>
      </div>`);
    $("score-rm-confirm").onclick = () => runScoreRemoval(s, "one", onDone);
    return;
  }

  // Multiple scores: explain the swap and offer both scopes.
  const nextVal = next ? Math.round(next.score_value) : null;
  const nextDate = next ? new Date(next.created_at).toLocaleDateString() : "";
  openModal(`
    <h3>Remove this score?</h3>
    <p class="in-modal-text">You have <b>${total}</b> saved ${esc(typeLabel)} scores for “${escT}”. Your profile shows only the most recent one (<b>${val}</b>).</p>
    ${next ? `<div class="score-rm-next">
        <div class="score-rm-next-badge">${nextVal}</div>
        <div class="score-rm-next-meta">If you remove only the current score, this one becomes visible next:<br><b>${nextVal}</b> · scored ${esc(nextDate)}</div>
      </div>` : ""}
    <div class="in-modal-actions score-rm-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn ghost" id="score-rm-one">Remove just this one</button>
      <button class="in-btn danger" id="score-rm-all">Remove all ${total}</button>
    </div>`);
  $("score-rm-one").onclick = () => runScoreRemoval(s, "one", onDone);
  $("score-rm-all").onclick = () => runScoreRemoval(s, "all", onDone);
}

async function runScoreRemoval(s, scope, onDone) {
  const ids = ["score-rm-confirm", "score-rm-one", "score-rm-all"];
  ids.forEach(id => { const b = $(id); if (b) b.disabled = true; });
  const activeId = scope === "all" ? "score-rm-all" : ($("score-rm-one") ? "score-rm-one" : "score-rm-confirm");
  const activeBtn = $(activeId);
  if (activeBtn) activeBtn.textContent = "Removing…";

  const r = await api("/score/delete.php", "POST", { id: s.id, scope });
  if (r.ok && r.data?.success) {
    closeModal();
    if (typeof onDone === "function") onDone();
    else refreshAfterProfileChange();   // rebuild the latest-per-target panel
  } else {
    ids.forEach(id => { const b = $(id); if (b) b.disabled = false; });
    toast(r.data?.error || "Could not remove the score.", "err");
  }
}
// Renders into `slot`. `scoreId` optionally pins the comparison to a
// specific score of yours; omit to compare your latest.
async function loadScoreComparison(s, slot, scoreId) {
  if (!slot) return;
  slot.innerHTML = `<div class="score-compare loading">Comparing…</div>`;
  const params = new URLSearchParams({
    target_type: s.target_type,
    target_value: s.target_value,
  });
  if (scoreId != null) params.set("score_id", scoreId);
  const r = await api("/score/compare.php?" + params.toString());
  const d = r.data?.data;
  if (!r.ok || !r.data?.success || !d) {
    slot.innerHTML = `<div class="score-compare muted">Comparison unavailable right now.</div>`;
    return;
  }
  if (!d.enough_data || d.top_percent == null) {
    const others = Math.max(0, (d.pool_size || 0) - 1);
    slot.innerHTML = `<div class="score-compare muted">
      Not enough people have scored this ${esc(s.target_type.replace("_"," "))} yet to compare
      ${others > 0 ? `— only ${others} other${others === 1 ? "" : "s"} so far.` : "— you're the first."}
    </div>`;
    return;
  }
  const top = Math.max(1, d.top_percent); // never show "Top 0%"
  slot.innerHTML = `<div class="score-compare">
    <span class="score-compare-badge">Top ${top}%</span>
    <span class="score-compare-text">of the ${d.pool_size} people scored against
      “${esc(s.target_value)}”.</span>
  </div>`;
}

// ---- social link buttons (LinkedIn / X / website) ---------------------
// Renders a compact row of pill links, one per attribute that actually
// has a value. Pills wrap onto a second line if the labels are long.
// Returns "" (nothing) if none are set, so it never leaves an empty gap.
// ---- profile strength -----------------------------------------------
// Gate steps (required before scoring unlocks) — shared by the profile
// card and the full #profile-strength page. Same keys and bulk flows as
// the original onboarding feature.
function buildGateSteps(st, lists) {
  const sk = k => st["strength_skip_" + k] === "1";
  return [
    { key:"email",      label:"Verify your email",            done: st.email_verified === "1", action:null, skip:null },
    { key:"experience", label:"Add your work experience",
      done: lists.jobs.length > 0 || st.step_experience_done === "1" || sk("work"),
      action: () => openBulkExperience(), skip: () => strengthSkip("work") },
    { key:"skills",     label:"Add at least 3 skills",
      done: lists.skills.length >= 3 || st.step_skills_done === "1" || sk("skills3"),
      action: () => openBulkSkills(), skip: () => strengthSkip("skills3") },
    { key:"extras",     label:"Add certifications & education",
      done: (lists.certs.length || lists.edu.length) > 0 || st.step_extras_done === "1" || (sk("edu") && sk("cert")),
      action: () => openExtrasFlow(), skip: () => strengthSkip("extras") },
  ];
}

// Persist a skip. Skipped items count as complete everywhere (strength
// AND the gate). "extras" fans out to both of its underlying items.
async function strengthSkip(key) {
  const writes = key === "extras"
    ? [["strength_skip_edu","1"],["strength_skip_cert","1"],["step_extras_done","1"]]
    : [["strength_skip_" + key, "1"]];
  for (const [k, v] of writes) await api("/settings/set.php","POST",{ key:k, value:v });
  refreshAfterProfileChange();
}

// Reverse a skip (from the full page). Work history also clears the
// legacy "no work experience" flag so the item genuinely reopens.
async function strengthUnskip(key) {
  const writes = [["strength_skip_" + key, "0"]];
  if (key === "work") writes.push(["step_experience_done","0"]);
  for (const [k, v] of writes) await api("/settings/set.php","POST",{ key:k, value:v });
  refreshAfterProfileChange();
}

// Modal save handlers call this instead of renderProfile() directly, so
// completing an item from the #profile-strength page refreshes THAT page
// rather than yanking the user back to the profile.
function refreshAfterProfileChange() {
  if (location.hash === "#profile-strength") renderStrengthPage();
  else renderProfile();
}

// ---- full checklist page (#profile-strength) --------------------------
async function renderStrengthPage() {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading…</div>`;

  const [prof, jobs, edu, certs, skills, settings] = await Promise.all([
    api("/profile/get.php"),
    api("/profile/jobs/list.php"),
    api("/profile/education/list.php"),
    api("/profile/certs/list.php"),
    api("/profile/skills/list.php"),
    api("/settings/get.php"),
  ]);

  const p = prof.data?.data || {};
  const attrs = p.attributes || {};
  const headline = effectiveHeadline(attrs, jobs.data?.data);
  const st = settings.data?.data || {};
  const lists = {
    jobs:      jobs.data?.data      || [],
    edu:       edu.data?.data       || [],
    certs:     certs.data?.data     || [],
    skills:    skills.data?.data    || [],
  };
  const gateSteps = buildGateSteps(st, lists);
  const gateDone = gateSteps.every(s => s.done);
  const strength = computeStrength(p, attrs, headline, lists, st);
  const tier = strengthTier(strength.pct);
  const ctx = { p, attrs, headline };

  view.innerHTML = "";
  const page = el(`
    <div class="in-strpage">
      <a class="in-strpage-back" href="#profile">← Back to profile</a>
      <div class="in-strength">
        <div class="in-str-head">
          <div class="in-str-titles">
            <div class="in-str-title">Profile strength <span class="in-str-tier ${tier.cls}">${tier.name}</span></div>
            <div class="in-str-sub">${strength.doneCount} of ${strength.total} complete${gateDone ? "" : " · finish the required steps to unlock scoring"}</div>
          </div>
          <div class="in-str-pct">${strength.pct}%</div>
        </div>
        <div class="in-str-bar"><div class="in-str-fill" style="width:${strength.pct}%"></div></div>
      </div>
      <div id="strp-sections"></div>
    </div>`);
  view.appendChild(page);
  const sections = page.querySelector("#strp-sections");

  // Required layer first, if the gate is still open.
  if (!gateDone) {
    const req = el(`<div class="in-strength"><div class="in-str-req-title">Required to unlock scoring</div></div>`);
    gateSteps.filter(s => !s.done).forEach(s => {
      const row = el(`
        <div class="in-str-step">
          <span class="in-str-step-label">${esc(s.label)}</span>
          ${s.skip ? `<button class="in-str-skiplink">Skip</button>` : ""}
          ${s.action ? `<button class="in-str-go">Start →</button>` : ""}
        </div>`);
      if (s.action) row.querySelector(".in-str-go").onclick = s.action;
      if (s.skip) row.querySelector(".in-str-skiplink").onclick = s.skip;
      req.appendChild(row);
    });
    sections.appendChild(req);
  }

  // Full checklist, grouped. Done items show as checked; undone ones are
  // actionable. Everything stays visible so the page reads as a checklist
  // being completed, not a shrinking nag list.
  const group = (title, sub, items) => {
    const card = el(`
      <div class="in-strength">
        <div class="in-str-req-title">${esc(title)}</div>
        <div class="in-strp-groupsub">${esc(sub)}</div>
      </div>`);
    items.forEach(i => {
      const row = el(i.done
        ? `<div class="in-str-row done">
             <span class="in-strp-check">✓</span>
             <span class="in-str-row-label">${esc(i.label)}</span>
             ${i.skipped ? `<span class="in-strp-skipnote">skipped</span><button class="in-strp-undo">Undo</button>` : ""}
           </div>`
        : `<div class="in-str-row">
             <span class="in-str-dot ${i.score ? "score" : ""}"></span>
             <span class="in-str-row-label">${esc(i.label)}</span>
             <span class="in-str-row-why">${esc(i.why)}</span>
             <button class="in-str-skiplink" title="Doesn't apply to me — mark it complete">Skip</button>
             <button class="in-str-row-go">Add</button>
           </div>`);
      if (!i.done) {
        row.querySelector(".in-str-row-go").onclick = () => strengthAction(i.act, ctx);
        row.querySelector(".in-str-skiplink").onclick = () => strengthSkip(i.key);
      } else if (i.skipped) {
        row.querySelector(".in-strp-undo").onclick = () => strengthUnskip(i.key);
      }
      card.appendChild(row);
    });
    sections.appendChild(card);
  };

  group("Boosts your score", "These feed the profile-strength part of your Integrally score.",
    strength.items.filter(i => i.score));
  group("Polishes your profile", "These help visitors — they never affect your score.",
    strength.items.filter(i => !i.score));
}

// The full completeness checklist for the modern profile. Score-relevant
// items intentionally mirror ScoreEngine.php's profile_strength
// thresholds (work history, 3+ skills, education, cert) so
// every suggestion the card makes genuinely nudges the user's score —
// but the score itself is computed server-side from relevance and is
// never derived from this percentage. Presentation items (avatar,
// headline, bio, etc.) never touch the score at all.
function computeStrength(p, attrs, headline, L, st) {
  const val = k => (attrs[k]?.value || "").trim();
  const sk = k => st["strength_skip_" + k] === "1";
  const hasSocial = !!(val("linkedin_url") || val("twitter_url") || val("website_url"));
  // real = the thing actually exists; skipped = marked "doesn't apply".
  // Both count as done. Work history also honors the legacy
  // step_experience_done flag from the old "no work experience" checkbox.
  const mk = (key, label, why, real, score, act, skipFlag) => ({
    key, label, why, score, act, real,
    skipped: !real && skipFlag, done: real || skipFlag,
  });
  const items = [
    // score-relevant
    mk("work",    "Add your work history",   "Counts toward your score",                  L.jobs.length >= 1,   true,  "job",   sk("work") || st.step_experience_done === "1"),
    mk("skills3", "Add at least 3 skills",   "Counts toward your score",                  L.skills.length >= 3, true,  "skill", sk("skills3")),
    mk("edu",     "Add your education",      "Counts toward your score",                  L.edu.length >= 1,    true,  "edu",   sk("edu")),
    mk("cert",    "Add a certification",     "Counts toward your score",                  L.certs.length >= 1,  true,  "cert",  sk("cert")),
    // presentation
    mk("avatar",   "Add a profile picture",  "Helps people recognize you",                !!p.profile_pic,      false, "core",  sk("avatar")),
    mk("headline", "Set a headline",         "The first line visitors read",              !!headline,           false, "core",  sk("headline")),
    mk("location", "Add your location",      "Shown on your profile",                     !!(p.city || p.country), false, "core", sk("location")),
    mk("bio",      "Write a short bio",      "Tell visitors who you are",                 !!val("bio"),         false, "bio",   sk("bio")),
    mk("social",   "Link a social profile",  "LinkedIn, X, or your website",              hasSocial,            false, "core",  sk("social")),
    mk("resume",   "Upload your resume",     "Private — used when you apply to jobs",     !!p.resume,           false, "core",  sk("resume")),
  ];
  const doneCount = items.filter(i => i.done).length;
  return { items, doneCount, total: items.length, pct: Math.round((doneCount / items.length) * 100) };
}

function strengthTier(pct) {
  if (pct >= 100) return { name:"Complete",        cls:"t4" };
  if (pct >= 70)  return { name:"Strong",          cls:"t3" };
  if (pct >= 40)  return { name:"Taking shape",    cls:"t2" };
  return           { name:"Getting started", cls:"t1" };
}

// Suggestions the user tapped "Not now" on — session-only, so nothing is
// nagged twice in a sitting but everything comes back next visit.
const STRENGTH_SNOOZED = new Set();

function strengthAction(act, ctx) {
  const { p, attrs, headline } = ctx;
  const val = k => (attrs[k]?.value || "").trim();
  switch (act) {
    case "job":      addJob();      break;
    case "skill":    addSkill();    break;
    case "edu":      addEdu();      break;
    case "cert":     addCert();     break;
    case "bio":      editBio(val("bio"), val("motto")); break;
    case "core":     editCore(p, headline, attrs);      break;
  }
}

// Owner-only avatar ring. Public profiles never call this.
// The viewBox is 4x the rendered pixel size (432 units drawn into 108px).
// A 1:1 viewBox makes the browser rasterize the arc straight into a
// 108-pixel grid, which is what made the curve look jagged; oversampling
// the coordinate space lets it compute the curve at high resolution and
// scale down smoothly.
function avatarWithRing(p, initial, strength) {
  const inner = `<div class="in-avatar">${p.profile_pic ? `<img src="${esc(p.profile_pic)}" alt="">` : esc(initial)}</div>`;
  if (!strength || strength.pct >= 100) return inner;
  // Slider-thumb style: the percentage pill rides the leading edge of the
  // fill. clamp() keeps it on the track at extreme percentages.
  return `
    <div class="in-avatar-strength" title="Profile strength: ${strength.pct}%">
      ${inner}
      <div class="in-avatar-strtrack">
        <div class="in-avatar-strfill" style="width:${strength.pct}%"></div>
        <button class="in-avatar-pct" id="avatar-pct-badge" title="Profile strength"
          style="left:clamp(22px, ${strength.pct}%, calc(100% - 22px))">${strength.pct}%</button>
      </div>
    </div>`;
}

function renderStrengthCard(ctx) {
  const { st, gateSteps, gateDone, strength } = ctx;
  const tier = strengthTier(strength.pct);
  const remaining = strength.items.filter(i => !i.done);

  const card = el(`
    <div class="in-strength">
      <div class="in-str-head">
        <div class="in-str-titles">
          <div class="in-str-title">Profile strength <span class="in-str-tier ${tier.cls}">${tier.name}</span></div>
          <div class="in-str-sub">${strength.doneCount} of ${strength.total} complete${gateDone ? "" : " · finish the required steps to unlock scoring"}</div>
        </div>
        <div class="in-str-pct">${strength.pct}%</div>
        ${gateDone ? `<button class="in-str-hide" title="Hide — the ring on your avatar brings this back">✕</button>` : ""}
      </div>
      <div class="in-str-bar"><div class="in-str-fill" style="width:${strength.pct}%"></div></div>
      <div class="in-str-body"></div>
      <a class="in-str-pagelink" href="#profile-strength">${gateDone
        ? `See everything left (${remaining.length}) →`
        : `View all steps →`}</a>
    </div>`);

  const body = card.querySelector(".in-str-body");

  if (!gateDone) {
    // Required layer — same steps and settings keys as the original
    // onboarding flow; bulk menus and skip paths unchanged. Only the
    // first two undone steps show here; the rest live on the full page.
    const undone = gateSteps.filter(s => !s.done);
    const req = el(`<div class="in-str-req"><div class="in-str-req-title">Required to unlock scoring</div></div>`);
    undone.slice(0, 2).forEach(s => {
      const row = el(`
        <div class="in-str-step">
          <span class="in-str-step-label">${esc(s.label)}</span>
          ${s.skip ? `<button class="in-str-skiplink">Skip</button>` : ""}
          ${s.action ? `<button class="in-str-go">Start →</button>` : ""}
        </div>`);
      if (s.action) row.querySelector(".in-str-go").onclick = s.action;
      if (s.skip) row.querySelector(".in-str-skiplink").onclick = s.skip;
      req.appendChild(row);
    });
    body.appendChild(req);
  } else {
    // Next best action — score-relevant items first (array order), one
    // suggestion at a time. "Not now" cycles; if everything's been
    // snoozed this session, start the cycle over.
    let pool = remaining.filter(i => !STRENGTH_SNOOZED.has(i.key));
    if (!pool.length && remaining.length) { STRENGTH_SNOOZED.clear(); pool = remaining; }
    const next = pool[0];
    if (next) {
      const row = el(`
        <div class="in-str-next">
          <div class="in-str-next-info">
            <div class="in-str-next-label">${esc(next.label)}</div>
            <div class="in-str-next-why">${next.score ? `<span class="in-str-scoretag">▲ score</span>` : ""}${esc(next.why)}</div>
          </div>
          <button class="in-btn primary in-str-next-go">Add</button>
          <button class="in-str-skiplink" title="Doesn't apply to me — mark it complete">Skip</button>
          ${remaining.length > 1 ? `<button class="in-str-next-skip">Not now</button>` : ""}
        </div>`);
      row.querySelector(".in-str-next-go").onclick = () => strengthAction(next.act, ctx);
      row.querySelector(".in-str-skiplink").onclick = () => strengthSkip(next.key);
      const snooze = row.querySelector(".in-str-next-skip");
      if (snooze) snooze.onclick = () => {
        STRENGTH_SNOOZED.add(next.key);
        card.replaceWith(renderStrengthCard(ctx));
      };
      body.appendChild(row);
    }
  }

  const hideBtn = card.querySelector(".in-str-hide");
  if (hideBtn) hideBtn.onclick = async () => {
    card.remove();
    st.strength_hidden = "1";
    await api("/settings/set.php", "POST", { key:"strength_hidden", value:"1" });
    toast("Hidden — tap the ring on your avatar to bring it back");
  };

  return card;
}

function socialLinksHtml(attrs) {
  const websiteLabel = (attrs.website_label?.value || "").trim() || "Website";
  const links = [
    { key: "linkedin_url", label: "LinkedIn", cls: "linkedin" },
    { key: "twitter_url",  label: "X",         cls: "twitter"  },
    { key: "website_url",  label: websiteLabel, cls: "website"  },
  ].map(l => ({ ...l, url: (attrs[l.key]?.value || "").trim() }))
   .filter(l => l.url);

  if (!links.length) return "";

  const normalize = (u) => /^https?:\/\//i.test(u) ? u : "https://" + u;

  return `
    <div class="in-sociallinks">
      ${links.map(l => `
        <a class="in-social-btn ${l.cls}" href="${esc(normalize(l.url))}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(l.url)}">
          <span class="in-social-logo" aria-hidden="true"></span>
          <span class="in-social-name">${esc(l.label)}</span>
        </a>`).join("")}
    </div>`;
}

// ---- bio box (distinct shape, sits above scores) -----------------------
// Filled: white card with a teal accent bar, "About" label, and a small
// pencil button (owner only). Empty + owner: a dashed invitation card.
// Empty + visitor: nothing.
// ---- headline display logic ---------------------------------------------
// Two attrs control what shows under the username (no migration):
//   headline_enabled: "0" hides the headline entirely; anything else = on
//   headline_source:  "job" shows the current job ("Title at Company")
//                     instead of the custom headline text
// A "current job" is the newest job_history row with no end date (the
// jobs list endpoint already orders current-first).
function effectiveHeadline(attrs, jobsList) {
  if ((attrs.headline_enabled?.value ?? "1") === "0") return "";
  if ((attrs.headline_source?.value || "custom") === "job") {
    const list = Array.isArray(jobsList) ? jobsList : [];
    const cur = list.find(j => !j.end_date);
    if (!cur) return "";
    return cur.company_name ? `${cur.title} at ${cur.company_name}` : (cur.title || "");
  }
  return (attrs.headline?.value || "").trim();
}

function renderBioBox(attrs, isOwner) {
  const bio = (attrs.bio?.value || "").trim();
  const motto = (attrs.motto?.value || "").trim();
  if (!bio && !isOwner) return el(`<div style="display:none"></div>`); // nothing to show a visitor

  if (!bio) {
    // Owner with no bio yet — invite, don't decorate.
    const box = el(`
      <div class="in-bio-box empty">
        <div class="in-bio-empty-title">Tell people who you are</div>
        <div class="in-bio-empty-sub">A short bio helps visitors get a feel for your background and what you're after.</div>
        <button class="in-btn ghost in-bio-add" style="flex:none;padding:8px 20px;margin:14px auto 0">Add a bio</button>
      </div>`);
    box.querySelector(".in-bio-add").onclick = () => editBio("", motto);
    return box;
  }

  const box = el(`
    <div class="in-bio-box">
      <div class="in-bio-inner">
        <div class="in-bio-label ${motto ? "motto" : ""}">${esc(motto || "About")}</div>
        <div class="in-bio-text">${esc(bio)}</div>
      </div>
      ${isOwner ? `<button class="in-bio-edit" title="Edit bio">✎</button>` : ""}
    </div>`);
  if (isOwner) {
    box.querySelector(".in-bio-edit").onclick = () => editBio(bio, motto);
  }
  return box;
}

// ---- AI Skillset: helpers -----------------------------------------------
// State lives in user_settings: 'ai_box_enabled' ("1"/"0") and 'ai_skills'
// (JSON array of endorsed skill names). No migration needed.
function aiIsEnabled(st) { return (st && st.ai_box_enabled) === "1"; }
function aiSkills(st) {
  try { const a = JSON.parse((st && st.ai_skills) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
}

// Left-column box. Owner always sees it (to enable/manage); visitors never
// see this control box — their view of AI skills is the right-column display.
function renderAiBox(st, isOwner) {
  if (!isOwner) return el(`<div style="display:none"></div>`);
  const enabled = aiIsEnabled(st);
  const count = aiSkills(st).length;
  const box = el(`
    <div class="in-card2 in-ai-box">
      <h2>AI Skillset ${enabled ? `<span class="in-ai-on">On</span>` : `<span class="in-ai-off">Off</span>`}</h2>
      <div class="in-ai-blurb">Showcase your AI proficiency — the skillset employers increasingly prioritise.</div>
      <button class="in-btn primary in-ai-cta" style="flex:none;padding:9px 16px;margin-top:4px">${enabled ? (count ? "Manage AI skillset" : "Add AI Skillset") : "Add AI Skillset"}</button>
    </div>`);
  box.querySelector(".in-ai-cta").onclick = () => { location.hash = "ai-skillset"; };
  return box;
}

// Right-column display box (under Certifications). Returns null when it
// shouldn't render. Owner sees it once enabled (even if empty, as a prompt);
// visitors see it only when enabled AND there are endorsed skills.
function renderAiSkillsDisplay(st, isOwner) {
  const enabled = aiIsEnabled(st);
  const skills = aiSkills(st);
  if (!enabled) return null;
  if (!isOwner && !skills.length) return null;

  const chips = skills.length
    ? skills.map(s => `<span class="in-chip in-ai-chip">${esc(s)}</span>`).join("")
    : `<div class="in-empty">No AI skills endorsed yet.</div>`;
  const box = el(`
    <div class="in-card2 in-ai-display">
      <h2><span class="in-ai-spark">✦</span> AI Skillset ${isOwner ? `<button class="add in-ai-edit" title="Manage">✎</button>` : ""}</h2>
      <div class="in-chips body">${chips}</div>
    </div>`);
  if (isOwner) box.querySelector(".in-ai-edit").onclick = () => { location.hash = "ai-skillset"; };
  return box;
}

// ---- AI Skillset: full page (#ai-skillset) ------------------------------
// A dedicated page to enable the box and endorse AI-related skills.
const AI_SKILL_SUGGESTIONS = [
  "Prompt engineering", "Working with ChatGPT / LLMs", "AI-assisted coding",
  "Generative AI tools", "AI content creation", "Machine learning basics",
  "Data analysis with AI", "AI image generation", "AI workflow automation",
  "Fine-tuning & RAG", "AI ethics & governance", "AI product strategy",
];

async function renderAiSkillset() {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading…</div>`;
  const res = await api("/settings/get.php");
  const st = res.data?.data || {};
  let enabled = aiIsEnabled(st);
  let chosen = new Set(aiSkills(st));

  view.innerHTML = "";
  const wrap = el(`<div style="max-width:760px;margin:0 auto">
    <div class="in-back"><button class="in-back-btn" onclick="location.hash='profile'">← Back to profile</button></div>

    <div class="in-card2 in-ai-hero">
      <div class="in-ai-hero-eyebrow"><span class="in-ai-spark">✦</span> AI Skillset</div>
      <h1 class="in-ai-hero-title">Show the world you're AI-ready</h1>
      <p class="in-ai-hero-p">Artificial intelligence has moved from novelty to necessity. Across nearly every industry, employers are actively seeking people who can work alongside AI tools — using them to write, analyse, build, and decide faster than ever before. Fluency with AI is quickly becoming as fundamental as knowing your way around a spreadsheet once was.</p>
      <p class="in-ai-hero-p">Endorsing your AI skills tells recruiters and collaborators that you're not just keeping up — you're ahead of the curve. Turn on your AI Skillset below and highlight the tools and techniques you've genuinely worked with. Honest, specific endorsements carry the most weight.</p>
    </div>

    <div class="in-card2">
      <div class="in-set-toggle">
        <div>
          <div class="in-set-toggle-label">Enable AI Skillset on my profile</div>
          <div class="in-set-toggle-sub">When on, your endorsed AI skills appear publicly under Certifications. Off keeps everything private.</div>
        </div>
        <button class="in-toggle ${enabled ? "on" : ""}" id="ai-enable" role="switch" aria-checked="${enabled}"><span class="in-toggle-knob"></span></button>
      </div>
    </div>

    <div class="in-card2">
      <h2>Endorse your AI skills</h2>
      <div class="in-set-toggle-sub" style="margin-bottom:12px">Tap the skills you've worked with, up to 10. Add your own if it's not listed.</div>
      <div class="in-ai-pick" id="ai-pick"></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <input id="ai-custom" placeholder="Add a custom AI skill…" maxlength="60" style="flex:1">
        <button class="in-btn ghost" style="flex:none;padding:9px 16px" id="ai-add">Add</button>
      </div>
    </div>

    <div class="in-ai-save-row">
      <button class="in-btn primary" style="flex:none;padding:11px 26px" id="ai-save">Save AI Skillset</button>
      <span class="in-set-msg" id="ai-msg"></span>
    </div>
  </div>`);
  view.appendChild(wrap);

  const pick = $("ai-pick");
  const paintChips = () => {
    pick.innerHTML = "";
    // suggestions + any custom already-chosen, de-duplicated
    const all = [...new Set([...AI_SKILL_SUGGESTIONS, ...chosen])];
    all.forEach(name => {
      const on = chosen.has(name);
      const chip = el(`<button class="in-ai-pill ${on ? "on" : ""}">${esc(name)}${on ? " ✓" : ""}</button>`);
      chip.onclick = () => { on ? chosen.delete(name) : chosen.add(name); paintChips(); };
      pick.appendChild(chip);
    });
  };
  paintChips();

  $("ai-add").onclick = () => {
    const v = $("ai-custom").value.trim();
    if (!v) return;
    chosen.add(v); $("ai-custom").value = ""; paintChips();
  };
  $("ai-custom").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("ai-add").click(); } });

  const enableBtn = $("ai-enable");
  enableBtn.onclick = () => {
    enabled = !enabled;
    enableBtn.classList.toggle("on", enabled);
    enableBtn.setAttribute("aria-checked", enabled);
  };

  $("ai-save").onclick = async () => {
    const msg = $("ai-msg");
    const list = [...chosen];
    // setting_value is VARCHAR(255); guard against overflow/truncation.
    if (list.length > 10) {
      msg.className = "in-set-msg err"; msg.textContent = "Please choose up to 10 AI skills.";
      return;
    }
    const payload = JSON.stringify(list);
    if (payload.length > 250) {
      msg.className = "in-set-msg err"; msg.textContent = "That's a bit too much text — try fewer or shorter skills.";
      return;
    }
    const btn = $("ai-save"); btn.disabled = true; btn.textContent = "Saving…";
    const r = await api("/settings/set.php", "POST", { settings: {
      ai_box_enabled: enabled ? "1" : "0",
      ai_skills: payload,
    }});
    btn.disabled = false; btn.textContent = "Save AI Skillset";
    if (r.ok && r.data?.success) {
      msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
      setTimeout(() => { location.hash = "profile"; }, 500);
    } else {
      msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save.";
    }
  };
}

// ---- edit bio modal -----------------------------------------------------
function editBio(currentBio, currentMotto) {
  openModal(`
    <h3>Bio</h3>
    <label>Tell people about yourself</label>
    <textarea id="bio-input" rows="6" maxlength="1000" placeholder="A sentence or two about your background, what you're working on, or what you're looking for…">${esc(currentBio || "")}</textarea>
    <label>Motto <span class="ep-hint">(replaces "About" above your bio — leave blank to keep "About")</span></label>
    <input id="bio-motto" maxlength="80" value="${esc(currentMotto || "")}" placeholder="e.g. Build things that matter">
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="bio-save">Save</button>
    </div>`);
  $("bio-save").onclick = async () => {
    const value = $("bio-input").value.trim();
    const r = await api("/profile/set-attribute.php", "POST", { key: "bio", value });
    await api("/profile/set-attribute.php", "POST", { key: "motto", value: $("bio-motto").value.trim() });
    if (r.ok && r.data?.success) { closeModal(); refreshAfterProfileChange(); }
    else { toast(r.data?.error || "Could not save bio.", "err"); }
  };
}

// ---- list + chip section renderers -----------------------------------
function section(view, title, items, rowHtml, kind, onAdd, idOf, onEdit) {
  const card = el(`<div class="in-card2"><h2>${title}<button class="add" title="Add">+</button></h2><div class="body"></div></div>`);
  view.appendChild(card);
  card.querySelector(".add").onclick = onAdd;
  const body = card.querySelector(".body");
  if (!items || !items.length) { body.appendChild(el(`<div class="in-empty">Nothing added yet.</div>`)); return; }
  items.forEach(it => {
    const row = el(`<div class="in-item">${rowHtml(it)}<div class="in-item-actions">${onEdit ? `<button class="edit">Edit</button>` : ""}<button class="del">Remove</button></div></div>`);
    if (onEdit) row.querySelector(".edit").onclick = () => onEdit(it);
    row.querySelector(".del").onclick = () => removeRecord(kind, idOf(it));
    body.appendChild(row);
  });
}
function chipSection(view, title, items, label, onAdd, refOf, kind) {
  const card = el(`<div class="in-card2" data-section="${kind}"><h2>${title}<button class="add" title="Add">+</button></h2><div class="in-chips body"></div></div>`);
  view.appendChild(card);
  card.querySelector(".add").onclick = onAdd;
  fillChips(card.querySelector(".body"), items, label, refOf);
}
function fillChips(body, items, label, refOf) {
  body.innerHTML = "";
  if (!items || !items.length) { body.appendChild(el(`<div class="in-empty">Nothing added yet.</div>`)); return; }
  items.forEach(it => {
    const ref = refOf(it);
    const chip = el(`<span class="in-chip">${label(it)} <button class="x">✕</button></span>`);
    chip.querySelector(".x").onclick = () => removeChip(ref);
    body.appendChild(chip);
  });
}
async function refreshChipSection(kind) {
  const card = document.querySelector(`[data-section="${kind}"]`);
  if (!card) return;
  const body = card.querySelector(".body");
  const res = await api("/profile/skills/list.php");
  fillChips(body, res.data?.data, s => `${esc(s.name)}`, s => ({ id:s.id, kind:"skill" }));
}

// ---- admin: edit another user's core profile -------------------------
function adminEditProfile(p, headline, uuid) {
  openModal(`
    <h3>Edit profile <span style="font-size:12px;color:var(--in-muted);font-weight:600">(admin)</span></h3>
    <p style="color:var(--in-muted);font-size:13px;margin:0 0 8px">Editing @${esc(p.username||"")}'s profile.</p>
    <label>Username</label><input id="af-username" value="${esc(p.username||"")}">
    <div class="row">
      <div><label>City</label><input id="af-city" value="${esc(p.city||"")}"></div>
      <div><label>Country</label><select id="af-country"></select></div>
    </div>
    <div id="af-sub-wrap"></div>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="af-save">Save</button>
    </div>`);
  geoInitCountryModal($("af-country"), $("af-sub-wrap"), { subId: "af-sub", preselect: { country: p.country || "", state: p.state || "" } });
  $("af-save").onclick = async () => {
    const r = await api("/profile/update.php", "POST", {
      target_uuid: uuid,
      username: $("af-username").value.trim(),
      city: $("af-city").value.trim(),
      state: geoGetSubdivisionBy($("af-sub-wrap"), "af-sub"),
      country: $("af-country").value.trim(),
    });
    if (r.ok && r.data?.success) { closeModal(); renderPublicProfile(uuid); }
    else { toast(r.data?.error || "Could not update profile.", "err"); }
  };
}

// ---- edit core (own profile) -----------------------------------------
// Legacy entry point: "Edit profile" used to open a modal. It's now a
// dedicated page (#edit-profile). Callers just navigate; the page fetches
// its own fresh data, so the old (p, headline, attrs) args are ignored.
function editCore() {
  location.hash = "edit-profile";
}

// ---- full Edit Profile page (#edit-profile) ---------------------------
// Mirrors renderStrengthPage: self-fetches, renders into #view. The form
// card carries `in-modal wide` so every field/label/tab style written
// scoped to `.in-modal` applies unchanged in page context; `.in-editpage`
// neutralizes the modal-box chrome so it fills the standard main column.
async function renderEditProfilePage() {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading…</div>`;

  const [prof, jobs] = await Promise.all([
    api("/profile/get.php"),
    api("/profile/jobs/list.php"),
  ]);
  const p = prof.data?.data || {};
  const attrs = p.attributes || {};
  const headline = effectiveHeadline(attrs, jobs.data?.data);

  // The stored `headline` attribute is the raw custom text; show it so
  // saving never clobbers it, regardless of the effective display value.
  const customHeadline = (attrs.headline?.value || "").trim();
  const avatarState = { avatarUrl: p.profile_pic || null };
  const linkedin = attrs.linkedin_url?.value || "";
  const twitter  = attrs.twitter_url?.value || "";
  const website  = attrs.website_url?.value || "";
  const websiteLabel = attrs.website_label?.value || "";

  view.innerHTML = "";
  view.appendChild(el(`
    <div class="in-editpage">
      <a class="in-strpage-back" href="#profile">← Back to profile</a>
      <div class="in-modal wide" id="editpage-card">
        <h3>Edit profile</h3>
        <div class="in-modal-tabs">
          <button class="in-modal-tab active" data-etab="profile">Profile</button>
          <button class="in-modal-tab" data-etab="social">Social</button>
        </div>
        <div data-epanel="profile">
          <div class="ep-top">
            <div class="ep-avatar"><div id="f-avatar"></div></div>
            <div class="ep-identity">
              <label>Username</label><input id="f-username" value="${esc(p.username||"")}">
              <label>Headline</label><input id="f-headline" value="${esc(customHeadline)}" placeholder="e.g. IT Automation Specialist">
              <div class="ep-headline-opts">
                <label class="ep-check"><input type="checkbox" id="f-headline-enabled" ${(attrs.headline_enabled?.value ?? "1") !== "0" ? "checked" : ""}> Show headline on my profile</label>
                <label class="ep-check" id="f-headline-job-wrap"><input type="checkbox" id="f-headline-job" ${(attrs.headline_source?.value || "custom") === "job" ? "checked" : ""}> Use my current job instead</label>
              </div>
              <label>Motto <span class="ep-hint">(replaces "About" on your profile)</span></label><input id="f-motto-core" maxlength="80" value="${esc(attrs.motto?.value || "")}" placeholder="e.g. Build things that matter">
            </div>
          </div>
          <div class="ep-sep"><span>Location</span></div>
          <div class="ep-grid">
            <div><label>City</label><input id="f-city" value="${esc(p.city||"")}"></div>
            <div><label>Country</label><select id="f-country"></select></div>
            <div class="ep-span" id="f-sub-wrap"></div>
            <div class="ep-span"><label>Phone <span class="ep-hint">(private — never shown on your public profile; shared with a company only when you apply to their job)</span></label><input id="f-phone" type="tel" value="${esc(p.phone||"")}" placeholder="+1 (555) 123-4567"></div>
          </div>
        </div>
        <div data-epanel="social" style="display:none">
          <div class="ep-sep"><span>Links</span></div>
          <div class="ep-grid">
            <div><label>LinkedIn URL</label><input id="f-linkedin" value="${esc(linkedin)}" placeholder="linkedin.com/in/yourname"></div>
            <div><label>Twitter / X URL</label><input id="f-twitter" value="${esc(twitter)}" placeholder="x.com/yourname"></div>
            <div><label>Personal website</label><input id="f-website" value="${esc(website)}" placeholder="yourdomain.com"></div>
            <div><label>Website display name</label><input id="f-website-label" value="${esc(websiteLabel)}" placeholder="e.g. My Portfolio"></div>
          </div>
        </div>
        <div class="in-modal-actions">
          <a class="in-btn ghost" href="#profile" style="text-decoration:none;text-align:center">Cancel</a>
          <button class="in-btn primary" id="save-core">Save</button>
        </div>
      </div>
    </div>`));

  const modal = $("editpage-card");

  // ---- headline display options ----
  // The "current job" option only applies while the headline is shown,
  // and the custom text input dims when job mode takes over.
  const syncHeadlineOpts = () => {
    const enabled = $("f-headline-enabled").checked;
    const useJob  = $("f-headline-job").checked;
    $("f-headline-job-wrap").style.display = enabled ? "" : "none";
    $("f-headline").disabled = !enabled || useJob;
    $("f-headline").style.opacity = (!enabled || useJob) ? ".5" : "";
  };
  $("f-headline-enabled").onchange = syncHeadlineOpts;
  $("f-headline-job").onchange = syncHeadlineOpts;
  syncHeadlineOpts();

  modal.querySelectorAll(".in-modal-tab").forEach(t => {
    t.onclick = () => {
      modal.querySelectorAll(".in-modal-tab").forEach(x => x.classList.toggle("active", x === t));
      modal.querySelectorAll("[data-epanel]").forEach(pn => {
        pn.style.display = (pn.dataset.epanel === t.dataset.etab) ? "" : "none";
      });
    };
  });

  mountAvatarPicker("f-avatar", avatarState, { shape: "circle", fallbackChar: p.username || "?" });
  geoInitCountryModal($("f-country"), $("f-sub-wrap"), { subId: "f-sub", preselect: { country: p.country || "", state: p.state || "" } });
  $("save-core").onclick = async () => {
    const r = await api("/profile/update.php", "POST", {
      username:$("f-username").value.trim(), city:$("f-city").value.trim(),
      state:geoGetSubdivisionBy($("f-sub-wrap"),"f-sub"), country:$("f-country").value.trim(),
      phone:$("f-phone").value.trim(),
      profile_pic: avatarState.avatarUrl || "",
    });
    await api("/profile/set-attribute.php", "POST", { key:"headline", value:$("f-headline").value.trim() });
    await api("/profile/set-attribute.php", "POST", { key:"headline_enabled", value:$("f-headline-enabled").checked ? "1" : "0" });
    await api("/profile/set-attribute.php", "POST", { key:"headline_source", value:$("f-headline-job").checked ? "job" : "custom" });
    await api("/profile/set-attribute.php", "POST", { key:"motto", value:$("f-motto-core").value.trim() });
    await api("/profile/set-attribute.php", "POST", { key:"linkedin_url", value:$("f-linkedin").value.trim() });
    await api("/profile/set-attribute.php", "POST", { key:"twitter_url", value:$("f-twitter").value.trim() });
    await api("/profile/set-attribute.php", "POST", { key:"website_url", value:$("f-website").value.trim() });
    await api("/profile/set-attribute.php", "POST", { key:"website_label", value:$("f-website-label").value.trim() });
    // Keep the in-memory user in sync so the nav + composer update without
    // needing a page refresh.
    if (r.ok && r.data?.success && ME) {
      ME = { ...ME, ...r.data.data };
      if (typeof setNavAvatar === "function") {
        setNavAvatar(ME.profile_pic, (ME.username || "?").charAt(0).toUpperCase());
      }
    }
    // Dedicated page: no modal to close. Return to the profile. If we're
    // somehow already on #profile, render explicitly so edits reflect.
    if (location.hash === "#profile") renderProfile();
    else location.hash = "profile";
  };
}

// ---- Job Search page (#job-search) ------------------------------------
// Split out of the old Edit-profile modal's "Job Search" tab. Holds the
// private resume (upload/replace/download/remove) and the read-only list
// of the user's own applications. Self-fetches like the other pages.
async function renderJobSearchPage() {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading…</div>`;

  const prof = await api("/profile/get.php");
  const p = prof.data?.data || {};
  const resume = p.resume || null;   // { name, uploaded_at } | null

  view.innerHTML = "";
  view.appendChild(el(`
    <div class="in-editpage">
      <a class="in-strpage-back" href="#profile">← Back to profile</a>
      <div class="in-modal wide" id="jobsearch-card">
        <h3>Job Search</h3>
        <div class="in-resume-note">Your resume is private. It's stored securely, never shown on your profile, and only you can download it.</div>
        <label>Resume</label>
        <div class="in-resume-row" id="f-resume-row"></div>
        <input type="file" id="f-resume-file" accept=".pdf,.doc,.docx" style="display:none">
        <div class="in-set-msg" id="f-resume-msg"></div>
        <div class="ep-sep"><span>My applications</span></div>
        <div id="f-applications"><div class="in-loading" style="padding:14px">Loading…</div></div>
      </div>
    </div>`));

  // ---- resume row (upload / replace / download / remove) ----
  const resumeState = { current: resume };
  const paintResume = () => {
    const row = $("f-resume-row");
    const cur = resumeState.current;
    if (cur) {
      const when = cur.uploaded_at ? new Date(cur.uploaded_at).toLocaleDateString() : "";
      row.innerHTML = `
        <div class="in-resume-file">
          <span class="in-resume-icon">📄</span>
          <div class="in-resume-meta">
            <div class="in-resume-name">${esc(cur.name || "resume")}</div>
            ${when ? `<div class="in-resume-date">Uploaded ${esc(when)}</div>` : ""}
          </div>
        </div>
        <div class="in-resume-actions">
          <button class="in-btn ghost" style="flex:none;padding:7px 12px" id="f-resume-dl">Download</button>
          <button class="in-btn ghost" style="flex:none;padding:7px 12px" id="f-resume-replace">Replace</button>
          <button class="in-btn danger-ghost" style="flex:none;padding:7px 12px" id="f-resume-remove">Remove</button>
        </div>`;
      $("f-resume-dl").onclick = () => { window.open(API_BASE + "/profile/resume-download.php", "_blank"); };
      $("f-resume-replace").onclick = () => $("f-resume-file").click();
      $("f-resume-remove").onclick = async () => {
        if (!(await confirmDialog("Remove your resume? The file will be deleted.", { confirmText: "Remove", danger: true }))) return;
        const r = await api("/profile/resume-delete.php", "POST");
        const msg = $("f-resume-msg");
        if (r.ok && r.data?.success) { resumeState.current = null; paintResume(); msg.className = "in-set-msg ok"; msg.textContent = "Resume removed."; }
        else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not remove the resume."; }
      };
    } else {
      row.innerHTML = `
        <div class="in-resume-empty">
          <span>No resume uploaded yet.</span>
          <button class="in-btn primary" style="flex:none;padding:8px 16px" id="f-resume-add">Upload resume</button>
        </div>
        <div class="in-resume-hint">PDF, DOC, or DOCX — up to 5 MB.</div>`;
      $("f-resume-add").onclick = () => $("f-resume-file").click();
    }
  };
  paintResume();
  loadMyApplications();

  $("f-resume-file").onchange = async () => {
    const file = $("f-resume-file").files[0];
    if (!file) return;
    const msg = $("f-resume-msg");
    if (file.size > 5 * 1024 * 1024) { msg.className = "in-set-msg err"; msg.textContent = "Resume must be under 5 MB."; return; }
    msg.className = "in-set-msg"; msg.textContent = "Uploading…";
    const fd = new FormData();
    fd.append("resume", file);
    try {
      const res = await fetch(API_BASE + "/profile/resume-upload.php", { method:"POST", credentials:"include", body:fd });
      const data = await res.json();
      // Multipart bypasses api(), so the 429 handler has to be called by hand.
      if (res.status === 429) handleRateLimited(data);
      if (res.ok && data.success) {
        resumeState.current = data.data;
        paintResume();
        msg.className = "in-set-msg ok"; msg.textContent = "Resume uploaded.";
      } else {
        msg.className = "in-set-msg err"; msg.textContent = data.error || "Upload failed.";
      }
    } catch (e) {
      msg.className = "in-set-msg err"; msg.textContent = "Upload failed.";
    }
    $("f-resume-file").value = "";
  };
}

// ---- My applications (Job Search page) --------------------------------
async function loadMyApplications() {
  const box = $("f-applications");
  if (!box) return;
  await renderApplicationsInto(box, {
    empty: `You haven't applied to any jobs yet. Browse the <a href="#jobs">jobs board</a> to get started.`,
    onWithdraw: loadMyApplications,
  });
}

// Shared renderer: draws the current user's applications into `box`.
// Used by the profile Job Search tab AND the Jobs page "My applications"
// view, so the two stay in sync. opts.empty is HTML for the empty state;
// opts.onWithdraw is called to re-render after a successful withdraw.
async function renderApplicationsInto(box, opts = {}) {
  if (!box) return;
  const onWithdraw = opts.onWithdraw || (() => renderApplicationsInto(box, opts));
  const emptyHtml = opts.empty || "You haven't applied to any jobs yet.";
  box.innerHTML = `<div class="in-loading">Loading your applications…</div>`;

  const r = await api("/applications/mine.php");
  if (!r.ok || !r.data?.success) {
    box.innerHTML = `<div class="in-empty" style="padding:14px">Could not load your applications.</div>`;
    return;
  }
  const apps = r.data.data.applications || [];
  if (!apps.length) {
    box.innerHTML = `<div class="in-empty" style="padding:14px">${emptyHtml}</div>`;
    return;
  }

  const statusClass = { submitted: "ok", withdrawn: "off", expired: "off", job_unavailable: "off" };

  // A job can have up to TWO records: a native Quick apply AND an external
  // "applied on company site" mark. Group by job so both show on one row,
  // each contributing its own badge + action button.
  const groups = [];
  const byJob = new Map();
  apps.forEach(a => {
    // Job-removed rows have no job.uuid — key them individually so they
    // don't collapse together.
    const key = a.job?.uuid || ("__" + a.uuid);
    if (!byJob.has(key)) { const g = { key, native: null, external: null, any: a }; byJob.set(key, g); groups.push(g); }
    const g = byJob.get(key);
    if (a.apply_channel === "external") g.external = a; else g.native = a;
  });

  box.innerHTML = groups.map(g => {
    const a = g.native || g.external;   // representative record for job/company info
    const job = a.job;
    const co = a.company;
    const title = job ? esc(job.title) : "Job removed";
    const coName = co ? esc(co.name) : "";
    const meta = [coName, job?.location].filter(Boolean).join(" · ");
    const link = job ? `href="#job/${esc(job.uuid)}"` : "";

    // Score comes from the native application only.
    const scoreVal = g.native?.score_value;
    const score = scoreVal != null ? `<span class="ap-score" title="Your score at apply time">${Math.round(scoreVal)}</span>` : "";

    // One badge per channel present.
    const chips = [];
    if (g.native)   chips.push(`<span class="ap-channel native">${esc(g.native.channel_label || "Quick applied")}</span>`);
    if (g.external) chips.push(`<span class="ap-channel ext">${esc(g.external.channel_label || "Applied on company site")}</span>`);
    const chipsHtml = chips.join(" ");

    // Status pill: the native application is the real submission, so its
    // status leads. If there's only an external mark, show that as tracked.
    const statusRec = g.native || g.external;
    const statusPill = `<span class="in-set-msg ${statusClass[statusRec.status] || ""}" style="margin:0;flex:none">${esc(statusRec.status_label)}</span>`;

    // One action button per present channel.
    const btns = [];
    if (g.native && g.native.can_withdraw) {
      btns.push(`<button class="in-btn ghost ap-withdraw" data-uuid="${esc(g.native.uuid)}" data-kind="native" style="flex:none;padding:6px 12px;font-size:12.5px">Withdraw</button>`);
    }
    if (g.external) {
      btns.push(`<button class="in-btn ghost ap-withdraw" data-uuid="${esc(g.external.uuid)}" data-kind="external" style="flex:none;padding:6px 12px;font-size:12.5px">Remove</button>`);
    }
    const btnsHtml = btns.length ? `<div class="ap-actions">${btns.join("")}</div>` : "";

    return `
      <div class="ap-row">
        <div class="ap-row-main">
          ${job ? `<a class="ap-title" ${link}>${title}</a>` : `<span class="ap-title">${title}</span>`}
          <div class="ap-meta">${meta}</div>
          <div class="ap-tags">${chipsHtml}</div>
        </div>
        ${score}
        ${statusPill}
        ${btnsHtml}
      </div>`;
  }).join("");

  box.querySelectorAll(".ap-withdraw").forEach(btn => {
    btn.onclick = async () => {
      const isExt = btn.dataset.kind === "external";
      const msg = isExt
        ? "Remove this tracking entry? It only affects your own applications list."
        : "Withdraw this application? This can't be undone.";
      if (!(await confirmDialog(msg, { confirmText: "Remove", danger: true }))) return;
      btn.disabled = true;
      const r2 = await api("/applications/withdraw.php", "POST", { uuid: btn.dataset.uuid });
      if (r2.ok && r2.data?.success) onWithdraw();
      else { btn.disabled = false; toast(r2.data?.error || "Could not update.", "err"); }
    };
  });
}

function addJob(existing) {
  const isEdit = !!(existing && existing.id);
  const linkedInit = (existing && existing.company_uuid)
    ? { uuid: existing.company_uuid, name: existing.company_name || "" } : null;
  openModal(`
    <h3>${isEdit ? "Edit experience" : "Add experience"}</h3>
    <label>Title *</label><div class="job-ta-wrap"><input id="j-title" autocomplete="off" placeholder="e.g. Systems Administrator" value="${isEdit ? esc(existing.title || "") : ""}"></div>
    <label>Company</label>
    <div class="emp-search">
      <input id="j-company" autocomplete="off" placeholder="Type to search company accounts…" value="${isEdit ? esc(existing.company_name || "") : ""}">
      <div class="emp-results" id="j-company-results"></div>
      <div class="emp-linked" id="j-company-linked" style="display:none"></div>
    </div>
    <div class="row"><div><label>Start date</label><input id="j-start" type="date" value="${isEdit ? esc(existing.start_date || "") : ""}"></div><div><label>End date</label><input id="j-end" type="date" value="${isEdit && existing.end_date ? esc(existing.end_date) : ""}"></div></div>
    <label class="jf-checkrow" style="margin-top:4px">
      <input type="checkbox" id="j-current" ${isEdit && !existing.end_date && existing.start_date ? "checked" : ""}> I currently work here
    </label>
    <label>Description</label><textarea id="j-desc" rows="3">${isEdit ? esc(existing.description || "") : ""}</textarea>
    <div class="in-modal-actions">
      ${isEdit ? `<button class="in-btn ghost" onclick="closeModal()">Cancel</button>` : `<button class="in-btn ghost" id="j-none">No job history</button>`}
      <button class="in-btn primary" id="save-job">${isEdit ? "Save" : "Add"}</button>
    </div>`);

  // Live employer search: as the user types, look up company accounts that
  // allow being listed. Selecting one links it (stores company_uuid).
  let linkedCompany = linkedInit;   // { uuid, name } when a company account is chosen

  // Job-title typeahead: suggests catalog titles (which the score engine
  // maps to categories) while still allowing any free text.
  if (typeof jobMountTypeahead === "function") {
    jobMountTypeahead($("j-title"), { minChars: 2, limit: 8 });
  }

  const cInput = $("j-company");
  const cResults = $("j-company-results");
  const cLinked = $("j-company-linked");

  const showLinked = () => {
    if (linkedCompany) {
      cLinked.innerHTML = `<span class="emp-linked-tag">🔗 Linked to ${esc(linkedCompany.name)}</span><button type="button" class="emp-unlink" title="Unlink">✕</button>`;
      cLinked.style.display = "flex";
      cLinked.querySelector(".emp-unlink").onclick = () => { linkedCompany = null; cLinked.style.display = "none"; cLinked.innerHTML = ""; };
    } else {
      cLinked.style.display = "none"; cLinked.innerHTML = "";
    }
  };

  const doSearch = debounce(async () => {
    const q = cInput.value.trim();
    // Typing a new name unlinks any previous selection.
    if (linkedCompany && q !== linkedCompany.name) { linkedCompany = null; showLinked(); }
    if (q.length < 2) { cResults.style.display = "none"; cResults.innerHTML = ""; return; }
    const r = await api("/company/search-employers.php?q=" + encodeURIComponent(q));
    const list = (r.ok && r.data?.success) ? r.data.data.companies : [];
    if (!list.length) { cResults.style.display = "none"; cResults.innerHTML = ""; return; }
    cResults.innerHTML =
      `<div class="emp-results-head">Company accounts — pick one to link, or keep typing to leave unlinked</div>` +
      list.map(c =>
      `<button type="button" class="emp-result" data-uuid="${esc(c.uuid)}" data-name="${esc(c.name)}">
        <span class="emp-result-logo">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : esc((c.name||"?").charAt(0).toUpperCase())}</span>
        <span><span class="emp-result-name">${esc(c.name)}</span>${c.industry ? `<span class="emp-result-ind">${esc(c.industry)}</span>` : ""}</span>
      </button>`).join("") +
      `<button type="button" class="emp-result emp-result-dismiss" id="emp-keep-text">✕ Keep "${esc(q)}" as plain text (don't link)</button>`;
    cResults.style.display = "block";
    const keepBtn = cResults.querySelector("#emp-keep-text");
    if (keepBtn) keepBtn.onclick = () => {
      linkedCompany = null;
      cResults.style.display = "none"; cResults.innerHTML = "";
      showLinked();
    };
    cResults.querySelectorAll(".emp-result").forEach(btn => {
      btn.onclick = () => {
        linkedCompany = { uuid: btn.dataset.uuid, name: btn.dataset.name };
        cInput.value = btn.dataset.name;
        cResults.style.display = "none"; cResults.innerHTML = "";
        showLinked();
      };
    });
  }, 250);

  cInput.addEventListener("input", doSearch);
  document.addEventListener("click", (e) => { if (!cInput.contains(e.target) && !cResults.contains(e.target)) { cResults.style.display = "none"; } });

  // "I currently work here" — clears/disables the end date.
  const currentCb = $("j-current");
  const endInput = $("j-end");
  currentCb.onchange = () => {
    if (currentCb.checked) { endInput.value = ""; endInput.disabled = true; endInput.style.opacity = ".5"; }
    else { endInput.disabled = false; endInput.style.opacity = ""; }
  };
  showLinked();          // reflect any pre-linked company (edit mode)
  currentCb.onchange();  // reflect initial current-job state (edit mode)

  const noneBtn = $("j-none");
  if (noneBtn) noneBtn.onclick = async () => { await api("/settings/set.php","POST",{key:"step_experience_done",value:"1"}); closeModal(); refreshAfterProfileChange(); };
  $("save-job").onclick = async () => {
    const title = $("j-title").value.trim(); if (!title) return;
    const company = $("j-company").value.trim();
    if (isEdit) {
      await api("/profile/jobs/update.php","POST",{
        id: existing.id,
        title, company_name:company,
        // Send the uuid so the backend can (re)link; empty string unlinks.
        // Guard: only treat as linked if the typed name still matches the
        // linked company, so editing the name to free text unlinks too.
        company_uuid: (linkedCompany && company === linkedCompany.name) ? linkedCompany.uuid : "",
        start_date:$("j-start").value,
        end_date: currentCb.checked ? "" : $("j-end").value,
        description:$("j-desc").value.trim()
      });
      closeModal(); refreshAfterProfileChange();
    } else {
      // Read every field BEFORE closeModal(). closeModal() sets the
      // modal's innerHTML to "", so any $("j-…") lookup after it returns
      // null and reading .value throws — which silently killed both the
      // share prompt AND the renderProfile() below it.
      const startDate = $("j-start").value;
      const isCurrent = currentCb.checked;

      await api("/profile/jobs/add.php","POST",{
        title, company_name:company,
        company_uuid: (linkedCompany && company === linkedCompany.name) ? linkedCompany.uuid : null,
        start_date: startDate,
        end_date: isCurrent ? "" : $("j-end").value,   // current job -> no end date
        description:$("j-desc").value.trim()
      });
      closeModal();
      // Only prompt to post to the feed for a CURRENT role — sharing a
      // past job to the feed doesn't make sense.
      if (isCurrent) {
        offerShareJob(title, company, startDate);
      }
      refreshAfterProfileChange();
    }
  };
}

function addEdu(existing) {
  const isEdit = !!(existing && existing.id);
  // Sensible bounds for the year fields: no year 1, and up to a few years
  // out so people can list an expected graduation. The placeholder shows a
  // plausible year instead of the number spinner defaulting to 1.
  const nowYear = new Date().getFullYear();
  const maxYear = nowYear + 8;
  openModal(`
    <h3>${isEdit ? "Edit education" : "Add education"}</h3>
    <label>Institution</label><input id="e-inst" value="${isEdit ? esc(existing.institution || "") : ""}">
    <label>Degree</label><input id="e-deg" value="${isEdit ? esc(existing.degree || "") : ""}" placeholder="e.g. BS, MBA">
    <label>Field</label><div class="job-ta-wrap"><input id="e-field" value="${isEdit ? esc(existing.field || "") : ""}" placeholder="e.g. Computer Science" autocomplete="off"></div>
    <div class="row"><div><label>Start year</label><input id="e-start" type="number" min="1950" max="${maxYear}" step="1" placeholder="${nowYear - 4}" value="${isEdit && existing.start_year ? esc(String(existing.start_year)) : ""}"></div><div><label>End year</label><input id="e-end" type="number" min="1950" max="${maxYear}" step="1" placeholder="${nowYear}" value="${isEdit && existing.end_year ? esc(String(existing.end_year)) : ""}"></div></div>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="save-edu">${isEdit ? "Save" : "Add"}</button></div>`);
  // Field-of-study typeahead: recommends catalog fields (which the score
  // engine can map to job categories) but allows any free text.
  if (typeof jobMountTypeahead === "function" && typeof eduCatalogSearch === "function") {
    jobMountTypeahead($("e-field"), { search: eduCatalogSearch, minChars: 2, limit: 8 });
  } else {
    console.warn("[education typeahead] not mounted:",
      "jobMountTypeahead=" + typeof jobMountTypeahead,
      "eduCatalogSearch=" + typeof eduCatalogSearch,
      "- check that assets/js/education-catalog.js is loaded (app.html script tag / 404) and jobs-catalog.js is current.");
  }
  $("save-edu").onclick = async () => {
    const payload = { institution:$("e-inst").value.trim(), degree:$("e-deg").value.trim(), field:$("e-field").value.trim(), start_year:$("e-start").value, end_year:$("e-end").value };
    if (isEdit) {
      await api("/profile/education/update.php","POST",{ id:existing.id, ...payload });
      closeModal(); refreshAfterProfileChange();
    } else {
      const r = await api("/profile/education/add.php","POST", payload);
      // Capture what we need for the share card BEFORE closeModal() wipes
      // the modal DOM (and with it these inputs).
      const inst = payload.institution, deg = payload.degree, fld = payload.field, endY = payload.end_year;
      closeModal();
      if (r.ok && r.data?.success) offerShareEdu(inst, deg, fld, endY);
      refreshAfterProfileChange();
    }
  };
}

// Cert sub-line: issuer · issued · expiry. Expiry only appears when the
// certification actually has one (many never expire), and an already-
// past date is flagged rather than shown as a neutral fact.
function certSubLine(c) {
  const bits = [];
  if (c.issuer) bits.push(esc(c.issuer));
  if (c.issue_date) bits.push(esc(c.issue_date));
  let out = bits.join(" · ");
  if (c.expiry_date) {
    const expired = new Date(c.expiry_date) < new Date(new Date().toDateString());
    out += (out ? " · " : "") + (expired
      ? `<span class="cert-expired">Expired ${esc(c.expiry_date)}</span>`
      : `Expires ${esc(c.expiry_date)}`);
  }
  return out;
}

function addCert(existing) {
  const isEdit = !!(existing && existing.id);
  const hasExp = !!(isEdit && existing.expiry_date);
  openModal(`
    <h3>${isEdit ? "Edit certification" : "Add certification"}</h3>
    <label>Name *</label><input id="c-name" value="${isEdit ? esc(existing.name || "") : ""}">
    <label>Issuer</label><input id="c-issuer" value="${isEdit ? esc(existing.issuer || "") : ""}">
    <div class="row">
      <div><label>Issued</label><input id="c-issue" type="date" value="${isEdit ? esc(existing.issue_date || "") : ""}"></div>
      <div id="c-exp-wrap" ${hasExp ? "" : "hidden"}><label>Expires</label><input id="c-exp" type="date" value="${isEdit ? esc(existing.expiry_date || "") : ""}"></div>
    </div>
    <label class="cert-expcheck"><input type="checkbox" id="c-has-exp" ${hasExp ? "checked" : ""}> This certification expires</label>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="save-cert">${isEdit ? "Save" : "Add"}</button></div>`);
  // Expiry is opt-in: many certifications never expire. The date field
  // only appears once the box is ticked, and unticking it clears the
  // value so an empty string reaches the API (which stores NULL).
  const expBox = $("c-has-exp"), expWrap = $("c-exp-wrap");
  expBox.onchange = () => {
    expWrap.hidden = !expBox.checked;
    if (!expBox.checked) $("c-exp").value = "";
    else $("c-exp").focus();
  };
  $("save-cert").onclick = async () => {
    const name = $("c-name").value.trim(); if (!name) return;
    const issuer = $("c-issuer").value.trim();
    const expiry = $("c-has-exp").checked ? $("c-exp").value : "";
    if ($("c-has-exp").checked && !expiry) { toast("Enter an expiration date, or uncheck “This certification expires.”", "err"); return; }
    const payload = { name, issuer, issue_date:$("c-issue").value, expiry_date:expiry };
    if (isEdit) { await api("/profile/certs/update.php","POST",{ id:existing.id, ...payload }); closeModal(); refreshAfterProfileChange(); }
    else        { await api("/profile/certs/add.php","POST", payload); closeModal(); offerShareCert(name, issuer); refreshAfterProfileChange(); }
  };
}

function addSkill() {
  openModal(`
    <h3>Add skill</h3>
    <label>Skill name *</label><input id="s-name" placeholder="e.g. PowerShell">
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="save-skill">Add</button></div>`);
  $("save-skill").onclick = async () => {
    const name = $("s-name").value.trim(); if (!name) return;
    await api("/profile/skills/add.php","POST",{ name });
    closeModal(); refreshChipSection("skill");
  };
}

function scoreMe() {
  openModal(`
    <h3>Score Me!</h3>
    <label>Score against</label>
    <select id="sm-type"><option value="job_title">Job title</option><option value="skill">Skill</option><option value="field">Field</option></select>
    <label>Target</label>
    <div class="job-ta-wrap"><input id="sm-value" placeholder="e.g. Automation Engineer" autocomplete="off"></div>
    <div id="sm-hint" class="sm-hint">Start typing to see recommended titles — or enter any role you like.</div>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="run-score">Score</button></div>`);

  const input = $("sm-value");
  const typeSel = $("sm-type");
  const hint = $("sm-hint");

  // Attach the job-title typeahead only for the job_title type. The
  // catalog is a recommendation source; any free-text value is allowed.
  let ta = null;
  const syncTypeahead = () => {
    const isJob = typeSel.value === "job_title";
    hint.style.display = isJob ? "block" : "none";
    if (isJob && !ta && typeof jobMountTypeahead === "function") {
      ta = jobMountTypeahead(input, { minChars: 2, limit: 8 });
    } else if (!isJob && ta) {
      ta.close();
    }
  };
  typeSel.onchange = syncTypeahead;
  syncTypeahead();

  $("run-score").onclick = async () => {
    const target_value = input.value.trim(); if (!target_value) return;
    const btn = $("run-score"); btn.disabled = true; btn.textContent = "Scoring…";
    const r = await api("/score/score-me.php","POST",{ target_type:typeSel.value, target_value });
    if (r.ok && r.data?.success) { closeModal(); refreshAfterProfileChange(); }
    else if (r.data?.code === "entry_cap") { showEntryCapModal(); }
    else { btn.disabled = false; btn.textContent = "Score"; toast(r.data?.error || "Could not score right now.", "err"); }
  };
}

// Shown when scoring a NEW target would exceed the plan's entry cap.
// Replaces the Score Me modal content in the same overlay. Copy differs
// by plan: free users get the Plus pitch; Plus users just get the limit.
function showEntryCapModal() {
  const isPlus = ME && ME.plan === "plus";
  openModal(`
    <div class="cap-modal">
      <div class="cap-badge">${isPlus ? "★" : "＋"}</div>
      <h3 class="cap-title">${isPlus ? "Score limit reached" : "You've hit your score limit"}</h3>
      <p class="cap-body">
        ${isPlus
          ? "Plus profiles can keep up to <strong>5</strong> score entries. To add a new one, remove an existing entry first."
          : "Free profiles can keep up to <strong>2</strong> score entries. You can re-score an existing entry anytime — that never counts against your limit."}
      </p>
      ${isPlus ? "" : `
      <div class="cap-upsell">
        <div class="cap-upsell-head"><span class="cap-plus-tag">Plus</span> Coming soon</div>
        <div class="cap-upsell-body">Plus profiles will keep up to <strong>5</strong> score entries — plus more perks on the way.</div>
      </div>`}
      <div class="in-modal-actions">
        <button class="in-btn primary" onclick="closeModal()" style="margin-left:auto">Got it</button>
      </div>
    </div>`);
}

// ---- removals --------------------------------------------------------
const RECORD_ENDPOINTS = { jobs:"/profile/jobs/delete.php", education:"/profile/education/delete.php", certs:"/profile/certs/delete.php" };
async function removeRecord(kind, id) {
  if (!(await confirmDialog("Remove this entry?", { confirmText: "Remove", danger: true }))) return;
  await api(RECORD_ENDPOINTS[kind], "POST", { id });
  refreshAfterProfileChange();
}
async function removeChip(ref) {
  await api("/profile/skills/remove.php","POST",{ skill_id:ref.id });
  refreshChipSection(ref.kind);
}

// ---- share-to-feed prompts -------------------------------------------
// Both prompts show a LIVE PREVIEW of the card that will appear in the
// feed, so the person can see what they're publishing before they publish
// it. The note is optional — a milestone post with an empty body still
// renders as a proper card, because the content lives in meta, not body.
//
// Job posts used to be plain text ("💼 Excited to share a new role: X at
// Y!") — a hardcoded sentence in someone else's voice, with no card. They
// now post post_type:"job" and render as a milestone, the same way certs
// already did. The server has always whitelisted the type; nothing else
// was using it.

// "March 2026" from an ISO date. Returns "" for a missing/garbage value
// rather than "Invalid Date".
function monthYear(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 7 ? "-01" : ""));
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function milestoneCardHtml(kind, m) {
  const conf = milestoneConfig(kind, m);
  return `
    <div class="post-milestone ${conf.cls}">
      <div class="ms-icon">${conf.icon}</div>
      <div class="ms-text">
        <div class="ms-label">${conf.label}</div>
        <div class="ms-name">${esc(conf.name)}</div>
        ${conf.sub ? `<div class="ms-sub">${conf.sub}</div>` : ""}
      </div>
    </div>`;
}

// Single source of truth for how each milestone kind presents (icon,
// label, headline, sub-line). Shared by the share-preview modal here and
// the feed renderer (feed.js reimplements the same three cases — keep them
// in sync). `esc`-es its own sub-line so callers can join pre-escaped bits.
function milestoneConfig(kind, m) {
  if (kind === "job") {
    const bits = [m.company, m.start_label].filter(Boolean).map(esc);
    return {
      cls: "job", icon: "💼",
      label: m.is_promotion ? "New role" : "Started a new position",
      name: m.title || "",
      sub: bits.join(" · "),
    };
  }
  if (kind === "edu") {
    // Name line: "Degree, Field" when both exist, else whichever we have.
    const nameParts = [m.degree, m.field].filter(Boolean);
    // Sub-line: institution + year, but drop the institution when it's
    // already standing in as the name (no degree/field) so it isn't shown
    // twice. Mirrors the feed renderer.
    const bits = [];
    if (nameParts.length && m.institution) bits.push(esc(m.institution));
    if (m.year_label) bits.push(esc(m.year_label));
    return {
      cls: "edu", icon: "📚",
      label: "Completed education",
      name: nameParts.join(", ") || m.institution || "",
      sub: bits.join(" · "),
    };
  }
  // cert
  return {
    cls: "cert", icon: "🎓",
    label: "Earned a certification",
    name: m.name || "",
    sub: m.issuer ? esc(m.issuer) : "",
  };
}

function offerShareMilestone(kind, meta, noteHint) {
  openModal(`
    <h3>Share to your feed?</h3>
    <p class="share-intro">This is how it will look:</p>
    ${milestoneCardHtml(kind, meta)}
    <label style="margin-top:14px">Add a note (optional)</label>
    <textarea id="share-note" rows="3" placeholder="${esc(noteHint)}"></textarea>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Skip</button>
      <button class="in-btn primary" id="share-go">Post to feed</button>
    </div>`);

  $("share-go").onclick = async () => {
    const btn = $("share-go");
    btn.disabled = true; btn.textContent = "Posting…";
    const r = await api("/posts/create.php", "POST", {
      post_type: kind,
      body: $("share-note").value.trim(),
      meta,
      visibility: "public",
    });
    if (r.ok && r.data?.success) {
      closeModal();
      toast("Shared to your feed.", "ok");
    } else {
      btn.disabled = false; btn.textContent = "Post to feed";
      toast(r.data?.error || "Could not share to your feed.", "err");
    }
  };
}

function offerShareJob(title, company, startDate) {
  offerShareMilestone("job", {
    title,
    company: company || null,
    start_label: monthYear(startDate) || null,
  }, "What are you looking forward to?");
}

function offerShareCert(name, issuer) {
  offerShareMilestone("cert", {
    name,
    issuer: issuer || null,
  }, "Say something about it…");
}

function offerShareEdu(institution, degree, field, endYear) {
  offerShareMilestone("edu", {
    institution: institution || null,
    degree: degree || null,
    field: field || null,
    year_label: endYear ? String(endYear) : null,
  }, "Share a word about your studies…");
}

// Kept for any caller that still wants a plain-text share prompt.
function offerShare(suggestedText) {
  openModal(`
    <h3>Share to your feed?</h3>
    <label>Post</label><textarea id="share-body" rows="3">${esc(suggestedText)}</textarea>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Skip</button><button class="in-btn primary" id="share-go">Post to feed</button></div>`);
  $("share-go").onclick = async () => {
    const body = $("share-body").value.trim();
    if (body) await api("/posts/create.php","POST",{ body, visibility:"public" });
    closeModal();
  };
}

// ---- onboarding bulk-entry menus -------------------------------------
function openBulkExperience() {
  openModal(`
    <h3>Add your work experience</h3>
    <p class="bulk-intro">Add each role you've held. You can add as many as you like, then save them all at once.</p>
    <div id="bulk-jobs"></div>
    <button class="bulk-addrow" id="bulk-job-add">+ Add another role</button>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="bulk-job-save">Save &amp; complete</button></div>`);
  const wrap = $("bulk-jobs");
  const addRow = () => {
    const row = el(`
      <div class="bulk-row">
        <button class="bulk-row-x" title="Remove">✕</button>
        <div class="job-ta-wrap"><input class="bj-title" placeholder="Job title *" autocomplete="off"></div>
        <input class="bj-company" placeholder="Company">
        <div class="bulk-dates">
          <div class="bulk-date-field"><label>Start date</label><input class="bj-start" type="date"></div>
          <div class="bulk-date-field"><label>End date</label><input class="bj-end" type="date"></div>
        </div>
        <label class="bulk-current"><input type="checkbox" class="bj-current"> I currently work here</label>
      </div>`);
    row.querySelector(".bulk-row-x").onclick = () => row.remove();
    row.querySelector(".bj-current").onchange = (e) => { const end = row.querySelector(".bj-end"); end.disabled = e.target.checked; if (e.target.checked) end.value = ""; };
    wrap.appendChild(row);
    if (typeof jobMountTypeahead === "function") {
      jobMountTypeahead(row.querySelector(".bj-title"), { minChars: 2, limit: 8 });
    }
  };
  addRow();
  $("bulk-job-add").onclick = addRow;
  $("bulk-job-save").onclick = async () => {
    const btn = $("bulk-job-save"); btn.disabled = true; btn.textContent = "Saving…";
    const rows = [...wrap.querySelectorAll(".bulk-row")];
    const jobs = rows.map(r => ({
      title: r.querySelector(".bj-title").value.trim(),
      company_name: r.querySelector(".bj-company").value.trim(),
      start_date: r.querySelector(".bj-start").value,
      end_date: r.querySelector(".bj-current").checked ? "" : r.querySelector(".bj-end").value,
    })).filter(j => j.title);
    if (!jobs.length) { btn.disabled = false; btn.textContent = "Save & complete"; toast("Add at least one role, or Cancel if you have none — you can skip this step from the profile strength card.", "err"); return; }
    for (const j of jobs) await api("/profile/jobs/add.php","POST", j);
    await api("/settings/set.php","POST",{ key:"step_experience_done", value:"1" });
    closeModal(); refreshAfterProfileChange();
  };
}

function openBulkSkills() {
  openModal(`
    <h3>Add your skills</h3>
    <p class="bulk-intro">Add at least 3 skills. Type a skill and press Enter or “Add”.</p>
    <div class="bulk-skill-input"><input id="bulk-skill-field" placeholder="e.g. PowerShell"><button class="in-btn primary" id="bulk-skill-add" style="flex:none;padding:10px 16px">Add</button></div>
    <div class="bulk-skill-chips" id="bulk-skill-chips"></div>
    <div class="bulk-skill-count" id="bulk-skill-count">0 added — need at least 3</div>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="bulk-skill-save" disabled>Save &amp; complete</button></div>`);
  const pending = [];
  const chips = $("bulk-skill-chips"), field = $("bulk-skill-field"), countEl = $("bulk-skill-count"), saveBtn = $("bulk-skill-save");
  const refresh = () => {
    chips.innerHTML = "";
    pending.forEach((name, i) => {
      const chip = el(`<span class="in-chip">${esc(name)} <button class="x">✕</button></span>`);
      chip.querySelector(".x").onclick = () => { pending.splice(i,1); refresh(); };
      chips.appendChild(chip);
    });
    countEl.textContent = pending.length >= 3 ? `${pending.length} added` : `${pending.length} added — need at least ${3 - pending.length} more`;
    saveBtn.disabled = pending.length < 3;
  };
  const addStaged = () => { const v = field.value.trim(); if (v && !pending.some(s => s.toLowerCase() === v.toLowerCase())) pending.push(v); field.value = ""; field.focus(); refresh(); };
  $("bulk-skill-add").onclick = addStaged;
  field.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addStaged(); } });
  saveBtn.onclick = async () => {
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    for (const name of pending) await api("/profile/skills/add.php","POST",{ name });
    await api("/settings/set.php","POST",{ key:"step_skills_done", value:"1" });
    closeModal(); refreshAfterProfileChange();
  };
}

function openExtrasFlow() {
  openModal(`
    <h3>Round out your profile</h3>
    <p class="bulk-intro">Add any education and certifications you have. All optional — skip anything that doesn't apply, then finish.</p>
    <div class="extras-sec"><div class="extras-label">Education</div><div id="ex-edu-rows"></div><button class="bulk-addrow" id="ex-edu-add">+ Add education</button></div>
    <div class="extras-sec"><div class="extras-label">Certifications</div><div id="ex-cert-rows"></div><button class="bulk-addrow" id="ex-cert-add">+ Add certification</button></div>
    <div class="in-modal-actions"><button class="in-btn ghost" id="ex-skip">I have none of these</button><button class="in-btn primary" id="ex-save">Save &amp; complete</button></div>`);
  const eduWrap = $("ex-edu-rows");
  $("ex-edu-add").onclick = () => {
    const row = el(`<div class="bulk-row"><button class="bulk-row-x">✕</button><input class="ee-inst" placeholder="Institution"><input class="ee-deg" placeholder="Degree"><div class="job-ta-wrap"><input class="ee-field" placeholder="Field of study" autocomplete="off"></div><div class="bulk-dates"><div class="bulk-date-field"><label>Start year</label><input class="ee-start" type="number" placeholder="2018"></div><div class="bulk-date-field"><label>End year</label><input class="ee-end" type="number" placeholder="2022"></div></div></div>`);
    row.querySelector(".bulk-row-x").onclick = () => row.remove(); eduWrap.appendChild(row);
    if (typeof jobMountTypeahead === "function" && typeof eduCatalogSearch === "function") {
      jobMountTypeahead(row.querySelector(".ee-field"), { search: eduCatalogSearch, minChars: 2, limit: 8 });
    } else {
      console.warn("[education typeahead] not mounted (bulk row):",
        "jobMountTypeahead=" + typeof jobMountTypeahead,
        "eduCatalogSearch=" + typeof eduCatalogSearch);
    }
  };
  const certWrap = $("ex-cert-rows");
  $("ex-cert-add").onclick = () => {
    const row = el(`<div class="bulk-row"><button class="bulk-row-x">✕</button><input class="ec-name" placeholder="Certification name *"><input class="ec-issuer" placeholder="Issuer"><div class="bulk-dates"><div class="bulk-date-field"><label>Issued</label><input class="ec-issue" type="date"></div><div class="bulk-date-field ec-exp-wrap" hidden><label>Expires</label><input class="ec-exp" type="date"></div></div><label class="cert-expcheck"><input type="checkbox" class="ec-has-exp"> This certification expires</label></div>`);
    row.querySelector(".bulk-row-x").onclick = () => row.remove();
    const ecBox = row.querySelector(".ec-has-exp"), ecWrap = row.querySelector(".ec-exp-wrap");
    ecBox.onchange = () => {
      ecWrap.hidden = !ecBox.checked;
      if (!ecBox.checked) row.querySelector(".ec-exp").value = "";
      else row.querySelector(".ec-exp").focus();
    };
    certWrap.appendChild(row);
  };
  // "I have none of these" now also marks the underlying strength items
  // (education + certification) as skipped/complete, not just the gate.
  $("ex-skip").onclick = async () => { closeModal(); await strengthSkip("extras"); };
  $("ex-save").onclick = async () => {
    const btn = $("ex-save"); btn.disabled = true; btn.textContent = "Saving…";
    for (const r of eduWrap.querySelectorAll(".bulk-row")) {
      const inst = r.querySelector(".ee-inst").value.trim(), deg = r.querySelector(".ee-deg").value.trim();
      if (!inst && !deg) continue;
      await api("/profile/education/add.php","POST",{ institution:inst, degree:deg, field:r.querySelector(".ee-field").value.trim(), start_year:r.querySelector(".ee-start").value, end_year:r.querySelector(".ee-end").value });
    }
    for (const r of certWrap.querySelectorAll(".bulk-row")) {
      const name = r.querySelector(".ec-name").value.trim(); if (!name) continue;
      const ecExp = r.querySelector(".ec-has-exp").checked ? r.querySelector(".ec-exp").value : "";
      await api("/profile/certs/add.php","POST",{ name, issuer:r.querySelector(".ec-issuer").value.trim(), issue_date:r.querySelector(".ec-issue").value, expiry_date:ecExp });
    }
    await api("/settings/set.php","POST",{ key:"step_extras_done", value:"1" });
    closeModal(); refreshAfterProfileChange();
  };
}

// ===================================================================
// VIEW: PUBLIC PROFILE (read-only, by uuid)
// ===================================================================
async function renderPublicProfile(uuid) {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading profile…</div>`;
  // Any signed-in identity — user OR company — can follow a user; skip
  // the status call only for signed-out visitors.
  const canFollow = !!(ME || CO);
  const [prof, jobs, edu, certs, skills, scores, fstat, counts] = await Promise.all([
    api("/profile/get.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/jobs/list.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/education/list.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/certs/list.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/skills/list.php?uuid=" + encodeURIComponent(uuid)),
    api("/score/latest.php?uuid=" + encodeURIComponent(uuid)),
    canFollow ? api("/follow/status.php?type=user&uuid=" + encodeURIComponent(uuid)) : Promise.resolve(null),
    api("/follow/counts.php?type=user&uuid=" + encodeURIComponent(uuid)),
  ]);
  const p = prof.data?.data;
  if (!p) {
    view.innerHTML = `<div class="in-card2"><div class="in-empty" style="text-align:center">Profile not found.</div><div style="text-align:center;margin-top:14px"><button class="in-btn ghost" style="flex:none;padding:9px 18px" onclick="location.hash='feed'">← Back to feed</button></div></div>`;
    return;
  }
  if (p.is_owner) { location.hash = "profile"; return; }
  const attrs = p.attributes || {};
  const headline = effectiveHeadline(attrs, jobs.data?.data);
  const initial = (p.username || "?").charAt(0).toUpperCase();
  const loc = [p.city, p.state, p.country].filter(Boolean).join(", ");
  // Follow state + counts.
  const isFollowing = canFollow ? !!(fstat && fstat.data?.data?.following) : false;
  const followerCount = counts.data?.data?.followers ?? 0;
  const followingCount = counts.data?.data?.following ?? 0;
  const listsHidden = !!(counts.data?.data?.lists_hidden);

  view.innerHTML = "";
  view.appendChild(el(`<div class="in-back"><button class="in-back-btn" onclick="history.back()">← Back</button></div>`));
  const grid = el(`<div class="in-profile-grid"></div>`);
  view.appendChild(grid);
  const leftCol = el(`<div class="in-col-left"></div>`), rightCol = el(`<div class="in-col-right"></div>`);
  grid.appendChild(leftCol); grid.appendChild(rightCol);

  const head = el(`
    <div class="in-phead">
      <div class="in-avatar">${p.profile_pic ? `<img src="${esc(p.profile_pic)}" alt="">` : esc(initial)}</div>
      <div class="in-phead-info">
        <h1>@${esc(p.username || "")}</h1>
        <div class="loc">${esc(loc || "No location set")}</div>
        ${headline ? `<div class="headline">${esc(headline)}</div>` : ""}
        ${followCountsHtml(followerCount, followingCount, listsHidden, false)}
      </div>
      ${socialLinksHtml(attrs)}
      ${canFollow ? `<button class="in-follow-btn ${isFollowing ? "following" : ""}" id="follow-toggle">${isFollowing ? "Following" : "Follow"}</button>` : ""}
      ${ME && ME.uuid !== uuid ? `<button class="in-msg-btn" id="msg-user">✉️ Message</button>` : ""}
      ${ME && ME.role === "admin" ? `<button class="in-admin-btn" id="admin-edit">🛠 Edit (admin)</button>` : ""}
    </div>`);
  leftCol.appendChild(head);
  const msgBtn = head.querySelector("#msg-user");
  if (msgBtn) msgBtn.onclick = () => openMessageModal(uuid, p.username || "");
  // Tappable follower/following counts (respects the target's hide setting).
  wireFollowCounts(head, uuid, listsHidden, false);
  // Live follower-count state so the number updates without a refresh.
  let liveFollowers = followerCount;
  const followBtn = head.querySelector("#follow-toggle");
  if (followBtn) {
    followBtn.onclick = async () => {
      const btn = head.querySelector("#follow-toggle");
      const currentlyFollowing = btn.classList.contains("following");
      btn.disabled = true;
      const endpoint = currentlyFollowing ? "/follow/unfollow.php" : "/follow/follow.php";
      const r = await api(endpoint, "POST", { target_type:"user", target_uuid:uuid });
      btn.disabled = false;
      if (r.ok && r.data?.success) {
        btn.classList.toggle("following");
        const nowFollowing = btn.classList.contains("following");
        btn.textContent = nowFollowing ? "Following" : "Follow";
        // Live-update the follower count in the header.
        liveFollowers = Math.max(0, liveFollowers + (nowFollowing ? 1 : -1));
        const stat = head.querySelector('[data-follow-list="followers"] .n');
        const label = head.querySelector('[data-follow-list="followers"]');
        if (stat) stat.textContent = liveFollowers;
        if (label) label.lastChild.textContent = ` follower${liveFollowers === 1 ? "" : "s"}`;
      }
      else { toast(r.data?.error || "Could not update follow status.", "err"); }
    };
  }
  // admin: edit this user's core profile fields
  if (ME && ME.role === "admin") {
    head.querySelector("#admin-edit").onclick = () => adminEditProfile(p, headline, uuid);
  }

  // Skills in the left column (mirrors the owner layout), now with
  // endorsement counts and — when viewer & target mutually follow — a
  // tappable "vouch" control. canEndorse is a UI hint from
  // follow/status.php's mutual flag; the server re-checks every write.
  const canEndorse = !!(ME && fstat && fstat.data?.data?.mutual);
  renderEndorsableSkills(leftCol, skills.data?.data, uuid, canEndorse);

  // bio — same distinct box as the owner view, read-only here.
  rightCol.appendChild(renderBioBox(attrs, false));

  const scoreRows = (scores.data?.data || []);
  const scoreCard = el(`<div class="in-card2"><h2>Scores</h2><div></div></div>`);
  rightCol.appendChild(scoreCard);
  const ssb = scoreCard.querySelector("div");
  if (!scoreRows.length) ssb.appendChild(el(`<div class="in-empty">No scores to show.</div>`));
  else scoreRows.forEach(s => ssb.appendChild(renderScoreRow(s, false)));

  roSection(rightCol, "Experience", jobs.data?.data, j => `<div class="meta"><div class="t">${esc(j.title)}</div><div class="s">${esc(j.company_name || "")}${j.start_date ? " · " + j.start_date + (j.end_date ? " – " + j.end_date : " – Present") : ""}</div></div>`);
  roSection(rightCol, "Education", edu.data?.data, e => `<div class="meta"><div class="t">${esc(e.degree || e.institution)}</div><div class="s">${esc([e.institution, e.field].filter(Boolean).join(" · "))}${e.end_year ? " · " + e.end_year : ""}</div></div>`);
  roSection(rightCol, "Certifications", certs.data?.data, c => `<div class="meta"><div class="t">${esc(c.name)}</div><div class="s">${certSubLine(c)}</div></div>`);
  // AI Skillset display under Certifications — only if enabled with skills.
  const pubAi = p.ai_skillset;
  if (pubAi && pubAi.enabled && (pubAi.skills || []).length) {
    const chips = pubAi.skills.map(s => `<span class="in-chip in-ai-chip">${esc(s)}</span>`).join("");
    rightCol.appendChild(el(`<div class="in-card2 in-ai-display"><h2><span class="in-ai-spark">✦</span> AI Skillset</h2><div class="in-chips body">${chips}</div></div>`));
  }
}
function roSection(col, title, items, rowHtml) {
  const card = el(`<div class="in-card2"><h2>${title}</h2><div class="body"></div></div>`);
  col.appendChild(card);
  const body = card.querySelector(".body");
  if (!items || !items.length) { body.appendChild(el(`<div class="in-empty">Nothing listed.</div>`)); return; }
  items.forEach(it => body.appendChild(el(`<div class="in-item">${rowHtml(it)}</div>`)));
}
function roChips(col, title, items, label) {
  const card = el(`<div class="in-card2"><h2>${title}</h2><div class="in-chips body"></div></div>`);
  col.appendChild(card);
  const body = card.querySelector(".body");
  if (!items || !items.length) { body.appendChild(el(`<div class="in-empty">Nothing listed.</div>`)); return; }
  items.forEach(it => body.appendChild(el(`<span class="in-chip">${label(it)}</span>`)));
}

// Skills card for a PUBLIC profile with endorsement ("vouch") support.
// Each chip shows the skill name and, when endorsed by anyone, a count
// badge. When canEndorse is true (viewer and target mutually follow, per
// follow/status.php), the whole chip is a toggle button that vouches /
// un-vouches; the server re-validates every write, so this is only an
// affordance. Own-profile and non-mutual viewers get read-only chips
// that still display counts.
function renderEndorsableSkills(col, items, targetUuid, canEndorse) {
  const card = el(`<div class="in-card2"><h2>Skills</h2><div class="in-chips body"></div></div>`);
  col.appendChild(card);
  const body = card.querySelector(".body");
  if (!items || !items.length) {
    body.appendChild(el(`<div class="in-empty">Nothing listed.</div>`));
    return;
  }

  // When the viewer is able to vouch (mutual follow), it isn't obvious
  // the chips are tappable — spell it out with a one-line hint above the
  // chips. Non-mutual / own-profile viewers don't see this (nothing to act on).
  if (canEndorse) {
    card.querySelector(".body").insertAdjacentElement("beforebegin", el(
      `<p class="in-card-hint">Tap a skill to vouch that they have it. Your endorsement is visible to others and shown as a count on the skill.</p>`
    ));
  }

  items.forEach(s => {
    const skillId = s.id;
    const chip = el(
      `<span class="in-chip in-skill-chip${canEndorse ? " endorsable" : ""}${s.you_endorsed ? " endorsed" : ""}"
             ${canEndorse ? 'role="button" tabindex="0"' : ""}>
         <span class="in-skill-name">${esc(s.name)}</span>
         <span class="in-endo-badge" data-count="${skillId}" ${(+s.endorsements > 0) ? "" : "hidden"}>
           <span class="in-endo-tick" aria-hidden="true">✓</span><span class="in-endo-n">${+s.endorsements}</span>
         </span>
       </span>`
    );

    if (canEndorse) {
      const title = () => chip.classList.contains("endorsed")
        ? "You vouched for this skill — tap to undo"
        : "Vouch for this skill";
      chip.title = title();

      const toggle = async () => {
        if (chip.dataset.busy === "1") return;      // guard double-taps
        chip.dataset.busy = "1";
        const wasEndorsed = chip.classList.contains("endorsed");
        const r = await api("/profile/endorsements/set.php", "POST", {
          target_uuid: targetUuid,
          skill_id: skillId,
          endorse: !wasEndorsed,
        });
        chip.dataset.busy = "0";
        if (!(r.ok && r.data?.success)) {
          toast(r.data?.error || "Could not update endorsement.", "err");
          return;
        }
        const n = +r.data.data.endorsements;
        const nowEndorsed = !!r.data.data.you_endorsed;
        chip.classList.toggle("endorsed", nowEndorsed);
        const badge = chip.querySelector(".in-endo-badge");
        badge.querySelector(".in-endo-n").textContent = n;
        badge.hidden = n <= 0;
        chip.title = title();
        toast(nowEndorsed ? "Skill endorsed" : "Endorsement removed", "ok");
      };

      chip.addEventListener("click", toggle);
      chip.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
    }

    body.appendChild(chip);
  });
}

// ===================================================================
// VIEW: SETTINGS (left-nav tabs)
// ===================================================================
let SETTINGS_TAB = "account";
let SETTINGS_DATA = null;   // cached {p, st} so tab switches don't refetch

async function renderSettings(tab) {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading settings…</div>`;
  // Deep link from #settings/<tab>. Validated against the real tab list
  // further down, which falls back to "account" for anything unknown.
  if (tab) SETTINGS_TAB = tab;

  // fetch once; tab switches reuse this without refetching/rebuilding.
  const [prof, settings] = await Promise.all([
    api("/profile/get.php"),
    api("/settings/get.php"),
  ]);
  SETTINGS_DATA = { p: prof.data?.data || {}, st: settings.data?.data || {} };
  const isAdmin = (ME && ME.role === "admin");

  const tabs = [
    { key:"account",       label:"Account" },
    { key:"appearance",    label:"Appearance" },
    { key:"privacy",       label:"Privacy" },
    { key:"scores",        label:"Scores" },
    { key:"notifications", label:"Notifications" },
    { key:"connections",   label:"Connections" },
    ...(isAdmin ? [{ key:"admin", label:"Admin" }] : []),
    { key:"danger",        label:"Change Account" },
  ];
  if (!tabs.some(t => t.key === SETTINGS_TAB)) SETTINGS_TAB = "account";

  view.innerHTML = "";
  const wrap = el(`<div class="in-settings"></div>`);
  view.appendChild(wrap);

  // left nav — built ONCE; clicks just swap the panel content.
  const nav = el(`<div class="in-set-nav"></div>`);
  wrap.appendChild(nav);
  const panel = el(`<div class="in-set-panel"></div>`);
  wrap.appendChild(panel);

  const navButtons = {};
  tabs.forEach(t => {
    const b = el(`<button class="${t.key === SETTINGS_TAB ? "active" : ""} ${t.key === "danger" ? "danger" : ""}">${esc(t.label)}</button>`);
    b.onclick = () => {
      SETTINGS_TAB = t.key;
      Object.values(navButtons).forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      paintSettingsPanel(panel);   // only the panel changes -> no full re-render, no blink
    };
    navButtons[t.key] = b;
    nav.appendChild(b);
  });

  paintSettingsPanel(panel);
}

// renders just the active tab's panel content into the given element
function paintSettingsPanel(panel) {
  const { p, st } = SETTINGS_DATA || { p:{}, st:{} };
  panel.innerHTML = "";
  if (SETTINGS_TAB === "account")            renderSetAccount(panel, p);
  else if (SETTINGS_TAB === "appearance")    renderSetAppearance(panel, st);
  else if (SETTINGS_TAB === "privacy")       renderSetPrivacy(panel, st);
  else if (SETTINGS_TAB === "scores")        renderSetScores(panel, st);
  else if (SETTINGS_TAB === "notifications") renderSetNotifications(panel);
  else if (SETTINGS_TAB === "connections")   renderSetConnections(panel);
  else if (SETTINGS_TAB === "admin")         renderSetAdmin(panel);
  else if (SETTINGS_TAB === "danger")        renderSetDanger(panel);
}

// ---- Account tab: edit core fields + password placeholder ------------
function renderSetAccount(panel, p) {
  panel.appendChild(el(`
    <div class="in-set-group">
    <div class="in-set-section">
      <h3>Account details</h3>
      <label>Username</label><input id="set-username" value="${esc(p.username||"")}">
      <div class="row" style="display:flex;gap:10px">
        <div style="flex:1"><label>City</label><input id="set-city" value="${esc(p.city||"")}"></div>
        <div style="flex:1"><label>Country</label><select id="set-country"></select></div>
      </div>
      <div id="set-sub-wrap"></div>
      <label>Email</label><input value="${esc(p.email||"")}" disabled title="Email changes require verification (coming soon)">
      <div class="in-set-actions"><button class="in-btn primary" style="flex:none;padding:10px 20px" id="set-save-account">Save changes</button></div>
      <div class="in-set-msg" id="set-account-msg"></div>
    </div>
    <div class="in-set-section">
      <h3>Password</h3>
      <div class="in-set-placeholder">Changing your password will require email verification or multi-factor authentication. This is coming soon.</div>
      <button class="in-btn ghost" style="flex:none;padding:9px 18px;opacity:.6;cursor:not-allowed" disabled>Change password</button>
    </div>
    </div>`));
  geoInitCountryModal($("set-country"), $("set-sub-wrap"), { subId: "set-sub", preselect: { country: p.country || "", state: p.state || "" } });
  $("set-save-account").onclick = async () => {
    const msg = $("set-account-msg");
    const r = await api("/profile/update.php", "POST", {
      username: $("set-username").value.trim(),
      city: $("set-city").value.trim(),
      state: geoGetSubdivisionBy($("set-sub-wrap"), "set-sub"),
      country: $("set-country").value.trim(),
    });
    if (r.ok && r.data?.success) { msg.className = "in-set-msg ok"; msg.textContent = "Saved."; }
    else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
  };
}

// ---- Privacy tab: the following toggle (real, wired to backend) ------
function renderSetPrivacy(panel, st) {
  // following_enabled defaults to ON when unset
  const followingOn = st.following_enabled !== "0";
  const discoverableOn = st.discoverable !== "0";                 // default on (live)
  const showCityOn = st.show_city !== "0";                        // default on
  const readReceiptsOn = st.read_receipts !== "0";               // default on (dormant)
  const msgConnOnly = st.messages_connections_only === "1";      // default off (dormant)
  const hideFollowListsOn = st.hide_follow_lists === "1";        // default off (lists visible)
  panel.appendChild(el(`
    <div class="in-set-group">
    <div class="in-set-section">
      <h3>Discoverability</h3>
      <div class="in-set-toggle">
        <div>
          <div class="in-set-toggle-label">Show me in search</div>
          <div class="in-set-toggle-sub">When off, your profile won't appear in other people's search results. Direct profile links still work.</div>
        </div>
        <button class="in-toggle ${discoverableOn ? "on" : ""}" id="toggle-discoverable" role="switch" aria-checked="${discoverableOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-toggle" style="margin-top:16px">
        <div>
          <div class="in-set-toggle-label">Show my city on my profile</div>
          <div class="in-set-toggle-sub">When off, your city is hidden from your public profile. Your country still shows.</div>
        </div>
        <button class="in-toggle ${showCityOn ? "on" : ""}" id="toggle-show-city" role="switch" aria-checked="${showCityOn}"><span class="in-toggle-knob"></span></button>
      </div>
    </div>
    <div class="in-set-section">
      <h3>Messaging</h3>
      <div class="in-set-toggle">
        <div>
          <div class="in-set-toggle-label">Send read receipts <span class="in-soon-pill">Coming soon</span></div>
          <div class="in-set-toggle-sub">When on, people can see when you've read their message. Saving works now; enforcement lands with the next messaging update.</div>
        </div>
        <button class="in-toggle ${readReceiptsOn ? "on" : ""}" id="toggle-read-receipts" role="switch" aria-checked="${readReceiptsOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-toggle" style="margin-top:16px">
        <div>
          <div class="in-set-toggle-label">Only allow messages from connections <span class="in-soon-pill">Coming soon</span></div>
          <div class="in-set-toggle-sub">When on, only people you follow can start a conversation. Saving works now; enforcement lands with the next messaging update.</div>
        </div>
        <button class="in-toggle ${msgConnOnly ? "on" : ""}" id="toggle-msg-conn" role="switch" aria-checked="${msgConnOnly}"><span class="in-toggle-knob"></span></button>
      </div>
    </div>
    <div class="in-set-section">
      <h3>Privacy & preferences</h3>
      <div class="in-set-toggle">
        <div>
          <div class="in-set-toggle-label">Allow following</div>
          <div class="in-set-toggle-sub">When off, you won't be able to follow people or companies.</div>
        </div>
        <button class="in-toggle ${followingOn ? "on" : ""}" id="toggle-following" role="switch" aria-checked="${followingOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-toggle" style="margin-top:16px">
        <div>
          <div class="in-set-toggle-label">Hide my followers and following lists</div>
          <div class="in-set-toggle-sub">When on, other people can still see your follower and following counts, but can't open the lists to see who those people are. You can always view your own lists.</div>
        </div>
        <button class="in-toggle ${hideFollowListsOn ? "on" : ""}" id="toggle-hide-follow-lists" role="switch" aria-checked="${hideFollowListsOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-msg" id="set-privacy-msg"></div>
    </div>
    </div>`));
  // Shared handler for a simple boolean setting toggle. onSaved runs after a
  // successful save (used by share-scores to show/hide its sub-row).
  const wireToggle = (id, key, onSaved) => {
    const btn = $(id);
    if (!btn) return;
    btn.onclick = async () => {
      const turningOn = !btn.classList.contains("on");
      btn.disabled = true;
      const r = await api("/settings/set.php", "POST", { key, value: turningOn ? "1" : "0" });
      btn.disabled = false;
      const msg = $("set-privacy-msg");
      if (r.ok && r.data?.success) {
        btn.classList.toggle("on", turningOn);
        btn.setAttribute("aria-checked", turningOn);
        if (onSaved) onSaved(turningOn);
        msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
      } else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
    };
  };
  wireToggle("toggle-discoverable",  "discoverable");
  wireToggle("toggle-show-city",     "show_city");
  wireToggle("toggle-hide-follow-lists", "hide_follow_lists");
  wireToggle("toggle-read-receipts", "read_receipts");
  wireToggle("toggle-msg-conn",      "messages_connections_only");
  $("toggle-following").onclick = async () => {
    const btn = $("toggle-following");
    const turningOn = !btn.classList.contains("on");
    btn.disabled = true;
    const r = await api("/settings/set.php", "POST", { key:"following_enabled", value: turningOn ? "1" : "0" });
    btn.disabled = false;
    const msg = $("set-privacy-msg");
    if (r.ok && r.data?.success) {
      btn.classList.toggle("on", turningOn);
      btn.setAttribute("aria-checked", turningOn);
      msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
    } else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
  };
}
// ---- Scores tab: score visibility + sharing --------------------------
function renderSetScores(panel, st) {
  const hideScoresOn = st.hide_all_scores === "1";
  const shareScoresOn = st.share_scores_with_companies !== "0";        // default on
  const shareHiddenOn = st.share_hidden_scores_with_companies === "1"; // default off
  panel.appendChild(el(`
    <div class="in-set-group">
    <div class="in-set-section">
      <h3>Score visibility</h3>
      <div class="in-set-toggle">
        <div>
          <div class="in-set-toggle-label">Hide all scores from other users</div>
          <div class="in-set-toggle-sub">Your scores stay visible to you, but no one else will see them on your profile. You can also hide individual scores from the profile page.</div>
        </div>
        <button class="in-toggle ${hideScoresOn ? "on" : ""}" id="toggle-hide-scores" role="switch" aria-checked="${hideScoresOn}"><span class="in-toggle-knob"></span></button>
      </div>
    </div>
    <div class="in-set-section">
      <h3>Sharing with companies</h3>
      <div class="in-set-toggle">
        <div>
          <div class="in-set-toggle-label">Share my scores with companies I apply to</div>
          <div class="in-set-toggle-sub">When on, companies reviewing your application can see your most relevant self-scores (top 3). Scores you've hidden are never shared.</div>
        </div>
        <button class="in-toggle ${shareScoresOn ? "on" : ""}" id="toggle-share-scores" role="switch" aria-checked="${shareScoresOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-toggle in-set-subtoggle" id="share-hidden-row" style="margin-top:12px;margin-left:22px;${shareScoresOn ? "" : "display:none"}">
        <div>
          <div class="in-set-toggle-label">Also include my hidden scores</div>
          <div class="in-set-toggle-sub">Off by default. When on, scores you've hidden from your profile are also shared with companies you apply to.</div>
        </div>
        <button class="in-toggle ${shareHiddenOn ? "on" : ""}" id="toggle-share-hidden" role="switch" aria-checked="${shareHiddenOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-msg" id="set-scores-msg"></div>
    </div>
    </div>`));

  const wireScoreToggle = (id, key, onSaved) => {
    const btn = $(id);
    if (!btn) return;
    btn.onclick = async () => {
      const turningOn = !btn.classList.contains("on");
      btn.disabled = true;
      const r = await api("/settings/set.php", "POST", { key, value: turningOn ? "1" : "0" });
      btn.disabled = false;
      const msg = $("set-scores-msg");
      if (r.ok && r.data?.success) {
        btn.classList.toggle("on", turningOn);
        btn.setAttribute("aria-checked", turningOn);
        if (onSaved) onSaved(turningOn);
        msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
      } else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
    };
  };
  wireScoreToggle("toggle-hide-scores",  "hide_all_scores");
  wireScoreToggle("toggle-share-scores", "share_scores_with_companies", (on) => {
    const sub = $("share-hidden-row");
    if (sub) sub.style.display = on ? "" : "none";
  });
  wireScoreToggle("toggle-share-hidden", "share_hidden_scores_with_companies");
}
// ---- Appearance tab: theme + reduced motion (both live) --------------
function renderSetAppearance(panel, st) {
  const theme = (st.theme === "dark" || st.theme === "light") ? st.theme : "system";
  const reduceOn = st.reduced_motion === "1";
  const opt = (val, label, sub) => `
    <button class="in-theme-opt ${theme === val ? "active" : ""}" data-theme-opt="${val}">
      <span class="in-theme-swatch tsw-${val}"></span>
      <span class="in-theme-opt-txt"><span class="in-theme-opt-label">${label}</span><span class="in-theme-opt-sub">${sub}</span></span>
    </button>`;
  panel.appendChild(el(`
    <div class="in-set-group">
    <div class="in-set-section">
      <h3>Theme</h3>
      <div class="in-set-toggle-sub" style="margin-bottom:12px">Choose how Integrally looks. “System” follows your device setting.</div>
      <div class="in-theme-opts">
        ${opt("light", "Light", "The classic bright look.")}
        ${opt("dark", "Dark", "Easier on the eyes at night.")}
        ${opt("system", "System", "Match my device.")}
      </div>
    </div>
    <div class="in-set-section">
      <h3>Motion</h3>
      <div class="in-set-toggle">
        <div>
          <div class="in-set-toggle-label">Reduce motion</div>
          <div class="in-set-toggle-sub">Minimise animations and transitions across the app.</div>
        </div>
        <button class="in-toggle ${reduceOn ? "on" : ""}" id="toggle-reduce-motion" role="switch" aria-checked="${reduceOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-msg" id="set-appearance-msg"></div>
    </div>
    </div>`));

  panel.querySelectorAll("[data-theme-opt]").forEach(btn => {
    btn.onclick = async () => {
      const val = btn.dataset.themeOpt;
      panel.querySelectorAll("[data-theme-opt]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyTheme(val);   // live, instant
      if (SETTINGS_DATA) SETTINGS_DATA.st.theme = val;
      const r = await api("/settings/set.php", "POST", { key:"theme", value: val });
      const msg = $("set-appearance-msg");
      if (r.ok && r.data?.success) { msg.className = "in-set-msg ok"; msg.textContent = "Saved."; }
      else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
    };
  });
  $("toggle-reduce-motion").onclick = async () => {
    const btn = $("toggle-reduce-motion");
    const turningOn = !btn.classList.contains("on");
    applyReducedMotion(turningOn);   // live
    btn.disabled = true;
    const r = await api("/settings/set.php", "POST", { key:"reduced_motion", value: turningOn ? "1" : "0" });
    btn.disabled = false;
    const msg = $("set-appearance-msg");
    if (r.ok && r.data?.success) {
      btn.classList.toggle("on", turningOn);
      btn.setAttribute("aria-checked", turningOn);
      if (SETTINGS_DATA) SETTINGS_DATA.st.reduced_motion = turningOn ? "1" : "0";
      msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
    } else {
      applyReducedMotion(!turningOn);   // revert on failure
      msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save.";
    }
  };
}

// ---- Connections tab: manage people you've blocked -------------------
async function renderSetConnections(panel) {
  panel.appendChild(el(`
    <div class="in-set-section">
      <h3>Blocked people</h3>
      <div class="in-set-toggle-sub" style="margin-bottom:12px">People you've blocked can't message you, and you can't message them. Unblocking is immediate.</div>
      <div id="blocked-list"><div class="in-loading" style="padding:14px 0">Loading…</div></div>
      <div class="in-set-msg" id="set-conn-msg"></div>
    </div>`));
  const listWrap = $("blocked-list");
  const res = await api("/blocks/list.php");
  const rows = res.data?.data || [];
  if (!res.ok || !res.data?.success) {
    listWrap.innerHTML = `<div class="in-empty">Couldn't load your blocked list.</div>`;
    return;
  }
  if (!rows.length) {
    listWrap.innerHTML = `<div class="in-empty" style="padding:10px 0">You haven't blocked anyone.</div>`;
    return;
  }
  listWrap.innerHTML = "";
  rows.forEach(u => {
    const initial = (u.name || u.username || "?").charAt(0).toUpperCase();
    const avatar = u.profile_pic
      ? `<img src="${esc(u.profile_pic)}" alt="" class="in-blk-avatar">`
      : `<span class="in-blk-avatar in-blk-avatar-fallback">${esc(initial)}</span>`;
    const rowEl = el(`
      <div class="in-blk-row">
        ${avatar}
        <div class="in-blk-meta">
          <div class="in-blk-name">${esc(u.name)}</div>
          <div class="in-blk-user">@${esc(u.username)}</div>
        </div>
        <button class="in-btn ghost in-blk-unblock" style="flex:none;padding:7px 14px">Unblock</button>
      </div>`);
    rowEl.querySelector(".in-blk-unblock").onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = "…";
      const r = await api("/blocks/unblock.php", "POST", { uuid: u.uuid });
      const msg = $("set-conn-msg");
      if (r.ok && r.data?.success) {
        rowEl.remove();
        msg.className = "in-set-msg ok"; msg.textContent = `Unblocked ${u.name}.`;
        if (!listWrap.querySelector(".in-blk-row")) {
          listWrap.innerHTML = `<div class="in-empty" style="padding:10px 0">You haven't blocked anyone.</div>`;
        }
      } else {
        btn.disabled = false; btn.textContent = "Unblock";
        msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not unblock.";
      }
    };
    listWrap.appendChild(rowEl);
  });
}

function renderSetNotifications(panel) {
  const st = (SETTINGS_DATA && SETTINGS_DATA.st) || {};
  renderNotificationPrefs(panel, {
    settings: st,
    save: (key, value) => api("/settings/set.php", "POST", { key, value }),
  });
}

// Shared notification-preferences UI for BOTH users and companies.
// opts = { settings: {key->value}, save: (key,value)=>Promise }
// In-app toggles are live; email toggles are shown but dormant ("soon").
function renderNotificationPrefs(panel, opts) {
  const st = opts.settings || {};
  const on = (k) => st["notify_" + k] !== "0";        // default ON
  const emailOn = (k) => st["email_" + k] === "1";     // default OFF (dormant)

  const liveTypes = [
    { key: "like",    label: "Likes",     sub: "When someone likes your post." },
    { key: "comment", label: "Comments",  sub: "When someone comments on your post." },
    { key: "follow",  label: "New followers", sub: "When someone starts following you." },
    { key: "message_request", label: "Message requests", sub: "When someone sends you a message request." },
  ];
  const futureTypes = [
    { key: "mention", label: "Mentions",       sub: "When someone mentions you. (Coming soon)" },
    { key: "score",   label: "Score updates",  sub: "Updates about your scores and rankings. (Coming soon)" },
  ];

  const row = (t, kind, checked, disabled) => `
    <div class="in-set-toggle${disabled ? " disabled" : ""}" style="margin-top:14px">
      <div>
        <div class="in-set-toggle-label">${esc(t.label)}</div>
        <div class="in-set-toggle-sub">${esc(t.sub)}</div>
      </div>
      <button class="in-toggle ${checked ? "on" : ""}" data-np="${kind}:${t.key}" role="switch" aria-checked="${checked}" ${disabled ? "disabled" : ""}><span class="in-toggle-knob"></span></button>
    </div>`;

  panel.appendChild(el(`
    <div class="in-set-group">
    <div class="in-set-section">
      <h3>In-app notifications</h3>
      <div class="in-set-toggle-sub" style="margin-bottom:4px">Control what shows up in your notification bell.</div>
      ${liveTypes.map(t => row(t, "app", on(t.key), false)).join("")}
      ${futureTypes.map(t => row(t, "app", true, true)).join("")}
    </div>
    <div class="in-set-section">
      <h3>Email notifications <span class="in-soon-pill">Coming soon</span></h3>
      <div class="in-set-toggle-sub" style="margin-bottom:4px">Email delivery isn't live yet — set your preferences now and they'll apply once it launches.</div>
      ${liveTypes.map(t => row(t, "email", emailOn(t.key), false)).join("")}
    </div>
    <div class="in-set-msg" id="set-notif-msg"></div>
    </div>`));

  panel.querySelectorAll("[data-np]").forEach(btn => {
    if (btn.disabled) return;
    btn.onclick = async () => {
      const [kind, type] = btn.dataset.np.split(":");
      const key = (kind === "email" ? "email_" : "notify_") + type;
      const turningOn = !btn.classList.contains("on");
      btn.disabled = true;
      const r = await opts.save(key, turningOn ? "1" : "0");
      btn.disabled = false;
      const msg = $("set-notif-msg");
      if (r.ok && r.data?.success) {
        btn.classList.toggle("on", turningOn);
        btn.setAttribute("aria-checked", turningOn);
        st[key] = turningOn ? "1" : "0";
        msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
      } else {
        msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save.";
      }
    };
  });
}

// ---- Admin tab: links toward admin tools (admins only) ---------------
function renderSetAdmin(panel) {
  panel.appendChild(el(`
    <div class="in-set-section">
      <h3>Admin</h3>
      <div class="in-set-placeholder">You have admin access. Manage users, roles, and view platform stats from the <a href="#admin" style="color:var(--in-accent);font-weight:600">Admin dashboard</a>.</div>
    </div>`));
}

// ---- Danger Zone: destructive actions (placeholders) -----------------
function renderSetDanger(panel) {
  panel.appendChild(el(`
    <div class="in-set-section change-account">
      <h3>Change account</h3>
      <div class="in-danger-row">
        <div>
          <div class="in-set-toggle-label">Sign out</div>
          <div class="in-set-toggle-sub">Sign out of your account on this device.</div>
        </div>
        <button class="in-btn ghost" style="flex:none;padding:9px 18px" id="danger-signout">Sign out</button>
      </div>
      <div class="in-danger-row">
        <div>
          <div class="in-set-toggle-label">Delete account</div>
          <div class="in-set-toggle-sub">Permanently delete your account and all data. This can't be undone.</div>
        </div>
        <button class="in-btn" style="flex:none;padding:9px 18px;background:#fdecea;color:var(--in-error);border:1px solid #f5c6c0;opacity:.7;cursor:not-allowed" disabled title="Coming soon">Delete account</button>
      </div>
    </div>`));
  $("danger-signout").onclick = async () => {
    await api("/auth/logout.php", "POST");
    location.hash = ""; location.reload();
  };
}

// ===================================================================
// VIEW: SCORE BREAKDOWN (full per-score detail — placeholder)
// ===================================================================
async function renderScoreBreakdown(scoreId) {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading breakdown…</div>`;
  const res = await api("/score/history.php");
  const all = res.data?.data || [];
  const s = all.find(x => String(x.id) === String(scoreId));
  if (!s) {
    view.innerHTML = `<div class="in-card2"><div class="in-empty" style="text-align:center">Score not found.</div><div style="text-align:center;margin-top:14px"><button class="in-btn ghost" style="flex:none;padding:9px 18px" onclick="location.hash='profile'">← Back to profile</button></div></div>`;
    return;
  }
  const val = Math.max(0, Math.min(100, Math.round(s.score_value)));
  const date = new Date(s.created_at).toLocaleString();
  let factors = "";
  if (Array.isArray(s.breakdown) && s.breakdown.length) {
    factors = s.breakdown.map(f => `<div class="bd-factor"><div class="bd-factor-head"><span class="bd-factor-name">${esc(f.factor ? f.factor.replace(/_/g," ") : "factor")}</span>${f.points != null ? `<span class="bd-factor-points">+${esc(f.points)}</span>` : ""}</div><div class="bd-factor-detail">${esc(f.detail || "")}</div></div>`).join("");
  } else {
    factors = `<div class="in-empty">No factor detail stored for this score.</div>`;
  }
  view.innerHTML = "";
  view.appendChild(el(`
    <div style="max-width:680px;margin:0 auto">
      <div class="in-back"><button class="in-back-btn" onclick="location.hash='profile'">← Back to profile</button></div>
      <div class="in-card2 bd-hero">
        <div class="in-score-badge" style="width:64px;height:64px;font-size:24px;border-radius:14px">${val}</div>
        <div><div class="bd-target">${esc(s.target_value)}</div><div class="bd-sub">${esc(s.target_type.replace("_"," "))} · scored ${esc(date)}</div></div>
      </div>
      <div class="in-card2 bd-hero-bar">
        <div class="score-bar" style="margin:0"><div class="score-bar-track"></div><div class="score-bar-marker" style="left:${val}%"><div class="score-bar-arrow"></div></div></div>
        <div class="bd-scale"><span>0</span><span>50</span><span>100</span></div>
        <div class="bd-compare-slot" style="margin-top:14px"></div>
      </div>
      <div class="in-card2">
        <h2>How this score was calculated</h2>
        <div class="bd-placeholder-note">ⓘ This is a placeholder breakdown. The full scoring algorithm is still in development — this page will eventually explain in detail how each part of your profile contributes to your score for “${esc(s.target_value)}.”</div>
        <div class="bd-factors">${factors}</div>
        <div class="bd-algo">Algorithm version: ${esc(s.algo_version || "n/a")}</div>
        <div class="bd-actions">
          <button class="in-btn ghost" id="bd-history" style="flex:none;padding:9px 18px">View score history →</button>
          <button class="in-btn danger-ghost" id="bd-delete" style="flex:none;padding:9px 18px">Remove this score</button>
        </div>
      </div>
    </div>`));
  // This breakdown page is the viewer's own score (history.php is
  // self-scoped when no uuid is passed), so it's safe to compare.
  loadScoreComparison(s, view.querySelector(".bd-compare-slot"), s.id);

  $("bd-history").onclick = () => {
    location.hash = "score-history/" + encodeURIComponent(s.target_type + "|" + s.target_value);
  };

  const del = $("bd-delete");
  if (del) {
    del.onclick = () => {
      openScoreRemoveDialog(s, s.target_type.replace("_", " "), () => { location.hash = "profile"; });
    };
  }
}

// ===================================================================
// VIEW: SCORE HISTORY (progress over time for ONE target)
// Hash: #score-history/<encoded "type|value">
// ===================================================================
async function renderScoreHistory(encoded) {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading score history…</div>`;

  // Decode the "type|value" segment. Split on the FIRST pipe only, since
  // a target_value could (in theory) contain a pipe of its own.
  let decoded = "";
  try { decoded = decodeURIComponent(encoded || ""); } catch { decoded = ""; }
  const sep = decoded.indexOf("|");
  const targetType  = sep >= 0 ? decoded.slice(0, sep) : "";
  const targetValue = sep >= 0 ? decoded.slice(sep + 1) : "";

  if (!targetType || !targetValue) {
    view.innerHTML = `<div class="in-card2"><div class="in-empty" style="text-align:center">Couldn't read that score target.</div><div style="text-align:center;margin-top:14px"><button class="in-btn ghost" style="flex:none;padding:9px 18px" onclick="location.hash='profile'">← Back to profile</button></div></div>`;
    return;
  }

  const params = new URLSearchParams({ target_type: targetType, target_value: targetValue });
  const res = await api("/score/history.php?" + params.toString());
  // history.php returns newest-first; we want oldest-first for the chart.
  const rows = (res.data?.data || []).slice().reverse();

  const typeLabel = esc(targetType.replace("_", " "));
  const back = `<div class="in-back"><button class="in-back-btn" onclick="location.hash='profile'">← Back to profile</button></div>`;

  if (!rows.length) {
    view.innerHTML = "";
    view.appendChild(el(`<div style="max-width:720px;margin:0 auto">${back}
      <div class="in-card2"><div class="in-empty" style="text-align:center">No score history yet for “${esc(targetValue)}”.</div></div></div>`));
    return;
  }

  const values = rows.map(r => Math.max(0, Math.min(100, r.score_value)));
  const latest = values[values.length - 1];
  const first  = values[0];
  const best    = Math.max(...values);
  const delta   = Math.round(latest - first);
  const deltaTxt = rows.length < 2 ? "—"
    : (delta > 0 ? `+${delta}` : String(delta));
  const deltaCls = delta > 0 ? "up" : (delta < 0 ? "down" : "flat");

  view.innerHTML = "";
  view.appendChild(el(`
    <div style="max-width:720px;margin:0 auto">
      ${back}
      <div class="in-card2 sh-hero">
        <div class="sh-eyebrow">${typeLabel} · score history</div>
        <div class="sh-title">${esc(targetValue)}</div>
        <div class="sh-stats">
          <div class="sh-stat"><div class="sh-stat-v">${Math.round(latest)}</div><div class="sh-stat-l">Latest</div></div>
          <div class="sh-stat"><div class="sh-stat-v">${Math.round(best)}</div><div class="sh-stat-l">Best</div></div>
          <div class="sh-stat"><div class="sh-stat-v ${deltaCls}">${deltaTxt}</div><div class="sh-stat-l">Change</div></div>
          <div class="sh-stat"><div class="sh-stat-v">${rows.length}</div><div class="sh-stat-l">Scores</div></div>
        </div>
      </div>
      <div class="in-card2">
        <h2>Progress over time</h2>
        <div class="sh-chart-wrap">${scoreHistoryChart(rows)}</div>
      </div>
      <div class="in-card2">
        <h2>All scores</h2>
        <div class="sh-list">
          ${rows.slice().reverse().map(r => {
            const v = Math.round(Math.max(0, Math.min(100, r.score_value)));
            const d = new Date(r.created_at).toLocaleString();
            return `<div class="sh-row" data-id="${r.id}">
              <div class="sh-row-badge">${v}</div>
              <div class="sh-row-meta"><div class="sh-row-date">${esc(d)}</div><div class="sh-row-algo">${esc(r.algo_version || "n/a")}</div></div>
              <button class="in-btn ghost sh-row-view" style="flex:none;padding:6px 12px">Breakdown →</button>
            </div>`;
          }).join("")}
        </div>
      </div>
    </div>`));

  view.querySelectorAll(".sh-row-view").forEach(btn => {
    btn.onclick = () => { location.hash = "score/" + btn.closest(".sh-row").dataset.id; };
  });

  // ---- Interactive chart points: hover highlight + tooltip, click → breakdown.
  const svg = view.querySelector(".sh-chart");
  if (svg) {
    const tip   = svg.querySelector(".sh-tip");
    const tipBg = svg.querySelector(".sh-tip-bg");
    const tipTx = svg.querySelector(".sh-tip-tx");

    const showTip = (g) => {
      const cx = parseFloat(g.dataset.cx), cy = parseFloat(g.dataset.cy);
      tipTx.textContent = g.dataset.label;
      tip.style.display = "";
      // Size the background to the text, then position above the point,
      // clamped to stay inside the 0–680 viewBox width.
      const pad = 7, box = tipTx.getBBox();
      const w = box.width + pad * 2, h = box.height + pad * 1.4;
      let x = cx - w / 2;
      x = Math.max(2, Math.min(x, 680 - w - 2));
      const y = Math.max(2, cy - h - 10);
      tipBg.setAttribute("x", x.toFixed(1));
      tipBg.setAttribute("y", y.toFixed(1));
      tipBg.setAttribute("width", w.toFixed(1));
      tipBg.setAttribute("height", h.toFixed(1));
      tipTx.setAttribute("x", (x + w / 2).toFixed(1));
      tipTx.setAttribute("y", (y + h / 2 + box.height / 2 - 1).toFixed(1));
    };
    const hideTip = () => { tip.style.display = "none"; };

    svg.querySelectorAll(".sh-point").forEach(g => {
      const go = () => { location.hash = "score/" + g.dataset.id; };
      g.addEventListener("mouseenter", () => { g.classList.add("active"); showTip(g); });
      g.addEventListener("mouseleave", () => { g.classList.remove("active"); hideTip(); });
      g.addEventListener("focus", () => { g.classList.add("active"); showTip(g); });
      g.addEventListener("blur", () => { g.classList.remove("active"); hideTip(); });
      g.addEventListener("click", go);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
}

// Build an inline SVG line chart from history rows (oldest-first).
// No charting library — plain SVG to match the vanilla-JS codebase.
function scoreHistoryChart(rows) {
  const W = 680, H = 240;
  const padL = 34, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = rows.length;

  const yFor = v => padT + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;
  const xFor = i => n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW;

  // Horizontal gridlines + y labels at 0/25/50/75/100.
  let grid = "";
  [0, 25, 50, 75, 100].forEach(g => {
    const y = yFor(g);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="sh-grid"/>`;
    grid += `<text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" class="sh-axis" text-anchor="end">${g}</text>`;
  });

  const pts = rows.map((r, i) => [xFor(i), yFor(r.score_value)]);
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  // Area under the line for a subtle fill.
  const areaPath = n > 1
    ? `${linePath} L${pts[n - 1][0].toFixed(1)},${(padT + plotH).toFixed(1)} L${pts[0][0].toFixed(1)},${(padT + plotH).toFixed(1)} Z`
    : "";

  const dots = pts.map((p, i) => {
    const r = rows[i];
    const v = Math.round(Math.max(0, Math.min(100, r.score_value)));
    const cx = p[0].toFixed(1), cy = p[1].toFixed(1);
    const label = `${v} · ${new Date(r.created_at).toLocaleDateString()}`;
    // A large transparent hit-circle makes the point easy to click/hover;
    // the visible dot sits on top. Both share the sh-point group so CSS
    // can highlight the visible dot when the group is hovered.
    return `<g class="sh-point" data-id="${r.id}" data-label="${esc(label)}" data-cx="${cx}" data-cy="${cy}" tabindex="0" role="button" aria-label="${esc(label)}, view breakdown">
      <circle cx="${cx}" cy="${cy}" r="14" class="sh-hit"/>
      <circle cx="${cx}" cy="${cy}" r="4" class="sh-dot"/>
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="sh-chart" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Score progression chart">
    ${grid}
    ${areaPath ? `<path d="${areaPath}" class="sh-area"/>` : ""}
    ${n > 1 ? `<path d="${linePath}" class="sh-line"/>` : ""}
    ${dots}
    <g class="sh-tip" style="display:none"><rect class="sh-tip-bg" rx="6"/><text class="sh-tip-tx"></text></g>
  </svg>`;
}
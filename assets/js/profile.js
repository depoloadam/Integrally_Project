// =====================================================================
// profile.js — profile view, public profile, score breakdown, and all
//   profile-related modals (edit, add records, bulk onboarding menus).
//   Depends on shell.js globals: api, $, el, esc, ME, openModal, etc.
// =====================================================================

// ===================================================================
// VIEW: PROFILE (own, editable)
// ===================================================================
async function renderProfile() {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading your profile…</div>`;

  const [prof, jobs, edu, certs, skills, interests, scores, settings] = await Promise.all([
    api("/profile/get.php"),
    api("/profile/jobs/list.php"),
    api("/profile/education/list.php"),
    api("/profile/certs/list.php"),
    api("/profile/skills/list.php"),
    api("/profile/interests/list.php"),
    api("/score/latest.php"),
    api("/settings/get.php"),
  ]);

  const p = prof.data?.data || {};
  const attrs = p.attributes || {};
  const headline = attrs.headline?.value || "";
  const initial = (p.username || "?").charAt(0).toUpperCase();
  const loc = [p.city, p.state, p.country].filter(Boolean).join(", ");

  view.innerHTML = "";

  // ---- onboarding progress box ----
  const st = settings.data?.data || {};
  const hasJobs   = (jobs.data?.data?.length || 0) > 0;
  const skillCount = (skills.data?.data?.length || 0);
  const hasExtras = (interests.data?.data?.length || 0) > 0
                 || (certs.data?.data?.length || 0) > 0
                 || (edu.data?.data?.length || 0) > 0;

  const steps = [
    { key:"email",      label:"Verify your email",                          done: st.email_verified === "1", action:null },
    { key:"experience", label:"Add your work experience",                   done: hasJobs || st.step_experience_done === "1", action: () => openBulkExperience() },
    { key:"skills",     label:"Add at least 3 skills",                       done: skillCount >= 3 || st.step_skills_done === "1", action: () => openBulkSkills() },
    { key:"extras",     label:"Add interests, certifications & education",   done: hasExtras || st.step_extras_done === "1", action: () => openExtrasFlow() },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const allDone = doneCount === steps.length;

  if (allDone && st.onboarding_complete !== "1") {
    await api("/settings/set.php", "POST", { key:"onboarding_complete", value:"1" });
  }

  if (!allDone) {
    const box = el(`
      <div class="in-onboard">
        <div class="in-onboard-head">
          <div>
            <div class="in-onboard-title">Finish setting up your profile</div>
            <div class="in-onboard-sub">Complete setup to unlock scoring and get the most from Integrally.</div>
          </div>
          <div class="in-onboard-pct">${pct}%</div>
        </div>
        <div class="in-onboard-bar"><div class="in-onboard-fill" style="width:${pct}%"></div></div>
        <div class="in-onboard-steps"></div>
      </div>`);
    view.appendChild(box);
    const stepsWrap = box.querySelector(".in-onboard-steps");
    steps.filter(s => !s.done).forEach(s => {
      const row = el(`
        <div class="in-onboard-step">
          <span class="in-onboard-label">${esc(s.label)}</span>
          ${s.action ? `<button class="in-onboard-go">Start →</button>` : ""}
        </div>`);
      if (s.action) row.querySelector(".in-onboard-go").onclick = s.action;
      stepsWrap.appendChild(row);
    });
  }

  // ---- recommendation box (post-onboarding, discreet) ----
  if (allDone && st.rec_box_hidden !== "1") {
    const recs = [];
    if (!p.profile_pic) {
      recs.push({ label:"Add a profile picture", action: () => editCore(p, headline, attrs) });
    }
    if (recs.length) {
      const recBox = el(`
        <div class="in-recbox">
          <div class="in-rec-head"><span class="in-rec-title">A few optional touches</span><button class="in-rec-hide" title="Hide">✕</button></div>
          <div class="in-rec-items"></div>
        </div>`);
      view.appendChild(recBox);
      const items = recBox.querySelector(".in-rec-items");
      recs.forEach(r => {
        const row = el(`<div class="in-rec-item"><span>${esc(r.label)}</span><button class="in-rec-go">Add</button></div>`);
        row.querySelector(".in-rec-go").onclick = r.action;
        items.appendChild(row);
      });
      recBox.querySelector(".in-rec-hide").onclick = async () => {
        recBox.remove();
        await api("/settings/set.php", "POST", { key:"rec_box_hidden", value:"1" });
      };
    }
  }

  // ---- two-column layout: sticky profile box (left) + sections (right) ----
  const grid = el(`<div class="in-profile-grid"></div>`);
  view.appendChild(grid);
  const leftCol  = el(`<div class="in-col-left"></div>`);
  const rightCol = el(`<div class="in-col-right"></div>`);
  grid.appendChild(leftCol);
  grid.appendChild(rightCol);

  // header (left column, sticky) with options menu
  leftCol.appendChild(el(`
    <div class="in-phead">
      <button class="in-phead-menu" id="phead-menu-btn" title="Options">👤</button>
      <div class="in-phead-dropdown" id="phead-dropdown">
        <button data-pmenu="edit">Edit profile</button>
      </div>
      <div class="in-avatar">${p.profile_pic ? `<img src="${esc(p.profile_pic)}" alt="">` : esc(initial)}</div>
      <div class="in-phead-info">
        <h1>@${esc(p.username || "")}</h1>
        <div class="loc">${esc(loc || "No location set")}</div>
        ${headline ? `<div class="headline">${esc(headline)}</div>` : ""}
      </div>
      ${socialLinksHtml(attrs)}
    </div>`));
  const pheadBtn = $("phead-menu-btn");
  const pheadDrop = $("phead-dropdown");
  pheadBtn.onclick = (e) => { e.stopPropagation(); pheadDrop.classList.toggle("show"); };
  document.addEventListener("click", () => pheadDrop.classList.remove("show"));
  pheadDrop.querySelector('[data-pmenu="edit"]').onclick = (e) => {
    e.stopPropagation(); pheadDrop.classList.remove("show"); editCore(p, headline, attrs);
  };

  // bio — distinct shape from the standard section cards, sits at the
  // very top of the right column, above scores.
  rightCol.appendChild(renderBioBox(attrs, true));

  // scores panel
  const onboardingDone = (st.onboarding_complete === "1");
  const scoreRows = (scores.data?.data || []);
  const scoreCard = el(`<div class="in-card2"><h2>Scores</h2><div id="score-body"></div></div>`);
  rightCol.appendChild(scoreCard);
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
  }, "jobs", addJob, j => j.id);

  section(rightCol, "Education", edu.data?.data, e => `
    <div class="meta"><div class="t">${esc(e.degree || e.institution)}</div>
    <div class="s">${esc([e.institution, e.field].filter(Boolean).join(" · "))}${e.end_year ? " · " + e.end_year : ""}</div></div>`,
    "education", addEdu, e => e.id);

  section(rightCol, "Certifications", certs.data?.data, c => `
    <div class="meta"><div class="t">${esc(c.name)}</div>
    <div class="s">${esc(c.issuer || "")}${c.issue_date ? " · " + c.issue_date : ""}</div></div>`,
    "certs", addCert, c => c.id);

  chipSection(rightCol, "Skills", skills.data?.data, s => `
    ${esc(s.name)} ${s.proficiency ? `<span class="lvl">L${s.proficiency}</span>` : ""}`,
    addSkill, s => ({ id:s.id, kind:"skill" }), "skill");

  chipSection(rightCol, "Interests", interests.data?.data, i => esc(i.name),
    addInterest, i => ({ id:i.id, kind:"interest" }), "interest");

  renderPersonalFeed(rightCol, p.uuid);
}

// ---- personal feed (own posts at bottom of profile) ------------------
async function renderPersonalFeed(col, uuid) {
  const card = el(`<div class="in-card2"><h2>Activity</h2><div class="body"><div class="in-empty">Loading…</div></div></div>`);
  col.appendChild(card);
  const body = card.querySelector(".body");
  const res = await api("/posts/personal.php?type=user&uuid=" + encodeURIComponent(uuid));
  const posts = res.data?.data?.posts || [];
  const author = res.data?.data?.author || {};
  body.innerHTML = "";
  if (!posts.length) { body.appendChild(el(`<div class="in-empty">No posts yet. Updates you share will appear here.</div>`)); return; }
  const list = el(`<div class="in-post-list" style="border:none;padding:0"></div>`);
  posts.forEach(po => list.appendChild(renderPost({
    post_id:po.id, post_type:po.post_type, body:po.body, media_url:po.media_url, meta:po.meta,
    created_at:po.created_at, reason:"self",
    author:{ type:"user", uuid:author.uuid, name:author.name, avatar:author.avatar },
  })));
  body.appendChild(list);
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
        <div class="score-mini">${miniRows}</div>
        <button class="in-btn ghost score-fullbtn" style="flex:none;padding:8px 14px">View full breakdown →</button>
      </div>
    </div>`);
  const detail = row.querySelector(".score-detail");
  const caret = row.querySelector(".score-expand");
  caret.onclick = () => { const open = detail.style.display !== "none"; detail.style.display = open ? "none" : "block"; caret.textContent = open ? "▾" : "▴"; };
  row.querySelector(".score-fullbtn").onclick = () => { location.hash = "score/" + s.id; };
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
        alert(r.data?.error || "Could not update visibility.");
      }
    };
  }
  return row;
}

// ---- social link buttons (LinkedIn / X / website) ---------------------
// Renders a row of buttons, one per attribute that actually has a value.
// Returns "" (nothing) if none are set, so it never leaves an empty gap.
// Renders a stacked list of buttons, one per attribute that actually has
// a value. Each row is [logo placeholder] + [site name]. Returns ""
// (nothing) if none are set, so it never leaves an empty gap.
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
        <a class="in-social-btn ${l.cls}" href="${esc(normalize(l.url))}" target="_blank" rel="noopener noreferrer nofollow">
          <span class="in-social-logo" aria-hidden="true"></span>
          <span class="in-social-name">${esc(l.label)}</span>
        </a>`).join("")}
    </div>`;
}

// ---- bio box (distinct shape, sits above scores) -----------------------
// `isOwner` controls whether an inline "Edit bio" affordance is shown.
function renderBioBox(attrs, isOwner) {
  const bio = (attrs.bio?.value || "").trim();
  if (!bio && !isOwner) return el(`<div style="display:none"></div>`); // nothing to show a visitor
  const box = el(`
    <div class="in-bio-box">
      ${bio
        ? `<div class="in-bio-text">${esc(bio)}</div>`
        : `<div class="in-bio-empty">Add a short bio to tell people about yourself.</div>`}
      ${isOwner ? `<button class="in-bio-edit" title="Edit bio">${bio ? "Edit" : "Add bio"}</button>` : ""}
    </div>`);
  if (isOwner) {
    box.querySelector(".in-bio-edit").onclick = () => editBio(bio);
  }
  return box;
}

// ---- edit bio modal -----------------------------------------------------
function editBio(currentBio) {
  openModal(`
    <h3>Bio</h3>
    <label>Tell people about yourself</label>
    <textarea id="bio-input" rows="6" maxlength="1000" placeholder="A sentence or two about your background, what you're working on, or what you're looking for…">${esc(currentBio || "")}</textarea>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="bio-save">Save</button>
    </div>`);
  $("bio-save").onclick = async () => {
    const value = $("bio-input").value.trim();
    const r = await api("/profile/set-attribute.php", "POST", { key: "bio", value });
    if (r.ok && r.data?.success) { closeModal(); renderProfile(); }
    else { alert(r.data?.error || "Could not save bio."); }
  };
}

// ---- list + chip section renderers -----------------------------------
function section(view, title, items, rowHtml, kind, onAdd, idOf) {
  const card = el(`<div class="in-card2"><h2>${title}<button class="add" title="Add">+</button></h2><div class="body"></div></div>`);
  view.appendChild(card);
  card.querySelector(".add").onclick = onAdd;
  const body = card.querySelector(".body");
  if (!items || !items.length) { body.appendChild(el(`<div class="in-empty">Nothing added yet.</div>`)); return; }
  items.forEach(it => {
    const row = el(`<div class="in-item">${rowHtml(it)}<button class="del">Remove</button></div>`);
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
  if (kind === "skill") {
    const res = await api("/profile/skills/list.php");
    fillChips(body, res.data?.data, s => `${esc(s.name)} ${s.proficiency ? `<span class="lvl">L${s.proficiency}</span>` : ""}`, s => ({ id:s.id, kind:"skill" }));
  } else {
    const res = await api("/profile/interests/list.php");
    fillChips(body, res.data?.data, i => esc(i.name), i => ({ id:i.id, kind:"interest" }));
  }
}

// ---- admin: edit another user's core profile -------------------------
function adminEditProfile(p, headline, uuid) {
  openModal(`
    <h3>Edit profile <span style="font-size:12px;color:var(--in-muted);font-weight:600">(admin)</span></h3>
    <p style="color:var(--in-muted);font-size:13px;margin:0 0 8px">Editing @${esc(p.username||"")}'s profile.</p>
    <label>Username</label><input id="af-username" value="${esc(p.username||"")}">
    <div class="row">
      <div><label>City</label><input id="af-city" value="${esc(p.city||"")}"></div>
      <div><label>State</label><input id="af-state" value="${esc(p.state||"")}"></div>
    </div>
    <label>Country</label><input id="af-country" value="${esc(p.country||"")}">
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="af-save">Save</button>
    </div>`);
  $("af-save").onclick = async () => {
    const r = await api("/profile/update.php", "POST", {
      target_uuid: uuid,
      username: $("af-username").value.trim(),
      city: $("af-city").value.trim(),
      state: $("af-state").value.trim(),
      country: $("af-country").value.trim(),
    });
    if (r.ok && r.data?.success) { closeModal(); renderPublicProfile(uuid); }
    else { alert(r.data?.error || "Could not update profile."); }
  };
}

// ---- edit core (own profile) -----------------------------------------
function editCore(p, headline, attrs) {
  attrs = attrs || {};
  const avatarState = { avatarUrl: p.profile_pic || null };
  const linkedin = attrs.linkedin_url?.value || "";
  const twitter  = attrs.twitter_url?.value || "";
  const website  = attrs.website_url?.value || "";
  const websiteLabel = attrs.website_label?.value || "";
  openModal(`
    <h3>Edit profile</h3>
    <div id="f-avatar"></div>
    <label>Username</label><input id="f-username" value="${esc(p.username||"")}">
    <label>Headline</label><input id="f-headline" value="${esc(headline)}" placeholder="e.g. IT Automation Specialist">
    <div class="row">
      <div><label>City</label><input id="f-city" value="${esc(p.city||"")}"></div>
      <div><label>State</label><input id="f-state" value="${esc(p.state||"")}"></div>
    </div>
    <label>Country</label><input id="f-country" value="${esc(p.country||"")}">
    <label>LinkedIn URL</label><input id="f-linkedin" value="${esc(linkedin)}" placeholder="linkedin.com/in/yourname">
    <label>Twitter / X URL</label><input id="f-twitter" value="${esc(twitter)}" placeholder="x.com/yourname">
    <label>Personal website</label><input id="f-website" value="${esc(website)}" placeholder="yourdomain.com">
    <div class="row">
      <div><label>Website display name</label><input id="f-website-label" value="${esc(websiteLabel)}" placeholder="e.g. My Portfolio"></div>
    </div>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="save-core">Save</button>
    </div>`);
  mountAvatarPicker("f-avatar", avatarState, { shape: "circle", fallbackChar: p.username || "?" });
  $("save-core").onclick = async () => {
    const r = await api("/profile/update.php", "POST", {
      username:$("f-username").value.trim(), city:$("f-city").value.trim(),
      state:$("f-state").value.trim(), country:$("f-country").value.trim(),
      profile_pic: avatarState.avatarUrl || "",
    });
    await api("/profile/set-attribute.php", "POST", { key:"headline", value:$("f-headline").value.trim() });
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
    closeModal(); renderProfile();
  };
}

function addJob() {
  openModal(`
    <h3>Add experience</h3>
    <label>Title *</label><input id="j-title">
    <label>Company</label>
    <div class="emp-search">
      <input id="j-company" autocomplete="off" placeholder="Type to search company accounts…">
      <div class="emp-results" id="j-company-results"></div>
      <div class="emp-linked" id="j-company-linked" style="display:none"></div>
    </div>
    <div class="row"><div><label>Start date</label><input id="j-start" type="date"></div><div><label>End date</label><input id="j-end" type="date"></div></div>
    <label class="jf-checkrow" style="margin-top:4px">
      <input type="checkbox" id="j-current"> I currently work here
    </label>
    <label>Description</label><textarea id="j-desc" rows="3"></textarea>
    <div class="in-modal-actions">
      <button class="in-btn ghost" id="j-none">No job history</button>
      <button class="in-btn primary" id="save-job">Add</button>
    </div>`);

  // Live employer search: as the user types, look up company accounts that
  // allow being listed. Selecting one links it (stores company_uuid).
  let linkedCompany = null;   // { uuid, name } when a company account is chosen
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
    cResults.innerHTML = list.map(c =>
      `<button type="button" class="emp-result" data-uuid="${esc(c.uuid)}" data-name="${esc(c.name)}">
        <span class="emp-result-logo">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : esc((c.name||"?").charAt(0).toUpperCase())}</span>
        <span><span class="emp-result-name">${esc(c.name)}</span>${c.industry ? `<span class="emp-result-ind">${esc(c.industry)}</span>` : ""}</span>
      </button>`).join("");
    cResults.style.display = "block";
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

  $("j-none").onclick = async () => { await api("/settings/set.php","POST",{key:"step_experience_done",value:"1"}); closeModal(); renderProfile(); };
  $("save-job").onclick = async () => {
    const title = $("j-title").value.trim(); if (!title) return;
    const company = $("j-company").value.trim();
    await api("/profile/jobs/add.php","POST",{
      title, company_name:company,
      company_uuid: linkedCompany ? linkedCompany.uuid : null,
      start_date:$("j-start").value,
      end_date: currentCb.checked ? "" : $("j-end").value,   // current job -> no end date
      description:$("j-desc").value.trim()
    });
    closeModal(); offerShare(`💼 Excited to share a new role: ${title}${company ? " at " + company : ""}!`); renderProfile();
  };
}

function addEdu() {
  openModal(`
    <h3>Add education</h3>
    <label>Institution</label><input id="e-inst">
    <label>Degree</label><input id="e-deg">
    <label>Field</label><input id="e-field">
    <div class="row"><div><label>Start year</label><input id="e-start" type="number"></div><div><label>End year</label><input id="e-end" type="number"></div></div>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="save-edu">Add</button></div>`);
  $("save-edu").onclick = async () => {
    await api("/profile/education/add.php","POST",{ institution:$("e-inst").value.trim(), degree:$("e-deg").value.trim(), field:$("e-field").value.trim(), start_year:$("e-start").value, end_year:$("e-end").value });
    closeModal(); renderProfile();
  };
}

function addCert() {
  openModal(`
    <h3>Add certification</h3>
    <label>Name *</label><input id="c-name">
    <label>Issuer</label><input id="c-issuer">
    <div class="row"><div><label>Issued</label><input id="c-issue" type="date"></div><div><label>Expires</label><input id="c-exp" type="date"></div></div>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="save-cert">Add</button></div>`);
  $("save-cert").onclick = async () => {
    const name = $("c-name").value.trim(); if (!name) return;
    const issuer = $("c-issuer").value.trim();
    await api("/profile/certs/add.php","POST",{ name, issuer, issue_date:$("c-issue").value, expiry_date:$("c-exp").value });
    closeModal(); offerShareCert(name, issuer); renderProfile();
  };
}

function addSkill() {
  openModal(`
    <h3>Add skill</h3>
    <label>Skill name *</label><input id="s-name" placeholder="e.g. PowerShell">
    <label>Proficiency (1–5, optional)</label><input id="s-prof" type="number" min="1" max="5">
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="save-skill">Add</button></div>`);
  $("save-skill").onclick = async () => {
    const name = $("s-name").value.trim(); if (!name) return;
    await api("/profile/skills/add.php","POST",{ name, proficiency:$("s-prof").value });
    closeModal(); refreshChipSection("skill");
  };
}

function addInterest() {
  openModal(`
    <h3>Add interest</h3>
    <label>Interest *</label><input id="i-name" placeholder="e.g. Cloud Architecture">
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="save-int">Add</button></div>`);
  $("save-int").onclick = async () => {
    const name = $("i-name").value.trim(); if (!name) return;
    await api("/profile/interests/add.php","POST",{ name });
    closeModal(); refreshChipSection("interest");
  };
}

function scoreMe() {
  openModal(`
    <h3>Score Me!</h3>
    <label>Score against</label>
    <select id="sm-type"><option value="job_title">Job title</option><option value="skill">Skill</option><option value="field">Field</option></select>
    <label>Target</label><input id="sm-value" placeholder="e.g. Automation Engineer">
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="run-score">Score</button></div>`);
  $("run-score").onclick = async () => {
    const target_value = $("sm-value").value.trim(); if (!target_value) return;
    const btn = $("run-score"); btn.disabled = true; btn.textContent = "Scoring…";
    const r = await api("/score/score-me.php","POST",{ target_type:$("sm-type").value, target_value });
    if (r.ok && r.data?.success) { closeModal(); renderProfile(); }
    else { btn.disabled = false; btn.textContent = "Score"; alert(r.data?.error || "Could not score right now."); }
  };
}

// ---- removals --------------------------------------------------------
const RECORD_ENDPOINTS = { jobs:"/profile/jobs/delete.php", education:"/profile/education/delete.php", certs:"/profile/certs/delete.php" };
async function removeRecord(kind, id) {
  if (!confirm("Remove this entry?")) return;
  await api(RECORD_ENDPOINTS[kind], "POST", { id });
  renderProfile();
}
async function removeChip(ref) {
  if (ref.kind === "skill") await api("/profile/skills/remove.php","POST",{ skill_id:ref.id });
  else await api("/profile/interests/remove.php","POST",{ interest_id:ref.id });
  refreshChipSection(ref.kind);
}

// ---- share-to-feed prompts -------------------------------------------
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
function offerShareCert(name, issuer) {
  openModal(`
    <h3>Share to your feed?</h3>
    <div class="post-cert" style="margin-bottom:14px">
      <div class="cert-icon">🎓</div>
      <div><div class="cert-label">Earned a certification</div><div class="cert-name">${esc(name)}</div>${issuer ? `<div class="cert-issuer">${esc(issuer)}</div>` : ""}</div>
    </div>
    <label>Add a note (optional)</label><textarea id="share-note" rows="2" placeholder="Say something about it…"></textarea>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Skip</button><button class="in-btn primary" id="share-cert-go">Post to feed</button></div>`);
  $("share-cert-go").onclick = async () => {
    await api("/posts/create.php","POST",{ post_type:"cert", body:$("share-note").value.trim(), meta:{ name, issuer }, visibility:"public" });
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
    <label class="bulk-none"><input type="checkbox" id="bulk-job-none"> I have no work experience to add</label>
    <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Cancel</button><button class="in-btn primary" id="bulk-job-save">Save &amp; complete</button></div>`);
  const wrap = $("bulk-jobs");
  const addRow = () => {
    const row = el(`
      <div class="bulk-row">
        <button class="bulk-row-x" title="Remove">✕</button>
        <input class="bj-title" placeholder="Job title *">
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
  };
  addRow();
  $("bulk-job-add").onclick = addRow;
  $("bulk-job-none").onchange = (e) => { wrap.style.opacity = e.target.checked ? ".4" : "1"; wrap.style.pointerEvents = e.target.checked ? "none" : "auto"; $("bulk-job-add").disabled = e.target.checked; };
  $("bulk-job-save").onclick = async () => {
    const none = $("bulk-job-none").checked;
    const btn = $("bulk-job-save"); btn.disabled = true; btn.textContent = "Saving…";
    if (none) {
      await api("/settings/set.php","POST",{ key:"step_experience_done", value:"1" });
    } else {
      const rows = [...wrap.querySelectorAll(".bulk-row")];
      const jobs = rows.map(r => ({
        title: r.querySelector(".bj-title").value.trim(),
        company_name: r.querySelector(".bj-company").value.trim(),
        start_date: r.querySelector(".bj-start").value,
        end_date: r.querySelector(".bj-current").checked ? "" : r.querySelector(".bj-end").value,
      })).filter(j => j.title);
      if (!jobs.length) { btn.disabled = false; btn.textContent = "Save & complete"; alert("Add at least one role, or check “I have no work experience.”"); return; }
      for (const j of jobs) await api("/profile/jobs/add.php","POST", j);
      await api("/settings/set.php","POST",{ key:"step_experience_done", value:"1" });
    }
    closeModal(); renderProfile();
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
    closeModal(); renderProfile();
  };
}

function openExtrasFlow() {
  openModal(`
    <h3>Round out your profile</h3>
    <p class="bulk-intro">Add any interests, education, and certifications you have. All optional — skip anything that doesn't apply, then finish.</p>
    <div class="extras-sec"><div class="extras-label">Interests</div>
      <div class="bulk-skill-input"><input id="ex-int-field" placeholder="e.g. Cloud Architecture"><button class="in-btn primary" id="ex-int-add" style="flex:none;padding:9px 14px">Add</button></div>
      <div class="bulk-skill-chips" id="ex-int-chips"></div></div>
    <div class="extras-sec"><div class="extras-label">Education</div><div id="ex-edu-rows"></div><button class="bulk-addrow" id="ex-edu-add">+ Add education</button></div>
    <div class="extras-sec"><div class="extras-label">Certifications</div><div id="ex-cert-rows"></div><button class="bulk-addrow" id="ex-cert-add">+ Add certification</button></div>
    <div class="in-modal-actions"><button class="in-btn ghost" id="ex-skip">I have none of these</button><button class="in-btn primary" id="ex-save">Save &amp; complete</button></div>`);
  const intPending = [];
  const intChips = $("ex-int-chips"), intField = $("ex-int-field");
  const refreshInt = () => {
    intChips.innerHTML = "";
    intPending.forEach((name, i) => { const chip = el(`<span class="in-chip">${esc(name)} <button class="x">✕</button></span>`); chip.querySelector(".x").onclick = () => { intPending.splice(i,1); refreshInt(); }; intChips.appendChild(chip); });
  };
  const addInt = () => { const v = intField.value.trim(); if (v && !intPending.some(s => s.toLowerCase() === v.toLowerCase())) intPending.push(v); intField.value = ""; intField.focus(); refreshInt(); };
  $("ex-int-add").onclick = addInt;
  intField.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addInt(); } });
  const eduWrap = $("ex-edu-rows");
  $("ex-edu-add").onclick = () => {
    const row = el(`<div class="bulk-row"><button class="bulk-row-x">✕</button><input class="ee-inst" placeholder="Institution"><input class="ee-deg" placeholder="Degree"><input class="ee-field" placeholder="Field of study"><div class="bulk-dates"><div class="bulk-date-field"><label>Start year</label><input class="ee-start" type="number" placeholder="2018"></div><div class="bulk-date-field"><label>End year</label><input class="ee-end" type="number" placeholder="2022"></div></div></div>`);
    row.querySelector(".bulk-row-x").onclick = () => row.remove(); eduWrap.appendChild(row);
  };
  const certWrap = $("ex-cert-rows");
  $("ex-cert-add").onclick = () => {
    const row = el(`<div class="bulk-row"><button class="bulk-row-x">✕</button><input class="ec-name" placeholder="Certification name *"><input class="ec-issuer" placeholder="Issuer"><div class="bulk-dates"><div class="bulk-date-field"><label>Issued</label><input class="ec-issue" type="date"></div><div class="bulk-date-field"><label>Expires</label><input class="ec-exp" type="date"></div></div></div>`);
    row.querySelector(".bulk-row-x").onclick = () => row.remove(); certWrap.appendChild(row);
  };
  $("ex-skip").onclick = async () => { await api("/settings/set.php","POST",{ key:"step_extras_done", value:"1" }); closeModal(); renderProfile(); };
  $("ex-save").onclick = async () => {
    const btn = $("ex-save"); btn.disabled = true; btn.textContent = "Saving…";
    for (const name of intPending) await api("/profile/interests/add.php","POST",{ name });
    for (const r of eduWrap.querySelectorAll(".bulk-row")) {
      const inst = r.querySelector(".ee-inst").value.trim(), deg = r.querySelector(".ee-deg").value.trim();
      if (!inst && !deg) continue;
      await api("/profile/education/add.php","POST",{ institution:inst, degree:deg, field:r.querySelector(".ee-field").value.trim(), start_year:r.querySelector(".ee-start").value, end_year:r.querySelector(".ee-end").value });
    }
    for (const r of certWrap.querySelectorAll(".bulk-row")) {
      const name = r.querySelector(".ec-name").value.trim(); if (!name) continue;
      await api("/profile/certs/add.php","POST",{ name, issuer:r.querySelector(".ec-issuer").value.trim(), issue_date:r.querySelector(".ec-issue").value, expiry_date:r.querySelector(".ec-exp").value });
    }
    await api("/settings/set.php","POST",{ key:"step_extras_done", value:"1" });
    closeModal(); renderProfile();
  };
}

// ===================================================================
// VIEW: PUBLIC PROFILE (read-only, by uuid)
// ===================================================================
async function renderPublicProfile(uuid) {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading profile…</div>`;
  // Only logged-in USERS can follow other users; skip the status call
  // entirely for a company session or a signed-out visitor.
  const canFollow = !!ME && !CO;
  const [prof, jobs, edu, certs, skills, interests, scores, fstat, counts] = await Promise.all([
    api("/profile/get.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/jobs/list.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/education/list.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/certs/list.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/skills/list.php?uuid=" + encodeURIComponent(uuid)),
    api("/profile/interests/list.php?uuid=" + encodeURIComponent(uuid)),
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
  const headline = attrs.headline?.value || "";
  const initial = (p.username || "?").charAt(0).toUpperCase();
  const loc = [p.city, p.state, p.country].filter(Boolean).join(", ");
  // Follow state + counts.
  const isFollowing = canFollow ? !!(fstat && fstat.data?.data?.following) : false;
  const followerCount = counts.data?.data?.followers ?? 0;

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
        <div class="in-followcount">${followerCount} follower${followerCount === 1 ? "" : "s"}</div>
      </div>
      ${socialLinksHtml(attrs)}
      ${canFollow ? `<button class="in-follow-btn ${isFollowing ? "following" : ""}" id="follow-toggle">${isFollowing ? "Following" : "Follow"}</button>` : ""}
      ${ME && ME.role === "admin" ? `<button class="in-admin-btn" id="admin-edit">🛠 Edit (admin)</button>` : ""}
    </div>`);
  leftCol.appendChild(head);
  const followBtn = head.querySelector("#follow-toggle");
  if (followBtn) {
    followBtn.onclick = async () => {
      const btn = head.querySelector("#follow-toggle");
      const currentlyFollowing = btn.classList.contains("following");
      btn.disabled = true;
      const endpoint = currentlyFollowing ? "/follow/unfollow.php" : "/follow/follow.php";
      const r = await api(endpoint, "POST", { target_type:"user", target_uuid:uuid });
      btn.disabled = false;
      if (r.ok && r.data?.success) { btn.classList.toggle("following"); btn.textContent = btn.classList.contains("following") ? "Following" : "Follow"; }
      else { alert(r.data?.error || "Could not update follow status."); }
    };
  }
  // admin: edit this user's core profile fields
  if (ME && ME.role === "admin") {
    head.querySelector("#admin-edit").onclick = () => adminEditProfile(p, headline, uuid);
  }

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
  roSection(rightCol, "Certifications", certs.data?.data, c => `<div class="meta"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.issuer || "")}${c.issue_date ? " · " + c.issue_date : ""}</div></div>`);
  roChips(rightCol, "Skills", skills.data?.data, s => `${esc(s.name)} ${s.proficiency ? `<span class="lvl">L${s.proficiency}</span>` : ""}`);
  roChips(rightCol, "Interests", interests.data?.data, i => esc(i.name));
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

// ===================================================================
// VIEW: SETTINGS (left-nav tabs)
// ===================================================================
let SETTINGS_TAB = "account";
let SETTINGS_DATA = null;   // cached {p, st} so tab switches don't refetch

async function renderSettings() {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading settings…</div>`;

  // fetch once; tab switches reuse this without refetching/rebuilding.
  const [prof, settings] = await Promise.all([
    api("/profile/get.php"),
    api("/settings/get.php"),
  ]);
  SETTINGS_DATA = { p: prof.data?.data || {}, st: settings.data?.data || {} };
  const isAdmin = (ME && ME.role === "admin");

  const tabs = [
    { key:"account",       label:"Account" },
    { key:"privacy",       label:"Privacy" },
    { key:"notifications", label:"Notifications" },
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
  else if (SETTINGS_TAB === "privacy")       renderSetPrivacy(panel, st);
  else if (SETTINGS_TAB === "notifications") renderSetNotifications(panel);
  else if (SETTINGS_TAB === "admin")         renderSetAdmin(panel);
  else if (SETTINGS_TAB === "danger")        renderSetDanger(panel);
}

// ---- Account tab: edit core fields + password placeholder ------------
function renderSetAccount(panel, p) {
  panel.appendChild(el(`
    <div class="in-set-section">
      <h3>Account details</h3>
      <label>Username</label><input id="set-username" value="${esc(p.username||"")}">
      <div class="row" style="display:flex;gap:10px">
        <div style="flex:1"><label>City</label><input id="set-city" value="${esc(p.city||"")}"></div>
        <div style="flex:1"><label>State</label><input id="set-state" value="${esc(p.state||"")}"></div>
      </div>
      <label>Country</label><input id="set-country" value="${esc(p.country||"")}">
      <label>Email</label><input value="${esc(p.email||"")}" disabled title="Email changes require verification (coming soon)">
      <div class="in-set-actions"><button class="in-btn primary" style="flex:none;padding:10px 20px" id="set-save-account">Save changes</button></div>
      <div class="in-set-msg" id="set-account-msg"></div>
    </div>
    <div class="in-set-section">
      <h3>Password</h3>
      <div class="in-set-placeholder">Changing your password will require email verification or multi-factor authentication. This is coming soon.</div>
      <button class="in-btn ghost" style="flex:none;padding:9px 18px;opacity:.6;cursor:not-allowed" disabled>Change password</button>
    </div>`));
  $("set-save-account").onclick = async () => {
    const msg = $("set-account-msg");
    const r = await api("/profile/update.php", "POST", {
      username: $("set-username").value.trim(),
      city: $("set-city").value.trim(),
      state: $("set-state").value.trim(),
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
  const hideScoresOn = st.hide_all_scores === "1";
  panel.appendChild(el(`
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
          <div class="in-set-toggle-label">Hide all scores from other users</div>
          <div class="in-set-toggle-sub">Your scores stay visible to you, but no one else will see them on your profile. You can also hide individual scores from the profile page.</div>
        </div>
        <button class="in-toggle ${hideScoresOn ? "on" : ""}" id="toggle-hide-scores" role="switch" aria-checked="${hideScoresOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-msg" id="set-privacy-msg"></div>
    </div>`));
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
  $("toggle-hide-scores").onclick = async () => {
    const btn = $("toggle-hide-scores");
    const turningOn = !btn.classList.contains("on");
    btn.disabled = true;
    const r = await api("/settings/set.php", "POST", { key:"hide_all_scores", value: turningOn ? "1" : "0" });
    btn.disabled = false;
    const msg = $("set-privacy-msg");
    if (r.ok && r.data?.success) {
      btn.classList.toggle("on", turningOn);
      btn.setAttribute("aria-checked", turningOn);
      msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
    } else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
  };
}

// ---- Notifications tab: placeholder ----------------------------------
function renderSetNotifications(panel) {
  panel.appendChild(el(`
    <div class="in-set-section">
      <h3>Notifications</h3>
      <div class="in-set-placeholder">Notification preferences will appear here once the notification system is built — choosing what you're alerted about (new followers, post activity, score updates, and more).</div>
    </div>`));
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
      </div>
      <div class="in-card2">
        <h2>How this score was calculated</h2>
        <div class="bd-placeholder-note">ⓘ This is a placeholder breakdown. The full scoring algorithm is still in development — this page will eventually explain in detail how each part of your profile contributes to your score for “${esc(s.target_value)}.”</div>
        <div class="bd-factors">${factors}</div>
        <div class="bd-algo">Algorithm version: ${esc(s.algo_version || "n/a")}</div>
      </div>
    </div>`));
}
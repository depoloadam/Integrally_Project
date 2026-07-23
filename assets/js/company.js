// =====================================================================
// company.js — company accounts
//   CO global (company session), auth modals (register/login),
//   company dashboard (#company-dashboard) to manage profile + jobs,
//   and public company profile (#company/<uuid>).
//
//   Note: the app supports being signed in as a USER and a COMPANY at
//   the same time (separate sessions). CO holds the company session.
// =====================================================================

// Websites are stored as typed (e.g. "example.com" with no protocol).
// Used directly as an <a href>, a bare host string is a RELATIVE link,
// so the browser appends it to the current path instead of navigating
// out — the site opens "localhost/integrally/example.com" instead of
// leaving the app. Always route website hrefs through this helper.
// Returns { href, text } — href always has a protocol, text is the
// bare host for display (no protocol, no trailing slash).
function normalizeWebsite(raw) {
  if (!raw) return { href: "", text: "" };
  const href = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  const text = raw.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return { href, text };
}


let CO = null;   // current logged-in company (or null)

// Establish the company session (called from boot()). Safe when none.
async function loadCompanySession() {
  const r = await api("/company/me.php");
  CO = (r.ok && r.data?.success) ? r.data.data : null;
  updateCompanyNav();
  return CO;
}

// Ensure a "Company" dashboard nav button exists when a company session
// is active. With single-identity UX, this is only shown when CO is set
// and no user is signed in (boot() controls visibility).
function updateCompanyNav() {
  let btn = document.querySelector('[data-nav="company-dashboard"]');
  if (CO && !ME) {
    if (!btn) {
      btn = el(`<button data-nav="company-dashboard">Company</button>`);
      btn.onclick = () => { location.hash = "company-dashboard"; };
      const links = document.querySelector(".in-nav-links");
      const searchBtn = document.getElementById("search-trigger");
      // Keep the search trigger as the rightmost nav item: insert the
      // Company tab before it rather than appending to the end.
      if (links && searchBtn && searchBtn.parentNode === links) links.insertBefore(btn, searchBtn);
      else if (links) links.appendChild(btn);
    }
    btn.style.display = "";
  } else if (btn) {
    btn.style.display = "none";
  }
}

// ---- company auth --------------------------------------------------
// All company sign-in / signup now runs through the dedicated page
// (company.html). This helper navigates there, warning a signed-in
// USER first, since company login clears the user session (single-
// identity model enforced server-side).
async function goCompanyAuth(register = false) {
  if (ME && !(await confirmDialog("Company accounts are separate from your personal account. Continuing will sign you out of your personal account. Continue?", { confirmText: "Continue" }))) return;
  window.location.href = COMPANY_AUTH_PAGE + (register ? "#register" : "");
}
window.goCompanyAuth = goCompanyAuth;

// ---- shared "About the company" card + description editor ------------
// The same card is rendered on the dashboard AND the public profile so
// the two pages stay visually consistent. `editable` shows the ✎ (or
// the dashed invite when empty); `onSaved` re-renders the calling view.
function renderCompanyAbout(name, description, editable, onSaved) {
  const desc = (description || "").trim();
  if (!desc && !editable) return el(`<div style="display:none"></div>`);

  if (!desc) {
    const box = el(`
      <div class="in-bio-box empty">
        <div class="in-bio-empty-title">Tell people about ${esc(name)}</div>
        <div class="in-bio-empty-sub">A short description helps visitors understand what your company does.</div>
        <button class="in-btn ghost in-bio-add" style="flex:none;padding:8px 20px;margin:14px auto 0">Add a description</button>
      </div>`);
    box.querySelector(".in-bio-add").onclick = () => editCompanyDescription(desc, onSaved);
    return box;
  }

  const box = el(`
    <div class="in-bio-box">
      <div class="in-bio-inner">
        <div class="in-bio-label">About ${esc(name)}</div>
        <div class="in-bio-text">${esc(desc)}</div>
      </div>
      ${editable ? `<button class="in-bio-edit" title="Edit description">✎</button>` : ""}
    </div>`);
  if (editable) box.querySelector(".in-bio-edit").onclick = () => editCompanyDescription(desc, onSaved);
  return box;
}

// Small modal that edits ONLY the description (update.php applies
// partial updates, so other fields are untouched).
function editCompanyDescription(current, onSaved) {
  openModal(`
    <h3>About your company</h3>
    <textarea id="co-desc-input" rows="6" maxlength="2000" placeholder="What you do, who you serve, what makes you different…">${esc(current || "")}</textarea>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="co-desc-save">Save</button>
    </div>`);
  $("co-desc-save").onclick = async () => {
    const value = $("co-desc-input").value.trim();
    const btn = $("co-desc-save"); btn.disabled = true; btn.textContent = "Saving…";
    const r = await api("/company/update.php", "POST", { description: value });
    if (r.ok && r.data?.success) {
      if (CO) CO.description = r.data.data.description;
      closeModal();
      if (onSaved) onSaved();
    } else {
      toast(r.data?.error || "Could not save the description.", "err");
      btn.disabled = false; btn.textContent = "Save";
    }
  };
}

// ---- company dashboard ----------------------------------------------
async function renderCompanyDashboard() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === "company-dashboard"));
  const view = $("view");

  if (!CO) {
    view.innerHTML = `
      <div class="landing co-landing">

        <div class="landing-hero">
          <div class="landing-hero-inner">
            <div class="landing-eyebrow">Integrally for companies</div>
            <h1>Build your presence.<br><span class="acc">Reach real candidates.</span></h1>
            <p>Set up a company page to post openings, share updates with followers,
               and connect with candidates whose skills are actually measured — all
               from one dashboard.</p>
            <div class="landing-cta-row">
              <button class="in-btn primary landing-cta" id="co-land-reg">Create a company account</button>
              <button class="in-btn ghost landing-cta ghost-dark" id="co-land-login">Company sign in</button>
            </div>
            <div class="landing-hero-note">Looking for a personal account? <a href="${AUTH_PAGE}">User sign up →</a></div>
          </div>
        </div>

        <div class="landing-features">
          <div class="landing-feature">
            <div class="landing-feature-icon">📢</div>
            <h3>Post &amp; manage jobs</h3>
            <p>Publish openings, toggle salary visibility, and edit or close postings
               anytime from your dashboard.</p>
          </div>
          <div class="landing-feature">
            <div class="landing-feature-icon">👥</div>
            <h3>Grow a following</h3>
            <p>Candidates follow your page and see your posts in their feed — build an
               audience before you even post a role.</p>
          </div>
          <div class="landing-feature">
            <div class="landing-feature-icon">✅</div>
            <h3>Verified employer links</h3>
            <p>Let people list your company in their work history, with your opt-in —
               real experience, backed by real employers.</p>
          </div>
        </div>

        <div class="landing-coband">
          <div>
            <h3>Ready to start hiring smarter?</h3>
            <p>Creating a company account takes a couple of minutes.</p>
          </div>
          <div class="landing-coband-btns">
            <button class="in-btn primary" style="flex:none;padding:10px 20px" id="co-land-reg2">Create a company account</button>
          </div>
        </div>

      </div>`;

    $("co-land-reg").onclick   = () => goCompanyAuth(true);
    $("co-land-reg2").onclick  = () => goCompanyAuth(true);
    $("co-land-login").onclick = () => goCompanyAuth(false);
    return;
  }

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  // Header card: logo + name on the left, company info panel on the
  // right, and a small ✎ edit button in the corner (same treatment as
  // the bio box). Sign out lives in the nav identity dropdown, so it's
  // no longer duplicated here.
  const logoChar = (CO.name || "?").charAt(0).toUpperCase();

  // Follower count for the info panel (cheap, single query).
  let followerCount = 0;
  const fc = await api("/follow/counts.php?type=company&uuid=" + encodeURIComponent(CO.uuid));
  if (fc.ok && fc.data?.success) followerCount = fc.data.data.followers ?? 0;

  const loc = [CO.city, CO.state, CO.country].filter(Boolean).join(", ");
  const since = CO.created_at
    ? new Date(CO.created_at.replace(" ", "T")).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "";
  // Websites are stored as typed — normalize the href, show the bare host-ish text.
  const { href: webHref, text: webText } = normalizeWebsite(CO.website);

  const infoRows = [
    CO.email ? `<div class="co-info-row"><div class="co-info-label">Email</div><div class="co-info-value">${esc(CO.email)}</div></div>` : "",
    CO.website ? `<div class="co-info-row"><div class="co-info-label">Website</div><div class="co-info-value"><a href="${esc(webHref)}" target="_blank" rel="noopener noreferrer">${esc(webText)} ↗</a></div></div>` : "",
    loc ? `<div class="co-info-row"><div class="co-info-label">Location</div><div class="co-info-value">${esc(loc)}</div></div>` : "",
    `<div class="co-info-row"><div class="co-info-label">Followers</div><div class="co-info-value">${followerCount}</div></div>`,
    since ? `<div class="co-info-row"><div class="co-info-label">Member since</div><div class="co-info-value">${esc(since)}</div></div>` : "",
  ].filter(Boolean).join("");

  const dashLabel = el(`<div class="co-dash-label">Your Dashboard <span>· only you can see this view</span></div>`);
  wrap.appendChild(dashLabel);

  const head = el(`
    <div class="in-card2 co-dash-head" style="position:relative">
      <button class="co-edit-corner" id="co-edit" title="Edit company profile">✎</button>
      <div class="job-detail-head co-head">
        <div class="job-logo lg">${CO.logo ? `<img src="${esc(CO.logo)}" alt="">` : esc(logoChar)}</div>
        <div style="flex:1;min-width:180px">
          <h1 style="margin:0 0 4px;font-size:22px;letter-spacing:-0.4px">${esc(CO.name)}${Number(CO.is_verified) ? ' <span class="post-tag" style="vertical-align:middle">Verified</span>' : ""}</h1>
          <div class="job-company" style="font-size:14px">${esc(CO.industry || "")}${CO.city ? " · " + esc(CO.city) + (CO.state ? ", " + esc(CO.state) : "") : ""}</div>
        </div>
        <div class="co-info">${infoRows}<a class="co-info-link" href="#company/${esc(CO.uuid)}">View public profile →</a></div>
      </div>
    </div>`);
  wrap.appendChild(head);

  $("co-edit").onclick = () => openCompanyEdit();

  // About the company — the same card visitors see on the public
  // profile, editable right here too.
  wrap.appendChild(renderCompanyAbout(CO.name, CO.description, true, renderCompanyDashboard));

  // Jobs management card
  const jobsCard = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px">
        Your job postings
        <button class="add" id="co-add-job" title="Post a job">+</button>
      </h2>
      <div id="co-jobs-list"><div class="in-loading">Loading…</div></div>
    </div>`);
  wrap.appendChild(jobsCard);
  $("co-add-job").onclick = () => openJobEditor();

  // Link to the "who lists us" page.
  const empCard = el(`
    <div class="in-card2" style="cursor:pointer">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px;margin:0">
        People who list ${esc(CO.name)}
        <span style="margin-left:auto;color:var(--in-muted);font-weight:400;font-size:15px">View →</span>
      </h2>
    </div>`);
  empCard.onclick = () => { location.hash = "company-employees"; };
  wrap.appendChild(empCard);

  loadCompanyJobs();
}

// ---- company feed page (#company-feed) ------------------------------
async function renderCompanyFeed() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === "company-feed"));
  const view = $("view");
  if (!CO) { view.innerHTML = `<div class="in-card2"><div class="in-empty">Company sign-in required.</div></div>`; return; }
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);
  renderCompanyFeedInto(wrap);
}

// ---- company "who lists us" page (#company-employees) ---------------
let CO_EMP_SORT = "current";

async function renderCompanyEmployees() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  const view = $("view");

  if (!CO) {
    view.innerHTML = `<div class="in-card2"><div class="in-empty">Company sign-in required.</div></div>`;
    return;
  }

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  wrap.appendChild(el(`<div class="in-back"><button class="in-back-btn" onclick="location.hash='company-dashboard'">‹ Back to dashboard</button></div>`));

  const card = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px">People who list ${esc(CO.name)}</h2>
      <div class="in-empty" style="font-style:normal;margin:-6px 0 14px">Users who linked your company in their job history.</div>
      <div class="in-admin-toolbar">
        <select id="emp-sort">
          <option value="current">Current first</option>
          <option value="recent">Most recent</option>
          <option value="name">Name (A–Z)</option>
        </select>
      </div>
      <div id="emp-summary" class="emp-summary"></div>
      <div id="emp-list"></div>
    </div>`);
  wrap.appendChild(card);
  view.appendChild(wrap);

  $("emp-sort").value = CO_EMP_SORT;
  $("emp-sort").onchange = () => { CO_EMP_SORT = $("emp-sort").value; loadCompanyEmployees(); };

  loadCompanyEmployees();
}

async function loadCompanyEmployees() {
  const list = $("emp-list");
  const summary = $("emp-summary");
  list.innerHTML = `<div class="in-loading">Loading…</div>`;
  summary.innerHTML = "";

  const r = await api("/company/employees.php?sort=" + encodeURIComponent(CO_EMP_SORT));
  if (!r.ok || !r.data?.success) { list.innerHTML = `<div class="in-empty">Could not load the list.</div>`; return; }

  const { employees, current, past, total } = r.data.data;
  if (!total) {
    list.innerHTML = `<div class="in-empty">No one has listed your company yet. Turn on "Allow users to list us as their employer" in your profile so people can link to you.</div>`;
    return;
  }

  summary.innerHTML = `<span class="emp-pill ok">${current} current</span><span class="emp-pill">${past} past</span><span class="emp-pill">${total} total</span>`;

  list.innerHTML = "";
  employees.forEach(e => {
    const nm = e.name || ("@" + e.username);
    const dates = (e.start_date || "") + (e.is_current ? " – Present" : (e.end_date ? " – " + e.end_date : ""));
    const avatarChar = (e.username || "?").charAt(0).toUpperCase();
    const hov = e.user_uuid ? ` data-hover-card="user" data-hover-uuid="${esc(e.user_uuid)}"` : "";
    const row = el(`
      <div class="in-item" role="button" tabindex="0" style="cursor:pointer">
        <div class="connect-ava" style="width:42px;height:42px;font-size:16px"${hov}>${e.profile_pic ? `<img src="${esc(e.profile_pic)}" alt="">` : esc(avatarChar)}</div>
        <div class="meta" style="margin-left:12px">
          <div class="t"${hov}>${esc(nm)} ${e.is_current ? `<span class="in-admin-badge ok">Current</span>` : `<span class="in-admin-badge off">Past</span>`}</div>
          <div class="s">${esc(e.title || "")}${dates.trim() ? " · " + esc(dates.trim()) : ""}</div>
        </div>
        <span style="color:var(--in-muted);align-self:center">›</span>
      </div>`);
    row.onclick = () => { location.hash = "user/" + e.user_uuid; };
    list.appendChild(row);
  });
}

async function loadCompanyJobs() {
  const box = $("co-jobs-list");
  const r = await api("/jobs/list.php?mine=1&limit=50");
  if (!r.ok || !r.data?.success) { box.innerHTML = `<div class="in-empty">Could not load your jobs.</div>`; return; }
  const jobs = r.data.data.jobs;
  if (!jobs.length) { box.innerHTML = `<div class="in-empty">No postings yet. Click + to add your first job.</div>`; return; }

  box.innerHTML = "";
  jobs.forEach(j => {
    const meta = [
      j.location || "",
      j.employment_type ? EMP_LABELS[j.employment_type] : "",
      j.remote_policy ? REMOTE_LABELS[j.remote_policy] : "",
    ].filter(Boolean).join(" · ");
    const badge = j.status === "open"
      ? `<span class="in-admin-badge ok">Open</span>`
      : `<span class="in-admin-badge off">${esc(j.status)}</span>`;
    const n = j.applicant_count || 0;
    const applicants = `<button class="co-applicant-pill" title="View applicants">${n} applicant${n === 1 ? "" : "s"}</button>`;
    const row = el(`
      <div class="in-item">
        <div class="meta">
          <div class="t">${esc(j.title)} ${badge}</div>
          <div class="s">${esc(meta)}</div>
        </div>
        ${applicants}
        <div class="job-actions">
          <button class="job-actions-btn" title="Actions" aria-label="Actions">⋮</button>
          <div class="job-actions-menu">
            <button data-act="applicants">View applicants</button>
            <button data-act="edit">Edit</button>
            ${j.status !== "closed" ? `<button data-act="close" class="danger">Close</button>` : ""}
          </div>
        </div>
      </div>`);

    // The count pill jumps straight to the applicant list.
    row.querySelector(".co-applicant-pill").onclick = (e) => {
      e.stopPropagation(); renderJobApplicants(j.uuid);
    };

    const menuBtn = row.querySelector(".job-actions-btn");
    const menu = row.querySelector(".job-actions-menu");
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      // Close any other open menus first.
      document.querySelectorAll(".job-actions-menu.show").forEach(m => { if (m !== menu) m.classList.remove("show"); });
      menu.classList.toggle("show");
    };
    document.addEventListener("click", () => menu.classList.remove("show"));

    menu.querySelector('[data-act="applicants"]').onclick = (e) => {
      e.stopPropagation(); menu.classList.remove("show"); renderJobApplicants(j.uuid);
    };
    menu.querySelector('[data-act="edit"]').onclick = (e) => {
      e.stopPropagation(); menu.classList.remove("show"); openJobEditor(j.uuid);
    };
    const closeBtn = menu.querySelector('[data-act="close"]');
    if (closeBtn) {
      closeBtn.onclick = async (e) => {
        e.stopPropagation(); menu.classList.remove("show");
        if (!(await confirmDialog(`Close "${j.title}"? It will no longer appear in public job listings, but you can reopen it by editing the posting.`, { confirmText: "Close posting", danger: true }))) return;
        const res = await api("/jobs/update.php", "POST", { uuid: j.uuid, status: "closed" });
        if (res.ok && res.data?.success) loadCompanyJobs();
        else toast(res.data?.error || "Could not close the job.", "err");
      };
    }
    box.appendChild(row);
  });
}

// ---- applicants PAGE (ranked by score) ------------------------------
async function renderJobApplicants(jobUuid) {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading applicants…</div>`;

  const r = await api("/applications/for-job.php?job_uuid=" + encodeURIComponent(jobUuid));
  if (!r.ok || !r.data?.success) {
    view.innerHTML = `<div class="in-admin"><div class="in-back"><button class="in-back-btn" onclick="location.hash='company-dashboard'">‹ Back to dashboard</button></div><div class="in-empty">${esc(r.data?.error || "Could not load applicants.")}</div></div>`;
    return;
  }
  const d = r.data.data;
  const c = d.counts || {};

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  wrap.appendChild(el(`<div class="in-back"><button class="in-back-btn" id="ja-back">‹ Back to dashboard</button></div>`));

  const card = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px;margin-bottom:4px">Applicants — ${esc(d.job.title)}</h2>
      <div class="s" style="color:var(--in-muted);font-size:13px;margin-bottom:16px">
        ${c.submitted || 0} active · ${c.withdrawn || 0} withdrawn${c.expired ? ` · ${c.expired} expired` : ""}
      </div>
      <div id="ja-list"></div>
    </div>`);
  wrap.appendChild(card);
  view.appendChild(wrap);
  $("ja-back").onclick = () => renderCompanyDashboard();

  const list = card.querySelector("#ja-list");
  const apps = d.applicants || [];
  if (!apps.length) {
    list.innerHTML = `<div class="in-empty">No applications yet.</div>`;
    return;
  }

  apps.forEach((a, idx) => {
    const cand = a.candidate || {};
    const name = cand.full_name || cand.username || "Candidate";
    const av = cand.avatar ? `<img src="${esc(cand.avatar)}" alt="">` : esc(name.charAt(0).toUpperCase());
    const score = a.score_value != null
      ? `<div class="ja-score" title="Score at apply time">${Math.round(a.score_value)}</div>`
      : `<div class="ja-score none" title="No score">—</div>`;
    const dim = a.status !== "submitted" ? ' style="opacity:.55"' : "";
    const hov = cand.uuid ? ` data-hover-card="user" data-hover-uuid="${esc(cand.uuid)}"` : "";
    const row = el(`
      <div class="ja-row"${dim}>
        <div class="ja-rank">${idx + 1}</div>
        ${score}
        <div class="connect-ava" style="width:40px;height:40px"${hov}>${av}</div>
        <div class="ja-main">
          <div class="ja-name"${hov}>${esc(name)} ${a.status !== "submitted" ? `<span class="in-admin-badge off" style="margin-left:6px">${esc(a.status_label)}</span>` : ""}</div>
          <div class="ja-sub">@${esc(cand.username || "")}${a.has_resume ? " · 📎 resume" : ""}</div>
        </div>
        <button class="in-btn ghost" style="flex:none;padding:7px 14px;font-size:13px">View</button>
      </div>`);
    row.querySelector("button").onclick = () => openApplicantDetail(a.uuid);
    list.appendChild(row);
  });
}

async function openApplicantDetail(appUuid) {
  openModal(`<div class="in-loading" style="padding:24px">Loading…</div>`, { wide: true });
  const r = await api("/applications/detail.php?uuid=" + encodeURIComponent(appUuid));
  const modal = $("modal");
  if (!r.ok || !r.data?.success) {
    modal.innerHTML = `<div class="in-empty" style="padding:24px">${esc(r.data?.error || "Could not load this application.")}</div>
      <div class="in-modal-actions"><button class="in-btn ghost" onclick="closeModal()">Close</button></div>`;
    return;
  }
  const a = r.data.data;
  const cand = a.candidate || {};
  const name = cand.full_name || cand.username || "Candidate";

  const answersHtml = (a.answers || []).length
    ? a.answers.map(qa => `
        <div style="margin-bottom:12px">
          <div style="font-weight:600;font-size:13px;color:var(--in-ink)">${esc(qa.label)}</div>
          <div style="font-size:14px;color:var(--in-ink-soft);white-space:pre-wrap">${qa.answer ? esc(qa.answer) : "<em style='color:var(--in-muted)'>No answer</em>"}</div>
        </div>`).join("")
    : `<div class="in-empty" style="padding:10px">No application questions.</div>`;

  const breakdown = a.score?.breakdown || [];
  const scoreHtml = a.score?.value != null ? `
    <div class="ja-detail-score">
      <div class="ja-detail-score-num">${Math.round(a.score.value)}</div>
      <div style="flex:1">
        ${breakdown.map(f => `<div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--in-ink-soft);margin-bottom:2px"><span>${esc(f.detail || f.factor)}</span><span style="font-weight:600">+${f.points}</span></div>`).join("")}
      </div>
    </div>` : `<div class="in-empty" style="padding:10px">No score snapshot.</div>`;

  // The candidate's own self-scores (top 3, relevant first), shown under
  // the application snapshot. Empty when they have none / opted out / hid them.
  const rel = a.related_scores || [];
  const relatedHtml = rel.length ? `
    <div class="ja-rel">
      <div class="ja-rel-head">Candidate's own scores</div>
      ${rel.map(rs => `
        <div class="ja-rel-row">
          <div class="ja-rel-badge">${Math.round(rs.score_value)}</div>
          <div class="ja-rel-meta">
            <div class="ja-rel-target">${esc(rs.target_value)}${rs.relevant ? `<span class="ja-rel-tag">Related</span>` : ""}${rs.hidden ? `<span class="ja-rel-tag hidden">Hidden</span>` : ""}</div>
            <div class="ja-rel-sub">${esc((rs.target_type || "").replace("_", " "))}</div>
          </div>
        </div>`).join("")}
    </div>` : "";

  const resumeHtml = a.resume?.has
    ? `<a class="in-btn ghost" style="flex:none;padding:8px 16px;text-decoration:none;display:inline-block" href="${API_BASE}/applications/resume.php?uuid=${encodeURIComponent(a.uuid)}" target="_blank">📎 Download resume (${esc(a.resume.name || "file")})</a>`
    : `<div class="in-empty" style="padding:8px">No resume attached.</div>`;

  const contact = a.contact || {};
  const contactHtml = `
    <div class="ep-sep"><span>Contact information</span></div>
    <div id="ja-contact-wrap">
      <button class="in-btn ghost" id="ja-see-contact" style="flex:none;padding:8px 16px">See contact information</button>
      <div class="in-empty" style="padding:6px 0;font-size:12px">Hidden until you choose to view it.</div>
    </div>`;

  modal.innerHTML = `
    <h2 style="margin-bottom:2px">${esc(name)}</h2>
    <div style="color:var(--in-muted);font-size:13px;margin-bottom:4px">
      <a href="#user/${esc(cand.uuid)}" onclick="closeModal()" style="color:var(--in-accent);text-decoration:none" data-hover-card="user" data-hover-uuid="${esc(cand.uuid)}">@${esc(cand.username || "")}</a>${cand.location ? " · " + esc(cand.location) : ""}
    </div>
    <div style="color:var(--in-muted);font-size:12px;margin-bottom:16px">Applied ${esc(timeAgo(a.applied_at))} · ${esc(a.status_label)}</div>

    <div class="ep-sep"><span>Integrally score</span></div>
    ${scoreHtml}
    ${relatedHtml}
    <div class="ep-sep"><span>Responses</span></div>
    ${answersHtml}
    <div class="ep-sep"><span>Resume</span></div>
    ${resumeHtml}
    ${contactHtml}

    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Close</button>
      <a class="in-btn primary" href="#user/${esc(cand.uuid)}" onclick="closeModal()" style="text-decoration:none">View full profile</a>
    </div>`;

  // Reveal contact info on demand. Kept behind a click so it isn't shown
  // casually; a future step will require the employer to re-authenticate
  // here before the reveal.
  const seeBtn = $("ja-see-contact");
  if (seeBtn) seeBtn.onclick = () => {
    const wrap = $("ja-contact-wrap");
    if (!wrap) return;
    const email = contact.email || "";
    const phone = contact.phone || "";
    const verified = contact.phone_verified ? ` <span class="ja-verified">✓ verified</span>` : "";
    wrap.innerHTML = `
      <div class="ja-contact">
        <div class="ja-contact-line"><span class="ja-contact-k">Email</span>${email ? `<a href="mailto:${esc(email)}" class="ja-contact-val">${esc(email)}</a>` : `<span class="ja-contact-val"><em style="color:var(--in-muted)">Not provided</em></span>`}</div>
        <div class="ja-contact-line"><span class="ja-contact-k">Phone</span>${phone ? `<a href="tel:${esc(phone.replace(/[^0-9+]/g,""))}" class="ja-contact-val">${esc(phone)}${verified}</a>` : `<span class="ja-contact-val"><em style="color:var(--in-muted)">Not provided</em></span>`}</div>
        <div class="ja-contact-note">This is the candidate's current contact information from their profile.</div>
      </div>`;
  };
}

// ---- job editor PAGE (create + edit) --------------------------------
// Rendered into the main view (not a modal). Reached from the company
// dashboard; returns there on save/cancel.
async function openJobEditor(uuid = null) {
  let j = { title: "", description: "", location: "", employment_type: "", remote_policy: "", salary_min: "", salary_max: "", salary_currency: "USD", apply_url: "", status: "open" };
  if (uuid) {
    const r = await api("/jobs/get.php?uuid=" + encodeURIComponent(uuid));
    if (r.ok && r.data?.success) j = { ...j, ...r.data.data };
  }

  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  wrap.appendChild(el(`<div class="in-back"><button class="in-back-btn" id="job-back">‹ Back to dashboard</button></div>`));

  const card = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px">${uuid ? "Edit job" : "Post a job"}</h2>
      <div class="in-set-msg" id="job-msg"></div>
      <label class="jf-label">Title</label>
      <input class="jf-input" id="job-title" value="${esc(j.title)}" placeholder="Senior Backend Engineer">
      <label class="jf-label">Description</label>
      <div id="job-desc-editor"></div>
      <div class="jf-row">
        <div><label class="jf-label">Location</label><input class="jf-input" id="job-loc" value="${esc(j.location || "")}" placeholder="Cleveland, OH"></div>
        <div><label class="jf-label">Apply URL</label><input class="jf-input" id="job-apply" value="${esc(j.apply_url || "")}" placeholder="https://…"></div>
      </div>
      <div class="jf-row">
        <div><label class="jf-label">Employment type</label>
          <select class="jf-input" id="job-emp">
            <option value="">—</option>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
            <option value="temporary">Temporary</option>
          </select>
        </div>
        <div><label class="jf-label">Remote policy</label>
          <select class="jf-input" id="job-remote">
            <option value="">—</option>
            <option value="onsite">On-site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </select>
        </div>
      </div>
      <label class="jf-checkrow">
        <input type="checkbox" id="job-salary-on"> Include pay range
      </label>
      <div id="job-salary-fields">
        <div class="jf-row" style="margin-bottom:10px">
          <div><label class="jf-label">Pay type</label>
            <select class="jf-input" id="job-pay-period">
              <option value="annual"${(j.pay_period || "annual") === "annual" ? " selected" : ""}>Salary (per year)</option>
              <option value="hourly"${j.pay_period === "hourly" ? " selected" : ""}>Hourly (per hour)</option>
            </select>
          </div>
          <div><label class="jf-label">Currency</label>
            <input class="jf-input" id="job-scur" type="text" maxlength="3" value="${esc(j.salary_currency || "USD")}" placeholder="USD" style="text-transform:uppercase">
          </div>
        </div>
        <div class="jf-row">
          <div><label class="jf-label" id="job-smin-label">Min per year</label><input class="jf-input" id="job-smin" type="number" value="${j.salary_min ?? ""}" placeholder="80000"></div>
          <div><label class="jf-label" id="job-smax-label">Max per year</label><input class="jf-input" id="job-smax" type="number" value="${j.salary_max ?? ""}" placeholder="120000"></div>
        </div>
      </div>
      <div class="ep-sep"><span>Applications</span></div>
      <div class="jf-row">
        <div><label class="jf-label">How candidates apply</label>
          <select class="jf-input" id="job-apply-method">
            <option value="native">On Integrally (Quick apply)</option>
            <option value="external">External link only</option>
            <option value="both">Both</option>
          </select>
        </div>
        <div><label class="jf-label">Accept applications until <span class="ep-hint">(optional)</span></label>
          <input class="jf-input" id="job-accept-until" type="date" value="${esc(j.accept_until || "")}">
        </div>
      </div>
      <div id="job-native-opts">
        <label class="jf-checkrow"><input type="checkbox" id="job-collect-resume"> Ask candidates for a resume</label>
        <label class="jf-checkrow"><input type="checkbox" id="job-collect-score" checked> Include each applicant's Integrally score</label>
        <label class="jf-label" style="margin-top:12px">Application questions <span class="ep-hint">(optional, up to 10)</span></label>
        <div id="job-questions"></div>
        <button type="button" class="in-btn ghost" id="job-add-q" style="flex:none;padding:7px 14px;font-size:13px;margin-top:6px">+ Add question</button>
      </div>
      <div class="jf-row">
        <div><label class="jf-label">Status</label>
          <select class="jf-input" id="job-status">
            <option value="open">Open</option>
            <option value="draft">Draft</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="in-btn ghost" id="job-cancel" style="flex:none;padding:11px 22px">Cancel</button>
        <button class="in-btn primary" id="job-save" style="flex:none;padding:11px 22px">${uuid ? "Save changes" : "Post job"}</button>
      </div>
    </div>`);
  wrap.appendChild(card);
  view.appendChild(wrap);

  $("job-emp").value = j.employment_type || "";
  $("job-remote").value = j.remote_policy || "";
  $("job-status").value = j.status || "open";

  // Salary toggle: on when the job already has a salary value.
  const salaryToggle = $("job-salary-on");
  const salaryFields = $("job-salary-fields");
  const hasSalary = (j.salary_min != null && j.salary_min !== "") || (j.salary_max != null && j.salary_max !== "");
  salaryToggle.checked = hasSalary;
  const syncSalary = () => { salaryFields.style.display = salaryToggle.checked ? "" : "none"; };
  syncSalary();
  salaryToggle.onchange = syncSalary;

  // Pay-period swaps the min/max labels + placeholders between annual and
  // hourly so the numbers the company types read sensibly.
  const payPeriodSel = $("job-pay-period");
  const syncPayPeriod = () => {
    const hourly = payPeriodSel.value === "hourly";
    $("job-smin-label").textContent = hourly ? "Min per hour" : "Min per year";
    $("job-smax-label").textContent = hourly ? "Max per hour" : "Max per year";
    $("job-smin").placeholder = hourly ? "20" : "80000";
    $("job-smax").placeholder = hourly ? "35" : "120000";
  };
  syncPayPeriod();
  payPeriodSel.onchange = syncPayPeriod;

  const descEditor = mountRichEditor("job-desc-editor", {
    placeholder: "Role, responsibilities, requirements…",
    html: j.description || "",
  });

  // ---- Applications settings ----
  const applyMethodSel = $("job-apply-method");
  applyMethodSel.value = j.apply_method || "native";
  const nativeOpts = $("job-native-opts");
  const syncApplyMethod = () => {
    nativeOpts.style.display = (applyMethodSel.value === "external") ? "none" : "";
  };
  syncApplyMethod();
  applyMethodSel.onchange = syncApplyMethod;

  // Seed resume/score toggles + questions from the normalized form.
  const seedForm = j.apply_form || { collect_resume: false, collect_score: true, questions: [] };
  $("job-collect-resume").checked = !!seedForm.collect_resume;
  $("job-collect-score").checked = seedForm.collect_score !== false;

  const qBox = $("job-questions");
  const addQuestionRow = (q = { label: "", type: "short_text", required: false }) => {
    if (qBox.children.length >= 10) return;
    const row = el(`
      <div class="jf-qrow" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input class="jf-input jf-q-label" style="flex:1" maxlength="160" placeholder="Question label" value="${esc(q.label || "")}">
        <select class="jf-input jf-q-type" style="flex:none;width:130px">
          <option value="short_text">Short text</option>
          <option value="long_text">Long text</option>
          <option value="url">URL</option>
        </select>
        <label class="jf-checkrow" style="flex:none;margin:0;white-space:nowrap"><input type="checkbox" class="jf-q-req"> Required</label>
        <button type="button" class="in-btn ghost jf-q-del" style="flex:none;padding:6px 10px">✕</button>
      </div>`);
    row.querySelector(".jf-q-type").value = q.type || "short_text";
    row.querySelector(".jf-q-req").checked = !!q.required;
    row.querySelector(".jf-q-del").onclick = () => row.remove();
    qBox.appendChild(row);
  };
  (seedForm.questions || []).forEach(addQuestionRow);
  $("job-add-q").onclick = () => addQuestionRow();

  // Build the apply_form payload object from the current controls.
  const collectApplyForm = () => {
    const questions = [];
    qBox.querySelectorAll(".jf-qrow").forEach(row => {
      const label = row.querySelector(".jf-q-label").value.trim();
      if (!label) return; // skip blank rows
      questions.push({
        label,
        type: row.querySelector(".jf-q-type").value,
        required: row.querySelector(".jf-q-req").checked,
      });
    });
    return {
      collect_resume: $("job-collect-resume").checked,
      collect_score: $("job-collect-score").checked,
      questions,
    };
  };

  const back = () => renderCompanyDashboard();
  $("job-back").onclick = back;
  $("job-cancel").onclick = back;

  $("job-save").onclick = async () => {
    const msg = $("job-msg"); msg.className = "in-set-msg";
    const salaryOn = salaryToggle.checked;
    const payload = {
      title: $("job-title").value.trim(),
      description: descEditor.getHTML(),
      location: $("job-loc").value.trim(),
      apply_url: $("job-apply").value.trim(),
      employment_type: $("job-emp").value,
      remote_policy: $("job-remote").value,
      // Send salary only when the toggle is on; otherwise clear it.
      salary_min: salaryOn ? $("job-smin").value : "",
      salary_max: salaryOn ? $("job-smax").value : "",
      salary_currency: salaryOn ? ($("job-scur").value.trim().toUpperCase() || "USD") : "USD",
      pay_period: salaryOn ? payPeriodSel.value : "annual",
      status: $("job-status").value,
      apply_method: applyMethodSel.value,
      accept_until: $("job-accept-until").value || "",
      // apply_form only meaningful when native applications are possible.
      apply_form: (applyMethodSel.value === "external") ? "" : JSON.stringify(collectApplyForm()),
    };
    if (!payload.title) { msg.textContent = "A job title is required."; msg.className = "in-set-msg err"; return; }
    if ((payload.apply_method === "external" || payload.apply_method === "both") && !payload.apply_url) {
      msg.textContent = "An external apply URL is required for that apply method."; msg.className = "in-set-msg err"; return;
    }

    const btn = $("job-save"); btn.disabled = true; btn.textContent = "Saving…";
    let r;
    if (uuid) { payload.uuid = uuid; r = await api("/jobs/update.php", "POST", payload); }
    else { r = await api("/jobs/create.php", "POST", payload); }

    if (r.ok && r.data?.success) { renderCompanyDashboard(); }
    else { msg.textContent = r.data?.error || "Could not save the job."; msg.className = "in-set-msg err"; btn.disabled = false; btn.textContent = uuid ? "Save changes" : "Post job"; }
  };
}

// ---- company profile editor -----------------------------------------
function openCompanyEdit() {
  const avatarState = { avatarUrl: CO.logo || null };
  openModal(`
    <h3>Edit company profile</h3>
    <div class="in-auth-msg" id="coe-msg"></div>
    <div id="coe-avatar"></div>
    <label>Company name</label><input id="coe-name" value="${esc(CO.name || "")}">
    <label>Description</label><textarea id="coe-desc" rows="4">${esc(CO.description || "")}</textarea>
    <div class="row">
      <div><label>Industry</label><input id="coe-industry" value="${esc(CO.industry || "")}"></div>
      <div><label>Website</label><input id="coe-website" value="${esc(CO.website || "")}"></div>
    </div>
    <div class="row">
      <div><label>City</label><input id="coe-city" value="${esc(CO.city || "")}"></div>
      <div><label>Country</label><select id="coe-country"></select></div>
    </div>
    <div id="coe-sub-wrap"></div>
    <label class="jf-checkrow" style="margin-top:16px">
      <input type="checkbox" id="coe-listing"${(CO.allow_employee_listing == 1 || CO.allow_employee_listing === undefined) ? " checked" : ""}>
      Allow users to list us as their employer
    </label>
    <div class="in-set-placeholder" style="margin:-2px 0 4px">When on, people can link your company in their job history via search.</div>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="coe-save">Save</button>
    </div>
  `);
  mountAvatarPicker("coe-avatar", avatarState, { shape: "square", fallbackChar: CO.name || "?" });
  geoInitCountryModal($("coe-country"), $("coe-sub-wrap"), { subId: "coe-sub", preselect: { country: CO.country || "", state: CO.state || "" } });
  $("coe-save").onclick = async () => {
    const msg = $("coe-msg"); msg.className = "in-auth-msg";
    const payload = {
      name: $("coe-name").value.trim(),
      description: $("coe-desc").value.trim(),
      industry: $("coe-industry").value.trim(),
      website: $("coe-website").value.trim(),
      city: $("coe-city").value.trim(),
      state: geoGetSubdivisionBy($("coe-sub-wrap"), "coe-sub"),
      country: $("coe-country").value.trim(),
      logo: avatarState.avatarUrl || "",
      allow_employee_listing: $("coe-listing").checked ? 1 : 0,
    };
    if (!payload.name) { msg.textContent = "Company name is required."; msg.className = "in-auth-msg show"; return; }
    const btn = $("coe-save"); btn.disabled = true; btn.textContent = "Saving…";
    const r = await api("/company/update.php", "POST", payload);
    if (r.ok && r.data?.success) {
      CO = { ...CO, ...r.data.data };
      closeModal();
      updateCompanyNav();
      // Refresh the top-right nav avatar with the new logo (no reload needed).
      if (typeof setNavAvatar === "function") {
        setNavAvatar(CO.logo, (CO.name || "?").charAt(0).toUpperCase());
      }
      renderCompanyDashboard();
    }
    else { msg.textContent = r.data?.error || "Could not save."; msg.className = "in-auth-msg show"; btn.disabled = false; btn.textContent = "Save"; }
  };
}

// ---- public company profile (#company/<uuid>) -----------------------
async function renderCompanyProfile(uuid) {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading company…</div>`;

  const [cr, jr] = await Promise.all([
    api("/company/get.php?uuid=" + encodeURIComponent(uuid)),
    api("/jobs/list.php?company=" + encodeURIComponent(uuid) + "&limit=50"),
  ]);
  if (!cr.ok || !cr.data?.success) {
    view.innerHTML = `<div class="in-card2"><div class="in-empty">This company could not be found.</div></div>`;
    return;
  }
  const c = cr.data.data;
  const jobs = (jr.ok && jr.data?.success) ? jr.data.data.jobs : [];
  const logoChar = (c.name || "?").charAt(0).toUpperCase();

  // Follow state + counts. Any signed-in identity can follow — a user,
  // or a company following another company. A company viewing its OWN
  // profile, or a signed-out visitor, sees no button.
  const canFollow = !!ME || (!!CO && CO.uuid !== uuid);
  let isFollowing = false, followerCount = 0;
  const [fstat, fcounts] = await Promise.all([
    canFollow ? api("/follow/status.php?type=company&uuid=" + encodeURIComponent(uuid)) : Promise.resolve(null),
    api("/follow/counts.php?type=company&uuid=" + encodeURIComponent(uuid)),
  ]);
  if (fstat && fstat.ok && fstat.data?.success) isFollowing = !!fstat.data.data.following;
  if (fcounts && fcounts.ok && fcounts.data?.success) followerCount = fcounts.data.data.followers ?? 0;

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);

  const since = c.created_at
    ? new Date(c.created_at.replace(" ", "T")).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "";

  const head = el(`
    <div class="in-card2">
      <div class="job-detail-head">
        <div class="job-logo lg">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : esc(logoChar)}</div>
        <div style="flex:1">
          <h1 style="margin:0 0 4px;font-size:24px;letter-spacing:-0.5px">${esc(c.name)}${c.is_verified ? ' <span class="post-tag" style="vertical-align:middle">Verified</span>' : ""}</h1>
          <div class="job-company" style="font-size:14.5px">${esc(c.industry || "")}${c.city ? " · " + esc(c.city) + (c.state ? ", " + esc(c.state) : "") : ""}</div>
          ${c.website ? `<a href="${esc(normalizeWebsite(c.website).href)}" target="_blank" rel="noopener noreferrer" style="font-size:13.5px;color:var(--in-accent);text-decoration:none">${esc(normalizeWebsite(c.website).text)} ↗</a>` : ""}
          <div class="co-meta-row"><span class="in-followcount">${followerCount} follower${followerCount === 1 ? "" : "s"}</span>${since ? `<span class="co-since">· Member since ${esc(since)}</span>` : ""}</div>
        </div>
        ${canFollow ? `<button class="in-follow-btn ${isFollowing ? "following" : ""}" id="cp-follow" style="width:auto;flex:none;margin-top:0;padding:9px 22px;align-self:flex-start">${isFollowing ? "Following" : "Follow"}</button>` : ""}
      </div>
    </div>`);
  wrap.appendChild(head);

  // About the company — same shared card as the dashboard. Owners can
  // edit it in place; visitors see nothing when there's no description.
  const isOwnerHere = !!c.is_owner && !!CO;
  wrap.appendChild(renderCompanyAbout(c.name, c.description, isOwnerHere, () => renderCompanyProfile(uuid)));

  const followBtn = head.querySelector("#cp-follow");
  if (followBtn) {
    followBtn.onclick = async () => {
      const following = followBtn.classList.contains("following");
      followBtn.disabled = true;
      const endpoint = following ? "/follow/unfollow.php" : "/follow/follow.php";
      const r = await api(endpoint, "POST", { target_type: "company", target_uuid: uuid });
      if (r.ok && r.data?.success) {
        followBtn.classList.toggle("following");
        const nowFollowing = followBtn.classList.contains("following");
        followBtn.textContent = nowFollowing ? "Following" : "Follow";
        // Update the follower count live.
        const cnt = head.querySelector(".in-followcount");
        const n = (parseInt(cnt.textContent, 10) || 0) + (nowFollowing ? 1 : -1);
        cnt.textContent = `${n} follower${n === 1 ? "" : "s"}`;
      } else {
        toast(r.data?.error || "Could not update follow status.", "err");
      }
      followBtn.disabled = false;
    };
  }

  const jobsCard = el(`<div class="in-card2"><h2 style="text-transform:none;font-size:18px">Open positions</h2><div id="cp-jobs"></div></div>`);
  wrap.appendChild(jobsCard);
  const jb = jobsCard.querySelector("#cp-jobs");
  if (!jobs.length) {
    jb.appendChild(el(`<div class="in-empty">No open positions right now.</div>`));
  } else {
    jobs.forEach(j => {
      const meta = [j.location || "", j.employment_type ? EMP_LABELS[j.employment_type] : "", j.remote_policy ? REMOTE_LABELS[j.remote_policy] : ""].filter(Boolean).join(" · ");
      const row = el(`<div class="in-item" role="button" tabindex="0" style="cursor:pointer"><div class="meta"><div class="t">${esc(j.title)}</div><div class="s">${esc(meta)}</div></div><span style="color:var(--in-muted);align-self:center">›</span></div>`);
      row.onclick = () => { location.hash = "job/" + j.uuid; };
      jb.appendChild(row);
    });
  }

  view.appendChild(wrap);

  // Posts by this company (public profile). Wrapped so a rendering error
  // can't take down the rest of the profile; the cause is logged.
  // Paged with a "See more" button (same shape as the user profile's
  // Activity feed) — previously this pulled the endpoint's legacy 50-post
  // cap in one shot, burying the rest of the profile and leaving post #51+
  // permanently unreachable.
  try {
    const COMPANY_POSTS_PAGE = 10;
    const postsCard = el(`<div class="in-card2"><h2 style="text-transform:none;font-size:18px">Posts</h2><div id="cp-posts"><div class="in-loading">Loading…</div></div></div>`);
    wrap.appendChild(postsCard);
    const pbox = postsCard.querySelector("#cp-posts");

    const fetchPage = (offset) => api(
      "/posts/personal.php?type=company&uuid=" + encodeURIComponent(uuid) +
      "&limit=" + COMPANY_POSTS_PAGE + "&offset=" + offset
    );

    const pr = await fetchPage(0);
    const pdata = pr.data?.data || {};
    const posts = pdata.posts || [];
    const author = pdata.author || { type: "company", uuid, name: c.name, avatar: c.logo };
    pbox.innerHTML = "";

    if (!posts.length) {
      pbox.appendChild(el(`<div class="in-empty">No posts yet.</div>`));
    } else {
      const listEl = el(`<div class="in-post-list" style="padding:0"></div>`);
      const addPosts = (rows) => rows.forEach(p => {
        try { listEl.appendChild(renderPost({ ...p, post_id: p.post_id ?? p.id, author })); }
        catch (err) { console.error("renderPost failed for company post", p, err); }
      });
      addPosts(posts);
      pbox.appendChild(listEl);

      let offset = posts.length;
      if (pdata.has_more) {
        const moreWrap = el(`<div class="feed-more-wrap"></div>`);
        const btn = el(`<button class="in-btn ghost feed-more">See more…</button>`);
        moreWrap.appendChild(btn);
        pbox.appendChild(moreWrap);

        btn.onclick = async () => {
          btn.disabled = true;
          btn.textContent = "Loading…";
          const r = await fetchPage(offset);
          if (!r.ok || !r.data?.success) {
            btn.disabled = false;
            btn.textContent = "See more…";
            toast("Could not load more posts.", "err");
            return;
          }
          const more = r.data.data.posts || [];
          offset += more.length;
          addPosts(more);
          if (r.data.data.has_more && more.length) {
            btn.disabled = false;
            btn.textContent = "See more…";
          } else {
            moreWrap.remove();
          }
        };
      }
    }
  } catch (err) {
    console.error("Company profile posts section failed:", err);
  }
}

// ===================================================================
// VIEW: COMPANY SETTINGS  (#company-settings)
// Mirrors the user settings layout: left nav + swappable panels.
// Tabs: Details (wired to company/update.php), Notifications (shared
// renderNotificationPrefs), and Account (sign out).
// ===================================================================
let CO_SETTINGS_TAB = "details";
let CO_SETTINGS_DATA = null;

async function renderCompanySettings() {
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading settings…</div>`;

  const [meRes, stRes] = await Promise.all([
    api("/company/me.php"),
    api("/company/settings-get.php"),
  ]);
  const me = meRes.data?.data || CO || {};
  CO_SETTINGS_DATA = { me, st: stRes.data?.data || {} };

  const tabs = [
    { key: "details",       label: "Company details" },
    { key: "appearance",    label: "Appearance" },
    { key: "publicprofile", label: "Public profile" },
    { key: "applications",  label: "Applications" },
    { key: "notifications", label: "Notifications" },
    { key: "account",       label: "Account" },
  ];
  if (!tabs.some(t => t.key === CO_SETTINGS_TAB)) CO_SETTINGS_TAB = "details";

  view.innerHTML = "";
  const wrap = el(`<div class="in-settings"></div>`);
  view.appendChild(wrap);
  const nav = el(`<div class="in-set-nav"></div>`);
  wrap.appendChild(nav);
  const panel = el(`<div class="in-set-panel"></div>`);
  wrap.appendChild(panel);

  const navButtons = {};
  tabs.forEach(t => {
    const b = el(`<button class="${t.key === CO_SETTINGS_TAB ? "active" : ""} ${t.key === "account" ? "danger" : ""}">${esc(t.label)}</button>`);
    b.onclick = () => {
      CO_SETTINGS_TAB = t.key;
      Object.values(navButtons).forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      paintCompanySettingsPanel(panel);
    };
    navButtons[t.key] = b;
    nav.appendChild(b);
  });

  paintCompanySettingsPanel(panel);
}

function paintCompanySettingsPanel(panel) {
  const { me, st } = CO_SETTINGS_DATA || { me: {}, st: {} };
  panel.innerHTML = "";
  if (CO_SETTINGS_TAB === "details")            renderCoSetDetails(panel, me);
  else if (CO_SETTINGS_TAB === "appearance")    renderCoSetAppearance(panel, st);
  else if (CO_SETTINGS_TAB === "publicprofile") renderCoSetPublicProfile(panel, st);
  else if (CO_SETTINGS_TAB === "applications")  renderCoSetApplications(panel, st);
  else if (CO_SETTINGS_TAB === "notifications") renderCoSetNotifications(panel, st);
  else if (CO_SETTINGS_TAB === "account")       renderCoSetAccount(panel);
}

function renderCoSetDetails(panel, me) {
  panel.appendChild(el(`
    <div class="in-set-section">
      <h3>Company details</h3>
      <label>Company name</label><input id="cos-name" value="${esc(me.name || "")}">
      <label>Industry</label><input id="cos-industry" value="${esc(me.industry || "")}">
      <div class="row" style="display:flex;gap:10px">
        <div style="flex:1"><label>City</label><input id="cos-city" value="${esc(me.city || "")}"></div>
        <div style="flex:1"><label>Country</label><select id="cos-country"></select></div>
      </div>
      <div id="cos-sub-wrap"></div>
      <label>Website</label><input id="cos-website" value="${esc(me.website || "")}" placeholder="https://example.com">
      <label>Email</label><input value="${esc(me.email || "")}" disabled title="Email changes require verification (coming soon)">
      <div class="in-set-actions"><button class="in-btn primary" style="flex:none;padding:10px 20px" id="cos-save">Save changes</button></div>
      <div class="in-set-msg" id="cos-msg"></div>
    </div>`));
  geoInitCountryModal($("cos-country"), $("cos-sub-wrap"), { subId: "cos-sub", preselect: { country: me.country || "", state: me.state || "" } });
  $("cos-save").onclick = async () => {
    const msg = $("cos-msg");
    const name = $("cos-name").value.trim();
    if (!name) { msg.className = "in-set-msg err"; msg.textContent = "Company name is required."; return; }
    const r = await api("/company/update.php", "POST", {
      name,
      industry: $("cos-industry").value.trim(),
      city: $("cos-city").value.trim(),
      state: geoGetSubdivisionBy($("cos-sub-wrap"), "cos-sub"),
      country: $("cos-country").value.trim(),
      website: $("cos-website").value.trim(),
    });
    if (r.ok && r.data?.success) {
      msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
      if (CO) { CO.name = name; CO.industry = $("cos-industry").value.trim(); }
      if (CO_SETTINGS_DATA) CO_SETTINGS_DATA.me = { ...CO_SETTINGS_DATA.me, ...(r.data.data || {}) };
      if (typeof updateCompanyNav === "function") updateCompanyNav();
    } else {
      msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save.";
    }
  };
}

// Small shared helper for company boolean toggles (mirrors the user side).
function coWireToggle(panel, id, key, msgId, onSaved) {
  const btn = panel.querySelector("#" + id);
  if (!btn) return;
  btn.onclick = async () => {
    const turningOn = !btn.classList.contains("on");
    btn.disabled = true;
    const r = await api("/company/settings-set.php", "POST", { key, value: turningOn ? "1" : "0" });
    btn.disabled = false;
    const msg = panel.querySelector("#" + msgId);
    if (r.ok && r.data?.success) {
      btn.classList.toggle("on", turningOn);
      btn.setAttribute("aria-checked", turningOn);
      if (CO_SETTINGS_DATA) CO_SETTINGS_DATA.st[key] = turningOn ? "1" : "0";
      if (onSaved) onSaved(turningOn);
      if (msg) { msg.className = "in-set-msg ok"; msg.textContent = "Saved."; }
    } else if (msg) { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
  };
}

// ---- Appearance tab: theme + reduced motion (both live) --------------
function renderCoSetAppearance(panel, st) {
  const theme = (st.theme === "dark" || st.theme === "light") ? st.theme : "system";
  const reduceOn = st.reduced_motion === "1";
  const opt = (val, label, sub) => `
    <button class="in-theme-opt ${theme === val ? "active" : ""}" data-theme-opt="${val}">
      <span class="in-theme-swatch tsw-${val}"></span>
      <span class="in-theme-opt-txt"><span class="in-theme-opt-label">${label}</span><span class="in-theme-opt-sub">${sub}</span></span>
    </button>`;
  panel.appendChild(el(`
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
        <button class="in-toggle ${reduceOn ? "on" : ""}" id="co-toggle-reduce-motion" role="switch" aria-checked="${reduceOn}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-msg" id="co-appearance-msg"></div>
    </div>`));

  panel.querySelectorAll("[data-theme-opt]").forEach(btn => {
    btn.onclick = async () => {
      const val = btn.dataset.themeOpt;
      panel.querySelectorAll("[data-theme-opt]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyTheme(val);   // live, instant
      if (CO_SETTINGS_DATA) CO_SETTINGS_DATA.st.theme = val;
      const r = await api("/company/settings-set.php", "POST", { key:"theme", value: val });
      const msg = panel.querySelector("#co-appearance-msg");
      if (r.ok && r.data?.success) { msg.className = "in-set-msg ok"; msg.textContent = "Saved."; }
      else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
    };
  });
  panel.querySelector("#co-toggle-reduce-motion").onclick = async () => {
    const btn = panel.querySelector("#co-toggle-reduce-motion");
    const turningOn = !btn.classList.contains("on");
    applyReducedMotion(turningOn);   // live
    btn.disabled = true;
    const r = await api("/company/settings-set.php", "POST", { key:"reduced_motion", value: turningOn ? "1" : "0" });
    btn.disabled = false;
    const msg = panel.querySelector("#co-appearance-msg");
    if (r.ok && r.data?.success) {
      btn.classList.toggle("on", turningOn);
      btn.setAttribute("aria-checked", turningOn);
      if (CO_SETTINGS_DATA) CO_SETTINGS_DATA.st.reduced_motion = turningOn ? "1" : "0";
      msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
    } else {
      applyReducedMotion(!turningOn);   // revert on failure
      msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save.";
    }
  };
}

// ---- Public profile tab: what shows on the company's public page -----
function renderCoSetPublicProfile(panel, st) {
  const showEmployees = st.show_employee_count !== "0";   // default on
  const showFollowers = st.show_follower_count !== "0";   // default on
  const showActivity  = st.show_activity_feed !== "0";    // default on
  panel.appendChild(el(`
    <div class="in-set-section">
      <h3>Public profile</h3>
      <div class="in-set-toggle-sub" style="margin-bottom:12px">Control what visitors see on your company page.</div>
      <div class="in-set-toggle">
        <div>
          <div class="in-set-toggle-label">Show employee count</div>
          <div class="in-set-toggle-sub">Display how many people list your company as their employer.</div>
        </div>
        <button class="in-toggle ${showEmployees ? "on" : ""}" id="co-toggle-employees" role="switch" aria-checked="${showEmployees}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-toggle" style="margin-top:16px">
        <div>
          <div class="in-set-toggle-label">Show follower count</div>
          <div class="in-set-toggle-sub">Display how many people and companies follow you.</div>
        </div>
        <button class="in-toggle ${showFollowers ? "on" : ""}" id="co-toggle-followers" role="switch" aria-checked="${showFollowers}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-toggle" style="margin-top:16px">
        <div>
          <div class="in-set-toggle-label">Show activity feed</div>
          <div class="in-set-toggle-sub">Display your recent posts on your public company page.</div>
        </div>
        <button class="in-toggle ${showActivity ? "on" : ""}" id="co-toggle-activity" role="switch" aria-checked="${showActivity}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-msg" id="co-pp-msg"></div>
    </div>`));
  coWireToggle(panel, "co-toggle-employees", "show_employee_count", "co-pp-msg");
  coWireToggle(panel, "co-toggle-followers", "show_follower_count", "co-pp-msg");
  coWireToggle(panel, "co-toggle-activity",  "show_activity_feed",  "co-pp-msg");
}

// ---- Applications tab: hiring preferences ----------------------------
function renderCoSetApplications(panel, st) {
  const defaultChannel = (st.default_apply_channel === "external") ? "external" : "native";
  const showScores = st.show_applicant_scores !== "0";   // default on
  const autoClose  = st.autoclose_filled === "1";        // default off (dormant)
  panel.appendChild(el(`
    <div class="in-set-section">
      <h3>Application preferences</h3>
      <div class="in-set-toggle-sub" style="margin-bottom:12px">Defaults applied when you post a new job. You can still override per job.</div>
      <label>Default apply method</label>
      <select id="co-apply-channel">
        <option value="native"${defaultChannel === "native" ? " selected" : ""}>Native — applicants apply through Integrally</option>
        <option value="external"${defaultChannel === "external" ? " selected" : ""}>External — send applicants to your own link</option>
      </select>
      <div class="in-set-toggle" style="margin-top:16px">
        <div>
          <div class="in-set-toggle-label">Show applicant self-scores</div>
          <div class="in-set-toggle-sub">When on, applicants' relevant self-scores appear in your ranked applicant list (only for applicants who chose to share them).</div>
        </div>
        <button class="in-toggle ${showScores ? "on" : ""}" id="co-toggle-scores" role="switch" aria-checked="${showScores}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-toggle" style="margin-top:16px">
        <div>
          <div class="in-set-toggle-label">Auto-close jobs when filled <span class="in-soon-pill">Coming soon</span></div>
          <div class="in-set-toggle-sub">Automatically stop accepting applications once you mark a role filled. Ships with the accept/reject flow.</div>
        </div>
        <button class="in-toggle ${autoClose ? "on" : ""}" id="co-toggle-autoclose" role="switch" aria-checked="${autoClose}"><span class="in-toggle-knob"></span></button>
      </div>
      <div class="in-set-msg" id="co-app-msg"></div>
    </div>`));
  panel.querySelector("#co-apply-channel").onchange = async (e) => {
    const val = e.target.value === "external" ? "external" : "native";
    const r = await api("/company/settings-set.php", "POST", { key:"default_apply_channel", value: val });
    const msg = panel.querySelector("#co-app-msg");
    if (r.ok && r.data?.success) {
      if (CO_SETTINGS_DATA) CO_SETTINGS_DATA.st.default_apply_channel = val;
      msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
    } else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
  };
  coWireToggle(panel, "co-toggle-scores",    "show_applicant_scores", "co-app-msg");
  coWireToggle(panel, "co-toggle-autoclose", "autoclose_filled",      "co-app-msg");
}

function renderCoSetNotifications(panel, st) {
  // Company-specific events (distinct from the user notification set).
  // In-app 'applicant' + 'follower' are live; email delivery is dormant.
  const on = (k) => st["notify_" + k] !== "0";       // default ON
  const emailOn = (k) => st["email_" + k] === "1";    // default OFF (dormant)
  const liveTypes = [
    { key: "applicant", label: "New applicants", sub: "When someone applies to one of your jobs." },
    { key: "follower",  label: "New followers",  sub: "When a person or company follows you." },
    { key: "message_request", label: "Message requests", sub: "When someone sends your company a message request." },
  ];
  const row = (t, kind, checked, disabled) => `
    <div class="in-set-toggle${disabled ? " disabled" : ""}" style="margin-top:14px">
      <div>
        <div class="in-set-toggle-label">${esc(t.label)}</div>
        <div class="in-set-toggle-sub">${esc(t.sub)}</div>
      </div>
      <button class="in-toggle ${checked ? "on" : ""}" data-conp="${kind}:${t.key}" role="switch" aria-checked="${checked}" ${disabled ? "disabled" : ""}><span class="in-toggle-knob"></span></button>
    </div>`;
  panel.appendChild(el(`
    <div class="in-set-section">
      <h3>In-app notifications</h3>
      <div class="in-set-toggle-sub" style="margin-bottom:4px">Control what shows up in your company's notification bell.</div>
      ${liveTypes.map(t => row(t, "app", on(t.key), false)).join("")}
    </div>
    <div class="in-set-section">
      <h3>Email notifications <span class="in-soon-pill">Coming soon</span></h3>
      <div class="in-set-toggle-sub" style="margin-bottom:4px">Email delivery isn't live yet — set your preferences now and they'll apply once it launches.</div>
      ${liveTypes.map(t => row(t, "email", emailOn(t.key), false)).join("")}
    </div>
    <div class="in-set-msg" id="co-notif-msg"></div>`));
  panel.querySelectorAll("[data-conp]").forEach(btn => {
    btn.onclick = async () => {
      const [kind, type] = btn.dataset.conp.split(":");
      const key = (kind === "email" ? "email_" : "notify_") + type;
      const turningOn = !btn.classList.contains("on");
      btn.disabled = true;
      const r = await api("/company/settings-set.php", "POST", { key, value: turningOn ? "1" : "0" });
      btn.disabled = false;
      const msg = panel.querySelector("#co-notif-msg");
      if (r.ok && r.data?.success) {
        btn.classList.toggle("on", turningOn);
        btn.setAttribute("aria-checked", turningOn);
        if (CO_SETTINGS_DATA) CO_SETTINGS_DATA.st[key] = turningOn ? "1" : "0";
        msg.className = "in-set-msg ok"; msg.textContent = "Saved.";
      } else { msg.className = "in-set-msg err"; msg.textContent = r.data?.error || "Could not save."; }
    };
  });
}

function renderCoSetAccount(panel) {
  panel.appendChild(el(`
    <div class="in-set-section change-account">
      <h3>Account</h3>
      <div class="in-danger-row">
        <div>
          <div class="in-set-toggle-label">Sign out</div>
          <div class="in-set-toggle-sub">Sign out of this company account on this device.</div>
        </div>
        <button class="in-btn ghost" style="flex:none;padding:9px 18px" id="cos-signout">Sign out</button>
      </div>
      <div class="in-danger-row">
        <div>
          <div class="in-set-toggle-label">Delete company</div>
          <div class="in-set-toggle-sub">Permanently delete this company and all its data. This can't be undone.</div>
        </div>
        <button class="in-btn" style="flex:none;padding:9px 18px;background:#fdecea;color:var(--in-error);border:1px solid #f5c6c0;opacity:.7;cursor:not-allowed" disabled title="Coming soon">Delete company</button>
      </div>
    </div>`));
  $("cos-signout").onclick = async () => {
    await api("/company/logout.php", "POST");
    CO = null; location.hash = ""; location.reload();
  };
}

// =====================================================================
// company.js — company accounts
//   CO global (company session), auth modals (register/login),
//   company dashboard (#company-dashboard) to manage profile + jobs,
//   and public company profile (#company/<uuid>).
//
//   Note: the app supports being signed in as a USER and a COMPANY at
//   the same time (separate sessions). CO holds the company session.
// =====================================================================

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
      if (links) links.appendChild(btn);
    }
    btn.style.display = "";
  } else if (btn) {
    btn.style.display = "none";
  }
}

// ---- company auth modals --------------------------------------------
function openCompanyAuth(mode = "login") {
  const isReg = mode === "register";
  openModal(`
    <h3>${isReg ? "Create a company account" : "Company sign in"}</h3>
    <div class="in-auth-msg" id="co-msg"></div>
    ${isReg ? `<label>Company name</label><input id="co-name" placeholder="Acme Inc.">` : ""}
    <label>Email</label><input id="co-email" type="email" placeholder="hr@acme.com">
    <label>Password</label><input id="co-pass" type="password" placeholder="${isReg ? "At least 8 characters" : "Your password"}">
    ${isReg ? `
      <div class="row">
        <div><label>Industry</label><input id="co-industry" placeholder="Software"></div>
        <div><label>Website</label><input id="co-website" placeholder="https://…"></div>
      </div>
      <div class="row">
        <div><label>City</label><input id="co-city"></div>
        <div><label>State</label><input id="co-state"></div>
      </div>` : ""}
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="co-submit">${isReg ? "Create account" : "Sign in"}</button>
    </div>
    <div style="text-align:center;margin-top:12px;font-size:13px;color:var(--in-muted)">
      ${isReg ? "Already have a company account?" : "Need a company account?"}
      <a href="#" id="co-switch" style="color:var(--in-accent);font-weight:600">${isReg ? "Sign in" : "Create one"}</a>
    </div>
  `);

  $("co-switch").onclick = (e) => { e.preventDefault(); openCompanyAuth(isReg ? "login" : "register"); };

  $("co-submit").onclick = async () => {
    const msg = $("co-msg");
    msg.className = "in-auth-msg";
    const email = $("co-email").value.trim();
    const password = $("co-pass").value;
    if (!email || !password) { msg.textContent = "Email and password are required."; msg.className = "in-auth-msg show"; return; }

    const btn = $("co-submit"); btn.disabled = true; btn.textContent = "Please wait…";
    let r;
    if (isReg) {
      const name = $("co-name").value.trim();
      if (!name) { msg.textContent = "Company name is required."; msg.className = "in-auth-msg show"; btn.disabled = false; btn.textContent = "Create account"; return; }
      r = await api("/company/register.php", "POST", {
        email, password, name,
        industry: $("co-industry").value.trim(),
        website: $("co-website").value.trim(),
        city: $("co-city").value.trim(),
        state: $("co-state").value.trim(),
      });
    } else {
      r = await api("/company/login.php", "POST", { login: email, password });
    }
    if (r.ok && r.data?.success) {
      closeModal();
      // Server enforces single identity (user session is now cleared).
      // Reload so the whole shell reflects the company identity.
      ME = null;
      location.hash = "company-dashboard";
      location.reload();
    } else {
      msg.textContent = r.data?.error || "Something went wrong.";
      msg.className = "in-auth-msg show";
      btn.disabled = false; btn.textContent = isReg ? "Create account" : "Sign in";
    }
  };
}
window.openCompanyAuth = openCompanyAuth;

// ---- company dashboard ----------------------------------------------
async function renderCompanyDashboard() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === "company-dashboard"));
  const view = $("view");

  if (!CO) {
    view.innerHTML = `
      <div class="in-card2" style="text-align:center;padding:50px 22px;max-width:480px;margin:30px auto">
        <h2 style="justify-content:center;text-transform:none;font-size:20px">Company accounts</h2>
        <div class="in-empty" style="font-style:normal;margin:8px 0 22px">
          Post jobs and build your company presence on Integrally.
        </div>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="in-btn primary" style="flex:none;padding:11px 22px" onclick="openCompanyAuth('register')">Create company account</button>
          <button class="in-btn ghost" style="flex:none;padding:11px 22px" onclick="openCompanyAuth('login')">Sign in</button>
        </div>
      </div>`;
    return;
  }

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  // Header card
  const logoChar = (CO.name || "?").charAt(0).toUpperCase();
  const head = el(`
    <div class="in-card2">
      <div class="job-detail-head">
        <div class="job-logo lg">${CO.logo ? `<img src="${esc(CO.logo)}" alt="">` : esc(logoChar)}</div>
        <div style="flex:1">
          <h1 style="margin:0 0 4px;font-size:22px;letter-spacing:-0.4px">${esc(CO.name)}</h1>
          <div class="job-company" style="font-size:14px">${esc(CO.industry || "")}${CO.city ? " · " + esc(CO.city) + (CO.state ? ", " + esc(CO.state) : "") : ""}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="in-btn ghost" style="flex:none;padding:8px 16px" id="co-edit">Edit profile</button>
          <button class="in-btn ghost" style="flex:none;padding:8px 16px" id="co-signout">Sign out</button>
        </div>
      </div>
    </div>`);
  wrap.appendChild(head);

  $("co-signout").onclick = async () => {
    await api("/company/logout.php", "POST");
    CO = null; updateCompanyNav();
    location.hash = "feed";
  };
  $("co-edit").onclick = () => openCompanyEdit();

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

  loadCompanyJobs();
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
    const row = el(`
      <div class="in-item">
        <div class="meta">
          <div class="t">${esc(j.title)} ${badge}</div>
          <div class="s">${esc(meta)}</div>
        </div>
        <button class="in-btn ghost" style="flex:none;padding:6px 12px" data-edit>Edit</button>
        <button class="del" data-del title="Delete">✕</button>
      </div>`);
    row.querySelector("[data-edit]").onclick = () => openJobEditor(j.uuid);
    row.querySelector("[data-del]").onclick = async () => {
      if (!confirm(`Delete "${j.title}"? This can't be undone.`)) return;
      const res = await api("/jobs/delete.php", "POST", { uuid: j.uuid });
      if (res.ok && res.data?.success) loadCompanyJobs();
      else alert(res.data?.error || "Could not delete the job.");
    };
    box.appendChild(row);
  });
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
      <textarea class="jf-input" id="job-desc" rows="6" placeholder="Role, responsibilities, requirements…">${esc(j.description || "")}</textarea>
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
      <div class="jf-row">
        <div><label class="jf-label">Salary min</label><input class="jf-input" id="job-smin" type="number" value="${j.salary_min ?? ""}" placeholder="80000"></div>
        <div><label class="jf-label">Salary max</label><input class="jf-input" id="job-smax" type="number" value="${j.salary_max ?? ""}" placeholder="120000"></div>
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

  const back = () => renderCompanyDashboard();
  $("job-back").onclick = back;
  $("job-cancel").onclick = back;

  $("job-save").onclick = async () => {
    const msg = $("job-msg"); msg.className = "in-set-msg";
    const payload = {
      title: $("job-title").value.trim(),
      description: $("job-desc").value.trim(),
      location: $("job-loc").value.trim(),
      apply_url: $("job-apply").value.trim(),
      employment_type: $("job-emp").value,
      remote_policy: $("job-remote").value,
      salary_min: $("job-smin").value,
      salary_max: $("job-smax").value,
      status: $("job-status").value,
    };
    if (!payload.title) { msg.textContent = "A job title is required."; msg.className = "in-set-msg err"; return; }

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
  openModal(`
    <h3>Edit company profile</h3>
    <div class="in-auth-msg" id="coe-msg"></div>
    <label>Company name</label><input id="coe-name" value="${esc(CO.name || "")}">
    <label>Description</label><textarea id="coe-desc" rows="4">${esc(CO.description || "")}</textarea>
    <div class="row">
      <div><label>Industry</label><input id="coe-industry" value="${esc(CO.industry || "")}"></div>
      <div><label>Website</label><input id="coe-website" value="${esc(CO.website || "")}"></div>
    </div>
    <div class="row">
      <div><label>City</label><input id="coe-city" value="${esc(CO.city || "")}"></div>
      <div><label>State</label><input id="coe-state" value="${esc(CO.state || "")}"></div>
    </div>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="coe-save">Save</button>
    </div>
  `);
  $("coe-save").onclick = async () => {
    const msg = $("coe-msg"); msg.className = "in-auth-msg";
    const payload = {
      name: $("coe-name").value.trim(),
      description: $("coe-desc").value.trim(),
      industry: $("coe-industry").value.trim(),
      website: $("coe-website").value.trim(),
      city: $("coe-city").value.trim(),
      state: $("coe-state").value.trim(),
    };
    if (!payload.name) { msg.textContent = "Company name is required."; msg.className = "in-auth-msg show"; return; }
    const btn = $("coe-save"); btn.disabled = true; btn.textContent = "Saving…";
    const r = await api("/company/update.php", "POST", payload);
    if (r.ok && r.data?.success) { CO = { ...CO, ...r.data.data }; closeModal(); updateCompanyNav(); renderCompanyDashboard(); }
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

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);

  wrap.appendChild(el(`
    <div class="in-card2">
      <div class="job-detail-head">
        <div class="job-logo lg">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : esc(logoChar)}</div>
        <div style="flex:1">
          <h1 style="margin:0 0 4px;font-size:24px;letter-spacing:-0.5px">${esc(c.name)}${c.is_verified ? ' <span class="post-tag" style="vertical-align:middle">Verified</span>' : ""}</h1>
          <div class="job-company" style="font-size:14.5px">${esc(c.industry || "")}${c.city ? " · " + esc(c.city) + (c.state ? ", " + esc(c.state) : "") : ""}</div>
          ${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener noreferrer" style="font-size:13.5px;color:var(--in-accent);text-decoration:none">${esc(c.website)} ↗</a>` : ""}
        </div>
      </div>
      ${c.description ? `<div class="job-desc" style="margin-top:14px">${esc(c.description).replace(/\n/g, "<br>")}</div>` : ""}
    </div>`));

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
}
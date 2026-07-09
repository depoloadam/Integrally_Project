// =====================================================================
// jobs.js — Jobs board (#jobs route) and job detail (#job/<uuid>)
//   Public browsing with search + filters. Company owners get edit/
//   delete controls on their own postings via the company dashboard.
// =====================================================================

let JOBS_STATE = { q: "", location: "", employment_type: "", remote_policy: "", page: 1, limit: 20 };

const EMP_LABELS = {
  full_time: "Full-time", part_time: "Part-time", contract: "Contract",
  internship: "Internship", temporary: "Temporary",
};
const REMOTE_LABELS = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" };

function fmtSalary(min, max, cur) {
  if (min == null && max == null) return "";
  const c = (n) => n.toLocaleString("en-US", { style: "currency", currency: cur || "USD", maximumFractionDigits: 0 });
  if (min != null && max != null) return `${c(min)} – ${c(max)}`;
  return min != null ? `From ${c(min)}` : `Up to ${c(max)}`;
}

async function renderJobs() {
  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  // CTA: route to dashboard if already a company, else open signup.
  const cta = el(`
    <div class="in-announce" style="background:linear-gradient(135deg,#0e3b4a,#0a8a8a)">
      <span>Hiring? Post your roles and reach candidates on Integrally.</span>
      <button class="in-btn" id="jobs-cta" style="flex:none;margin-left:auto;background:#fff;color:var(--in-accent);padding:8px 16px">${CO ? "Go to dashboard" : "Post a job →"}</button>
    </div>`);
  wrap.appendChild(cta);
  cta.querySelector("#jobs-cta").onclick = () => {
    if (CO) { location.hash = "company-dashboard"; return; }
    goCompanyAuth(true);   // navigates to company.html#register (confirms if a user is signed in)
  };

  wrap.appendChild(el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px">Jobs</h2>
      <div class="in-admin-toolbar" style="flex-wrap:wrap">
        <input type="text" id="jobs-q" placeholder="Search title, company, keyword…" value="${esc(JOBS_STATE.q)}" style="min-width:200px">
        <input type="text" id="jobs-loc" placeholder="Location" value="${esc(JOBS_STATE.location)}" style="max-width:160px;flex:none">
        <select id="jobs-emp">
          <option value="">Any type</option>
          <option value="full_time">Full-time</option>
          <option value="part_time">Part-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
          <option value="temporary">Temporary</option>
        </select>
        <select id="jobs-remote">
          <option value="">Anywhere</option>
          <option value="onsite">On-site</option>
          <option value="hybrid">Hybrid</option>
          <option value="remote">Remote</option>
        </select>
      </div>
      <div id="jobs-list"></div>
      <div class="in-admin-pager" id="jobs-pager"></div>
    </div>`));

  $("jobs-emp").value = JOBS_STATE.employment_type;
  $("jobs-remote").value = JOBS_STATE.remote_policy;

  const reload = () => { JOBS_STATE.page = 1; loadJobs(); };
  $("jobs-q").addEventListener("input", debounce(() => { JOBS_STATE.q = $("jobs-q").value.trim(); reload(); }, 350));
  $("jobs-loc").addEventListener("input", debounce(() => { JOBS_STATE.location = $("jobs-loc").value.trim(); reload(); }, 350));
  $("jobs-emp").onchange = () => { JOBS_STATE.employment_type = $("jobs-emp").value; reload(); };
  $("jobs-remote").onchange = () => { JOBS_STATE.remote_policy = $("jobs-remote").value; reload(); };

  loadJobs();
}

async function loadJobs() {
  const list = $("jobs-list");
  const pager = $("jobs-pager");
  list.innerHTML = `<div class="in-loading">Loading jobs…</div>`;

  const params = new URLSearchParams({ page: JOBS_STATE.page, limit: JOBS_STATE.limit });
  if (JOBS_STATE.q) params.set("q", JOBS_STATE.q);
  if (JOBS_STATE.location) params.set("location", JOBS_STATE.location);
  if (JOBS_STATE.employment_type) params.set("employment_type", JOBS_STATE.employment_type);
  if (JOBS_STATE.remote_policy) params.set("remote_policy", JOBS_STATE.remote_policy);

  const r = await api("/jobs/list.php?" + params.toString());
  if (!r.ok || !r.data?.success) { list.innerHTML = `<div class="in-empty">Could not load jobs.</div>`; pager.innerHTML = ""; return; }

  const { jobs, total, page, limit } = r.data.data;
  if (!jobs.length) { list.innerHTML = `<div class="in-empty">No jobs match your search.</div>`; pager.innerHTML = ""; return; }

  list.innerHTML = "";
  jobs.forEach(j => {
    const tags = [
      j.location || "",
      j.remote_policy ? REMOTE_LABELS[j.remote_policy] : "",
      j.employment_type ? EMP_LABELS[j.employment_type] : "",
    ].filter(Boolean);
    const salary = fmtSalary(j.salary_min, j.salary_max, j.salary_currency);
    const logoChar = (j.company_name || "?").charAt(0).toUpperCase();

    const row = el(`
      <div class="job-row" role="button" tabindex="0">
        <div class="job-logo">${j.company_logo ? `<img src="${esc(j.company_logo)}" alt="">` : esc(logoChar)}</div>
        <div class="job-main">
          <div class="job-title">${esc(j.title)}</div>
          <div class="job-company">${esc(j.company_name)}${j.company_industry ? " · " + esc(j.company_industry) : ""}</div>
          ${salary ? `<div class="job-salary-sm">${esc(salary)}</div>` : ""}
          <div class="job-tags">${tags.map(t => `<span class="job-tag">${esc(t)}</span>`).join("")}</div>
        </div>
      </div>`);
    const go = () => { location.hash = "job/" + j.uuid; };
    row.addEventListener("click", go);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    list.appendChild(row);
  });

  const totalPages = Math.max(1, Math.ceil(total / limit));
  pager.innerHTML = "";
  if (totalPages > 1) {
    const prev = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>`);
    const info = el(`<span class="in-admin-pageinfo">Page ${page} of ${totalPages} · ${total} jobs</span>`);
    const next = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page >= totalPages ? "disabled" : ""}>Next ›</button>`);
    prev.onclick = () => { JOBS_STATE.page = Math.max(1, page - 1); loadJobs(); };
    next.onclick = () => { JOBS_STATE.page = Math.min(totalPages, page + 1); loadJobs(); };
    pager.append(prev, info, next);
  }
}

async function renderJobDetail(uuid) {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  const view = $("view");
  view.innerHTML = `<div class="in-loading">Loading job…</div>`;

  const r = await api("/jobs/get.php?uuid=" + encodeURIComponent(uuid));
  if (!r.ok || !r.data?.success) {
    view.innerHTML = `<div class="in-card2"><div class="in-back"><button class="in-back-btn" onclick="location.hash='jobs'">‹ Back to jobs</button></div><div class="in-empty">This job could not be found.</div></div>`;
    return;
  }
  const j = r.data.data;
  const c = j.company;
  const tags = [
    j.location || "",
    j.remote_policy ? REMOTE_LABELS[j.remote_policy] : "",
    j.employment_type ? EMP_LABELS[j.employment_type] : "",
  ].filter(Boolean);
  const salary = fmtSalary(j.salary_min, j.salary_max, j.salary_currency);
  const logoChar = (c.name || "?").charAt(0).toUpperCase();

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  wrap.appendChild(el(`<div class="in-back"><button class="in-back-btn" onclick="location.hash='jobs'">‹ Back to jobs</button></div>`));

  const card = el(`
    <div class="in-card2">
      <div class="job-detail-head">
        <div class="job-logo lg">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : esc(logoChar)}</div>
        <div>
          <h1 style="margin:0 0 4px;font-size:22px;letter-spacing:-0.4px">${esc(j.title)}</h1>
          <div class="job-company" style="font-size:14.5px">
            <a href="#company/${esc(c.uuid)}" style="color:var(--in-accent);font-weight:600;text-decoration:none">${esc(c.name)}</a>${c.industry ? " · " + esc(c.industry) : ""}
          </div>
          ${salary ? `<div class="job-salary-sm">${esc(salary)}</div>` : ""}
          ${j.status !== "open" ? `<span class="in-admin-badge off" style="margin-top:8px;display:inline-block">${esc(j.status)}</span>` : ""}
        </div>
      </div>
      <div class="job-tags" style="margin:14px 0">${tags.map(t => `<span class="job-tag">${esc(t)}</span>`).join("")}</div>
      ${j.description ? `<div class="job-desc">${esc(j.description).replace(/\n/g, "<br>")}</div>` : `<div class="in-empty">No description provided.</div>`}
      <div class="job-apply-row"></div>
    </div>`);

  const applyRow = card.querySelector(".job-apply-row");
  renderApplyRow(applyRow, j);

  wrap.appendChild(card);
  view.appendChild(wrap);
}

// Apply controls: depend on apply_method, whether the viewer is a
// signed-in user, the owner, or has already applied.
function renderApplyRow(applyRow, j) {
  const method = j.apply_method || "native";
  const canNative = method === "native" || method === "both";
  const canExternal = (method === "external" || method === "both") && j.apply_url;

  // Owner viewing their own posting: show applicant count + link, no apply.
  if (j.is_owner) {
    const n = j.applicant_count || 0;
    applyRow.appendChild(el(
      `<a class="in-follow-btn" style="display:inline-block;width:auto;padding:11px 28px;text-decoration:none;text-align:center"
          href="#company-dashboard">View ${n} applicant${n === 1 ? "" : "s"} →</a>`));
    return;
  }

  if (j.status !== "open") {
    applyRow.appendChild(el(`<div class="in-empty">This job is no longer accepting applications.</div>`));
    return;
  }

  // Native quick-apply (users only).
  if (canNative) {
    if (!ME && !CO) {
      applyRow.appendChild(el(`<div class="in-empty">Sign in to apply on Integrally.</div>`));
    } else if (CO) {
      applyRow.appendChild(el(`<div class="in-empty">Applications come from personal accounts.</div>`));
    } else if (j.has_applied) {
      applyRow.appendChild(el(`<span class="in-follow-btn following" style="display:inline-block;width:auto;padding:11px 28px;text-align:center">✓ Applied</span>`));
    } else {
      const btn = el(`<button class="in-follow-btn" style="width:auto;padding:11px 28px">Quick apply</button>`);
      btn.onclick = () => openApplyModal(j);
      applyRow.appendChild(btn);
    }
  }

  // External link (in addition to, or instead of, native).
  if (canExternal) {
    const label = canNative ? "Apply on company site ↗" : "Apply ↗";
    const style = canNative
      ? "display:inline-block;width:auto;padding:11px 28px;margin-left:10px;text-decoration:none;text-align:center;background:none;color:var(--in-accent);border:1px solid var(--in-accent)"
      : "display:inline-block;width:auto;padding:11px 28px;text-decoration:none;text-align:center";
    applyRow.appendChild(el(
      `<a class="in-follow-btn" style="${style}" href="${esc(j.apply_url)}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  }

  if (!canNative && !canExternal) {
    applyRow.appendChild(el(`<div class="in-empty">To apply, visit the company's website or contact them directly.</div>`));
  }
}

// ---- native quick-apply modal -----------------------------------------
function openApplyModal(j) {
  const form = j.apply_form || { collect_resume: false, collect_score: true, questions: [] };
  const questions = form.questions || [];

  const qHtml = questions.map((q, i) => {
    const req = q.required ? ` <span style="color:var(--in-error)">*</span>` : "";
    const field = q.type === "long_text"
      ? `<textarea id="ap-q${i}" rows="3" maxlength="5000" class="in-msg-compose"></textarea>`
      : `<input id="ap-q${i}" type="${q.type === "url" ? "url" : "text"}" maxlength="5000" placeholder="${q.type === "url" ? "https://…" : ""}">`;
    return `<div style="margin-bottom:12px"><label>${esc(q.label)}${req}</label>${field}</div>`;
  }).join("");

  const resumeHtml = form.collect_resume ? `
    <div style="margin-bottom:12px">
      <label>Resume</label>
      <div class="ep-check-group" style="display:flex;flex-direction:column;gap:6px">
        <label class="ep-check"><input type="radio" name="ap-resume" value="current" checked> Use my current resume</label>
        <label class="ep-check"><input type="radio" name="ap-resume" value="upload"> Upload a different file</label>
        <label class="ep-check"><input type="radio" name="ap-resume" value="none"> Don't include a resume</label>
      </div>
      <input type="file" id="ap-resume-file" accept=".pdf,.doc,.docx" style="display:none;margin-top:8px">
    </div>` : "";

  openModal(`
    <h2>Apply — ${esc(j.title)}</h2>
    ${form.collect_score ? `<p class="in-msg-modal-hint">Your Integrally score for this role will be included with your application.</p>` : ""}
    ${qHtml || (!form.collect_resume ? `<p class="in-msg-modal-hint">This is a one-click application. The company will see your profile${form.collect_score ? " and score" : ""}.</p>` : "")}
    ${resumeHtml}
    <div class="in-set-msg" id="ap-err"></div>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="ap-submit">Submit application</button>
    </div>`);

  // Show the file picker only when "upload" is chosen.
  if (form.collect_resume) {
    document.querySelectorAll('input[name="ap-resume"]').forEach(radio => {
      radio.onchange = () => {
        const fileInput = $("ap-resume-file");
        if (fileInput) fileInput.style.display = (radio.value === "upload" && radio.checked) ? "block" : "none";
      };
    });
  }

  $("ap-submit").onclick = async () => {
    const errEl = $("ap-err");
    errEl.textContent = "";

    // Collect answers.
    const answers = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const v = ($("ap-q" + i)?.value || "").trim();
      if (q.required && !v) { errEl.textContent = `Please answer: "${q.label}".`; return; }
      if (v) answers[q.key] = v;
    }

    const btn = $("ap-submit");
    btn.disabled = true;

    let resumeSource = "none";
    if (form.collect_resume) {
      const picked = document.querySelector('input[name="ap-resume"]:checked');
      resumeSource = picked ? picked.value : "current";
    }

    let r;
    if (resumeSource === "upload") {
      const file = $("ap-resume-file").files[0];
      if (!file) { errEl.textContent = "Choose a file to upload, or pick another resume option."; btn.disabled = false; return; }
      const fd = new FormData();
      fd.append("job_uuid", j.uuid);
      fd.append("answers", JSON.stringify(answers));
      fd.append("resume_source", "upload");
      fd.append("resume", file);
      try {
        const res = await fetch(API_BASE + "/applications/apply.php", { method: "POST", credentials: "include", body: fd });
        r = { ok: res.ok, data: await res.json() };
      } catch (e) { r = { ok: false, data: { error: "Upload failed." } }; }
    } else {
      r = await api("/applications/apply.php", "POST",
        { job_uuid: j.uuid, answers, resume_source: resumeSource });
    }

    btn.disabled = false;
    if (r.ok && r.data?.success) {
      closeModal();
      renderJobDetail(j.uuid);   // repaint -> shows "✓ Applied"
    } else {
      errEl.textContent = r.data?.error || "Could not submit your application.";
    }
  };
}
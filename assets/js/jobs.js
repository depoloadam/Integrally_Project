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

function fmtSalary(min, max, cur, period) {
  if (min == null && max == null) return "";
  const hourly = period === "hourly";
  const c = (n) => n.toLocaleString("en-US", { style: "currency", currency: cur || "USD", maximumFractionDigits: hourly ? 2 : 0 });
  const suf = hourly ? "/hr" : "/yr";
  if (min != null && max != null) return `${c(min)} – ${c(max)}${suf}`;
  return min != null ? `From ${c(min)}${suf}` : `Up to ${c(max)}${suf}`;
}

async function renderJobs() {
  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  // CTA "Hiring?" box: shown to companies and logged-out visitors, but
  // NOT to signed-in end users (a job seeker doesn't need a post-a-job pitch).
  if (!ME) {
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
  }

  wrap.appendChild(el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px">Jobs</h2>
      ${ME ? `<div class="in-feedtabs" id="jobs-tabs" style="margin-bottom:14px">
        <button data-jtab="browse" class="active">Browse jobs</button>
        <button data-jtab="mine">My applications</button>
      </div>` : ""}
      <div id="jobs-browse">
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
      </div>
      <div id="jobs-mine" style="display:none"></div>
    </div>`));

  $("jobs-emp").value = JOBS_STATE.employment_type;
  $("jobs-remote").value = JOBS_STATE.remote_policy;

  const reload = () => { JOBS_STATE.page = 1; loadJobs(); };
  $("jobs-q").addEventListener("input", debounce(() => { JOBS_STATE.q = $("jobs-q").value.trim(); reload(); }, 350));
  $("jobs-loc").addEventListener("input", debounce(() => { JOBS_STATE.location = $("jobs-loc").value.trim(); reload(); }, 350));
  $("jobs-emp").onchange = () => { JOBS_STATE.employment_type = $("jobs-emp").value; reload(); };
  $("jobs-remote").onchange = () => { JOBS_STATE.remote_policy = $("jobs-remote").value; reload(); };

  // Browse / My applications tab switch (signed-in end users only).
  const tabs = $("jobs-tabs");
  if (tabs) {
    tabs.querySelectorAll("[data-jtab]").forEach(b => {
      b.onclick = () => {
        tabs.querySelectorAll("[data-jtab]").forEach(x => x.classList.toggle("active", x === b));
        const browse = b.dataset.jtab === "browse";
        $("jobs-browse").style.display = browse ? "" : "none";
        $("jobs-mine").style.display = browse ? "none" : "";
        if (!browse && typeof renderApplicationsInto === "function") {
          // Reload each time so statuses (expired etc.) stay fresh.
          renderApplicationsInto($("jobs-mine"), {
            empty: `You haven't applied to any jobs yet. Switch to <b>Browse jobs</b> to get started.`,
            onWithdraw: () => renderApplicationsInto($("jobs-mine"), { empty: `You haven't applied to any jobs yet. Switch to <b>Browse jobs</b> to get started.` }),
          });
        }
      };
    });
  }

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
    const salary = fmtSalary(j.salary_min, j.salary_max, j.salary_currency, j.pay_period);
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
  const salary = fmtSalary(j.salary_min, j.salary_max, j.salary_currency, j.pay_period);
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
    const extLink = el(
      `<a class="in-follow-btn" style="${style}" href="${esc(j.apply_url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    applyRow.appendChild(extLink);

    // A small "mark as applied" affordance, so the candidate can track
    // an off-platform application. Only meaningful for signed-in users.
    if (ME) {
      const markWrap = el(`<div class="job-extmark" style="margin-top:10px"></div>`);
      applyRow.appendChild(markWrap);

      const renderMarked = () => {
        markWrap.innerHTML = `<span class="in-set-msg ok" style="margin:0">✓ Marked as applied on the company site. See it under <a href="#jobs" style="color:var(--in-accent)">My applications</a>.</span>`;
      };
      const renderPrompt = (visible) => {
        markWrap.innerHTML = "";
        const q = el(`<button class="job-extmark-btn" style="background:none;border:none;color:var(--in-muted);font-family:inherit;font-size:13px;cursor:pointer;padding:0;text-decoration:underline">Applied there? Mark it as applied</button>`);
        q.style.opacity = visible ? "1" : ".65";
        q.onclick = async () => {
          q.disabled = true;
          const r = await api("/applications/apply.php", "POST", { job_uuid: j.uuid, apply_channel: "external" });
          if (r.ok && r.data?.success) renderMarked();
          else { q.disabled = false; alert(r.data?.error || "Could not mark as applied."); }
        };
        markWrap.appendChild(q);
      };

      if (j.has_marked_external) renderMarked();
      else {
        renderPrompt(false);
        // Clicking the external link surfaces the prompt more prominently.
        extLink.addEventListener("click", () => { if (!j.has_marked_external) renderPrompt(true); });
      }
    }
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
        <label class="ep-check" id="ap-resume-current-wrap"><input type="radio" name="ap-resume" value="current" checked> <span id="ap-resume-current-label">Use my current resume</span></label>
        <label class="ep-check"><input type="radio" name="ap-resume" value="upload"> Upload a different file</label>
        <label class="ep-check"><input type="radio" name="ap-resume" value="none"> Don't include a resume</label>
      </div>
      <input type="file" id="ap-resume-file" accept=".pdf,.doc,.docx" style="display:none;margin-top:8px">
    </div>` : "";

  // Contact box: shows the applicant which contact details the company will
  // be able to see, and lets them fix them inline before submitting. Values
  // are loaded live from the profile after the modal opens.
  const contactHtml = `
    <div class="ap-contact" id="ap-contact">
      <div class="ap-contact-head">
        <span>📇 Contact info shared with this employer</span>
        <button type="button" class="ap-contact-edit" id="ap-contact-edit">Edit</button>
      </div>
      <div class="ap-contact-body" id="ap-contact-view">
        <div class="in-loading" style="padding:4px 0;font-size:13px">Loading…</div>
      </div>
    </div>`;

  openModal(`
    <h2>Apply — ${esc(j.title)}</h2>
    ${form.collect_score ? `<p class="in-msg-modal-hint">Your Integrally score for this role will be included with your application.</p>` : ""}
    ${qHtml || (!form.collect_resume ? `<p class="in-msg-modal-hint">This is a one-click application. The company will see your profile${form.collect_score ? " and score" : ""}.</p>` : "")}
    ${resumeHtml}
    ${contactHtml}
    <div class="in-set-msg" id="ap-err"></div>
    <div class="in-modal-actions">
      <button class="in-btn ghost" onclick="closeModal()">Cancel</button>
      <button class="in-btn primary" id="ap-submit">Submit application</button>
    </div>`);

  loadApplyContact();

  // Show the file picker only when "upload" is chosen.
  if (form.collect_resume) {
    document.querySelectorAll('input[name="ap-resume"]').forEach(radio => {
      radio.onchange = () => {
        const fileInput = $("ap-resume-file");
        if (fileInput) fileInput.style.display = (radio.value === "upload" && radio.checked) ? "block" : "none";
      };
    });

    // Populate the "current resume" row with the actual file on record so
    // the user can verify what they're attaching (previously a blind
    // choice). If there's no resume on file, that option can't be used —
    // disable it and fall the selection back to "Upload a different file".
    loadApplyCurrentResume();
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
        // Multipart bypasses api(), so the 429 handler has to be called by hand.
        if (res.status === 429) handleRateLimited(r.data);
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

// Fills the apply modal's contact box with the applicant's live email +
// phone (from their profile), and offers an inline edit so they can fix the
// number before submitting. Editing saves straight to the profile, which is
// the source of truth the employer later reads — there's no separate
// snapshot, so what they confirm here is exactly what the company sees.
async function loadApplyContact() {
  const view = $("ap-contact-view");
  if (!view) return;
  const r = await api("/profile/get.php");
  if (!$("ap-contact-view")) return;   // modal closed while loading
  const p = r.data?.data || {};
  const email = p.email || "";
  let phone = p.phone || "";

  const render = () => {
    const v = $("ap-contact-view");
    if (!v) return;
    v.innerHTML = `
      <div class="ap-contact-line"><span class="ap-contact-k">Email</span><span class="ap-contact-val">${email ? esc(email) : "<em style='color:var(--in-muted)'>none on file</em>"}</span></div>
      <div class="ap-contact-line"><span class="ap-contact-k">Phone</span><span class="ap-contact-val">${phone ? esc(phone) : "<em style='color:var(--in-muted)'>none on file</em>"}</span></div>
      <div class="ap-contact-note">The company can view this after you apply. Email is always shared; phone only if you provide one.</div>`;
  };
  render();

  const editBtn = $("ap-contact-edit");
  if (editBtn) editBtn.onclick = () => {
    const v = $("ap-contact-view");
    if (!v) return;
    // Email is account-level (changed via settings), so only phone is
    // editable inline here.
    v.innerHTML = `
      <div class="ap-contact-line"><span class="ap-contact-k">Email</span><span class="ap-contact-val">${email ? esc(email) : "<em style='color:var(--in-muted)'>none on file</em>"}</span></div>
      <div class="ap-contact-edit-row">
        <label class="ap-contact-k" for="ap-phone-edit">Phone</label>
        <input id="ap-phone-edit" type="tel" value="${esc(phone)}" placeholder="+1 (555) 123-4567">
      </div>
      <div class="ap-contact-editnote" id="ap-contact-editnote"></div>
      <div class="ap-contact-edit-actions">
        <button type="button" class="in-btn ghost" id="ap-phone-cancel" style="padding:6px 12px">Cancel</button>
        <button type="button" class="in-btn primary" id="ap-phone-save" style="padding:6px 12px">Save phone</button>
      </div>`;
    editBtn.style.display = "none";
    $("ap-phone-cancel").onclick = () => { editBtn.style.display = ""; render(); };
    $("ap-phone-save").onclick = async () => {
      const val = $("ap-phone-edit").value.trim();
      const note = $("ap-contact-editnote");
      const btn = $("ap-phone-save");
      btn.disabled = true;
      const res = await api("/profile/update.php", "POST", { phone: val });
      btn.disabled = false;
      if (res.ok && res.data?.success) {
        phone = val;   // reflect saved value
        editBtn.style.display = "";
        render();
      } else {
        note.textContent = res.data?.error || "Could not save phone.";
        note.className = "ap-contact-editnote err";
      }
    };
  };
}

// Fills the "Use my current resume" row in the apply modal with the real
// file on record — its name plus a View link (opens the private
// resume-download endpoint) — so the applicant can verify what they're
// attaching instead of choosing blind. When there's no resume on file,
// that option is unusable: it's disabled, relabeled, and the selection
// falls back to "Upload a different file".
async function loadApplyCurrentResume() {
  const wrap = $("ap-resume-current-wrap");
  const label = $("ap-resume-current-label");
  if (!wrap || !label) return;

  const r = await api("/profile/get.php");
  // Modal may have been closed/replaced while the request was in flight.
  if (!$("ap-resume-current-label")) return;

  const resume = r.data?.data?.resume || null;
  const radio = wrap.querySelector('input[name="ap-resume"]');

  if (resume && resume.name) {
    // Show the filename and a View link next to the option.
    label.innerHTML =
      `Use my current resume ` +
      `<a href="${API_BASE}/profile/resume-download.php" target="_blank" rel="noopener" ` +
      `class="ap-resume-view" onclick="event.stopPropagation()">Download</a>` +
      `<span class="ap-resume-name">${esc(resume.name)}</span>`;
  } else {
    // Nothing on file — disable this option and move the default to Upload.
    label.textContent = "No resume on file";
    wrap.classList.add("ap-resume-disabled");
    if (radio) {
      radio.disabled = true;
      radio.checked = false;
    }
    const uploadRadio = document.querySelector('input[name="ap-resume"][value="upload"]');
    if (uploadRadio) {
      uploadRadio.checked = true;
      const fileInput = $("ap-resume-file");
      if (fileInput) fileInput.style.display = "block";
    }
  }
}
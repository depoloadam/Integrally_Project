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
          <div class="job-tags">${tags.map(t => `<span class="job-tag">${esc(t)}</span>`).join("")}</div>
        </div>
        ${salary ? `<div class="job-salary">${esc(salary)}</div>` : ""}
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
          ${j.status !== "open" ? `<span class="in-admin-badge off" style="margin-top:8px;display:inline-block">${esc(j.status)}</span>` : ""}
        </div>
      </div>
      <div class="job-tags" style="margin:14px 0">${tags.map(t => `<span class="job-tag">${esc(t)}</span>`).join("")}</div>
      ${salary ? `<div class="job-salary-lg">${esc(salary)}</div>` : ""}
      ${j.description ? `<div class="job-desc">${esc(j.description).replace(/\n/g, "<br>")}</div>` : `<div class="in-empty">No description provided.</div>`}
      <div class="job-apply-row"></div>
    </div>`);

  const applyRow = card.querySelector(".job-apply-row");
  if (j.apply_url) {
    const btn = el(`<a class="in-follow-btn" style="display:inline-block;width:auto;padding:11px 28px;text-decoration:none;text-align:center" href="${esc(j.apply_url)}" target="_blank" rel="noopener noreferrer">Apply ↗</a>`);
    applyRow.appendChild(btn);
  } else {
    applyRow.appendChild(el(`<div class="in-empty">To apply, visit the company's website or contact them directly.</div>`));
  }

  wrap.appendChild(card);
  view.appendChild(wrap);
}
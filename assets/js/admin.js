// =====================================================================
// admin.js — admin dashboard (#admin route)
//   Overview stats + four management sections behind sub-tabs:
//   Users (role + activate/deactivate), Companies (activate/deactivate),
//   Posts (moderation: view + delete), Jobs (view + delete).
//   Admin-only; shell.js gates nav visibility and routing, but this
//   file double-checks ME.role before rendering.
// =====================================================================

let ADMIN_TAB = "users";   // 'users' | 'companies' | 'posts' | 'jobs'

let ADMIN_STATE     = { q: "", role: "", page: 1, limit: 25 };
let ADMIN_COMPANIES = { q: "", status: "", page: 1, limit: 25 };
let ADMIN_POSTS     = { q: "", author_type: "", page: 1, limit: 25 };
let ADMIN_JOBS      = { q: "", status: "", page: 1, limit: 25 };

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

async function renderAdmin() {
  const view = $("view");

  if (!ME || ME.role !== "admin") {
    view.innerHTML = `<div class="in-card2"><div class="in-empty">Admin access required.</div></div>`;
    return;
  }

  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  // ---- stats card ---------------------------------------------------
  const statsBox = el(`<div class="in-card2"><div class="in-loading">Loading stats…</div></div>`);
  wrap.appendChild(statsBox);
  loadAdminStats(statsBox);

  // ---- section tabs ---------------------------------------------------
  const tabs = el(`
    <div class="in-feedtabs in-admin-tabs">
      <button data-atab="users">Users</button>
      <button data-atab="companies">Companies</button>
      <button data-atab="posts">Posts</button>
      <button data-atab="jobs">Jobs</button>
    </div>`);
  wrap.appendChild(tabs);

  const section = el(`<div id="admin-section"></div>`);
  wrap.appendChild(section);

  const syncTabs = () => tabs.querySelectorAll("[data-atab]").forEach(b =>
    b.classList.toggle("active", b.dataset.atab === ADMIN_TAB));
  tabs.querySelectorAll("[data-atab]").forEach(b => {
    b.onclick = () => { ADMIN_TAB = b.dataset.atab; syncTabs(); renderAdminSection(section); };
  });
  syncTabs();
  renderAdminSection(section);
}

function renderAdminSection(section) {
  section.innerHTML = "";
  if (ADMIN_TAB === "users")          renderAdminUsersSection(section);
  else if (ADMIN_TAB === "companies") renderAdminCompaniesSection(section);
  else if (ADMIN_TAB === "posts")     renderAdminPostsSection(section);
  else                                renderAdminJobsSection(section);
}

// ---- stats overview ---------------------------------------------------
async function loadAdminStats(box) {
  const r = await api("/admin/stats.php");
  if (!r.ok || !r.data?.success) {
    box.innerHTML = `<div class="in-empty">Could not load stats.</div>`;
    return;
  }
  const s = r.data.data;
  box.innerHTML = `
    <h2>Overview</h2>
    <div class="in-admin-statgrid">
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.total_users}</div><div class="in-admin-stat-label">Total users</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.new_users_7d}</div><div class="in-admin-stat-label">New users (7d)</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.total_companies}</div><div class="in-admin-stat-label">Companies</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.total_posts}</div><div class="in-admin-stat-label">Posts</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.new_posts_7d ?? 0}</div><div class="in-admin-stat-label">Posts (7d)</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.total_likes ?? 0}</div><div class="in-admin-stat-label">Likes</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.total_comments ?? 0}</div><div class="in-admin-stat-label">Comments</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.open_jobs ?? 0}</div><div class="in-admin-stat-label">Open jobs</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.role_counts.admin}</div><div class="in-admin-stat-label">Admins</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.role_counts.moderator}</div><div class="in-admin-stat-label">Moderators</div></div>
    </div>`;
}

// ---- shared pager -------------------------------------------------------
// Renders ‹ Prev / Page x of y / Next › into `pager` and calls reload()
// after mutating state.page. `noun` is for the "· N users" label.
function adminPager(pager, state, total, page, limit, noun, reload) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  pager.innerHTML = "";
  if (totalPages <= 1) return;
  const prev = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>`);
  const info = el(`<span class="in-admin-pageinfo">Page ${page} of ${totalPages} · ${total} ${noun}</span>`);
  const next = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page >= totalPages ? "disabled" : ""}>Next ›</button>`);
  prev.onclick = () => { state.page = Math.max(1, page - 1); reload(); };
  next.onclick = () => { state.page = Math.min(totalPages, page + 1); reload(); };
  pager.append(prev, info, next);
}

// =====================================================================
// USERS — search, role management, activate/deactivate
// =====================================================================
function renderAdminUsersSection(section) {
  const card = el(`
    <div class="in-card2">
      <h2>User Management</h2>
      <div class="in-admin-toolbar">
        <input type="text" id="admin-search" placeholder="Search username, email, or name…" value="${esc(ADMIN_STATE.q)}">
        <select id="admin-role-filter">
          <option value="">All roles</option>
          <option value="user" ${ADMIN_STATE.role === "user" ? "selected" : ""}>User</option>
          <option value="moderator" ${ADMIN_STATE.role === "moderator" ? "selected" : ""}>Moderator</option>
          <option value="admin" ${ADMIN_STATE.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </div>
      <div class="in-set-msg" id="admin-msg"></div>
      <div id="admin-user-table"></div>
      <div class="in-admin-pager" id="admin-pager"></div>
    </div>`);
  section.appendChild(card);

  $("admin-search").addEventListener("input", debounce(() => {
    ADMIN_STATE.q = $("admin-search").value.trim();
    ADMIN_STATE.page = 1;
    loadAdminUsers();
  }, 350));

  $("admin-role-filter").onchange = () => {
    ADMIN_STATE.role = $("admin-role-filter").value;
    ADMIN_STATE.page = 1;
    loadAdminUsers();
  };

  loadAdminUsers();
}

async function loadAdminUsers() {
  const tableBox = $("admin-user-table");
  const pager    = $("admin-pager");
  const msg      = $("admin-msg");
  if (!tableBox) return;   // section switched away mid-flight
  msg.className = "in-set-msg";
  msg.textContent = "";
  tableBox.innerHTML = `<div class="in-loading">Loading users…</div>`;

  const params = new URLSearchParams({ page: ADMIN_STATE.page, limit: ADMIN_STATE.limit });
  if (ADMIN_STATE.q)    params.set("q", ADMIN_STATE.q);
  if (ADMIN_STATE.role) params.set("role", ADMIN_STATE.role);

  const r = await api("/admin/users.php?" + params.toString());
  if (!r.ok || !r.data?.success) {
    tableBox.innerHTML = `<div class="in-empty">Could not load users.</div>`;
    pager.innerHTML = "";
    return;
  }

  const { users, total, page, limit } = r.data.data;

  if (!users.length) {
    tableBox.innerHTML = `<div class="in-empty">No users match.</div>`;
    pager.innerHTML = "";
    return;
  }

  tableBox.innerHTML = "";
  const table = el(`
    <table class="in-admin-table">
      <thead><tr>
        <th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th></th>
      </tr></thead>
      <tbody></tbody>
    </table>`);
  const tbody = table.querySelector("tbody");

  users.forEach(u => {
    const isSelf  = ME && ME.uuid === u.uuid;
    const name    = [u.first_name, u.last_name].filter(Boolean).join(" ");
    const joined  = (u.created_at || "").slice(0, 10);
    const active  = !!Number(u.is_active);

    const row = el(`
      <tr>
        <td>
          <div class="in-admin-user">
            <a href="#user/${esc(u.uuid)}" class="in-admin-username" style="text-decoration:none">@${esc(u.username)}</a>
            ${name ? `<span class="in-admin-name">${esc(name)}</span>` : ""}
          </div>
        </td>
        <td>${esc(u.email)}</td>
        <td>
          <select class="in-admin-role-select" ${isSelf ? "disabled" : ""}>
            <option value="user" ${u.role === "user" ? "selected" : ""}>User</option>
            <option value="moderator" ${u.role === "moderator" ? "selected" : ""}>Moderator</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        </td>
        <td><span class="in-admin-badge ${active ? "ok" : "off"}">${active ? "Active" : "Inactive"}</span></td>
        <td>${esc(joined)}</td>
        <td>
          <div class="in-admin-actions">
            <button class="in-btn ghost in-admin-save" style="flex:none;padding:6px 14px" ${isSelf ? 'disabled title="You can\'t change your own role"' : ""}>Save</button>
            <button class="in-btn ghost in-admin-toggle" style="flex:none;padding:6px 14px" ${isSelf ? 'disabled title="You can\'t deactivate yourself"' : ""}>${active ? "Deactivate" : "Activate"}</button>
          </div>
        </td>
      </tr>`);

    const select    = row.querySelector(".in-admin-role-select");
    const saveBtn   = row.querySelector(".in-admin-save");
    const toggleBtn = row.querySelector(".in-admin-toggle");

    if (!isSelf) {
      saveBtn.onclick = async () => {
        const newRole = select.value;
        if (newRole === u.role) return;
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        const res = await api("/admin/set-role.php", "POST", { uuid: u.uuid, role: newRole });
        if (res.ok && res.data?.success) {
          msg.className = "in-set-msg ok";
          msg.textContent = `Updated @${u.username} to ${newRole}.`;
          u.role = newRole;
        } else {
          msg.className = "in-set-msg err";
          msg.textContent = res.data?.error || "Could not update role.";
          select.value = u.role; // revert on failure
        }
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      };

      toggleBtn.onclick = async () => {
        const nowActive = !!Number(u.is_active);
        const verb = nowActive ? "Deactivate" : "Activate";
        if (nowActive && !confirm(`Deactivate @${u.username}? They won't be able to sign in until reactivated.`)) return;
        toggleBtn.disabled = true;
        toggleBtn.textContent = verb.replace(/e$/, "ing…");
        const res = await api("/admin/set-active.php", "POST", { uuid: u.uuid, active: !nowActive });
        if (res.ok && res.data?.success) {
          u.is_active = nowActive ? 0 : 1;
          msg.className = "in-set-msg ok";
          msg.textContent = `${nowActive ? "Deactivated" : "Activated"} @${u.username}.`;
          // Update the row in place rather than reloading the page of results.
          const badge = row.querySelector(".in-admin-badge");
          const active = !!Number(u.is_active);
          badge.className = `in-admin-badge ${active ? "ok" : "off"}`;
          badge.textContent = active ? "Active" : "Inactive";
          toggleBtn.textContent = active ? "Deactivate" : "Activate";
        } else {
          msg.className = "in-set-msg err";
          msg.textContent = res.data?.error || "Could not update the account.";
          toggleBtn.textContent = verb;
        }
        toggleBtn.disabled = false;
      };
    }

    tbody.appendChild(row);
  });

  tableBox.appendChild(table);
  adminPager(pager, ADMIN_STATE, total, page, limit, "users", loadAdminUsers);
}

// =====================================================================
// COMPANIES — search, activate/deactivate
// =====================================================================
function renderAdminCompaniesSection(section) {
  const card = el(`
    <div class="in-card2">
      <h2>Company Management</h2>
      <div class="in-admin-toolbar">
        <input type="text" id="admin-co-search" placeholder="Search company name, email, or industry…" value="${esc(ADMIN_COMPANIES.q)}">
        <select id="admin-co-status">
          <option value="">All statuses</option>
          <option value="active" ${ADMIN_COMPANIES.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${ADMIN_COMPANIES.status === "inactive" ? "selected" : ""}>Inactive</option>
        </select>
      </div>
      <div class="in-set-msg" id="admin-co-msg"></div>
      <div id="admin-co-table"></div>
      <div class="in-admin-pager" id="admin-co-pager"></div>
    </div>`);
  section.appendChild(card);

  $("admin-co-search").addEventListener("input", debounce(() => {
    ADMIN_COMPANIES.q = $("admin-co-search").value.trim();
    ADMIN_COMPANIES.page = 1;
    loadAdminCompanies();
  }, 350));
  $("admin-co-status").onchange = () => {
    ADMIN_COMPANIES.status = $("admin-co-status").value;
    ADMIN_COMPANIES.page = 1;
    loadAdminCompanies();
  };

  loadAdminCompanies();
}

async function loadAdminCompanies() {
  const tableBox = $("admin-co-table");
  const pager    = $("admin-co-pager");
  const msg      = $("admin-co-msg");
  if (!tableBox) return;
  msg.className = "in-set-msg"; msg.textContent = "";
  tableBox.innerHTML = `<div class="in-loading">Loading companies…</div>`;

  const params = new URLSearchParams({ page: ADMIN_COMPANIES.page, limit: ADMIN_COMPANIES.limit });
  if (ADMIN_COMPANIES.q)      params.set("q", ADMIN_COMPANIES.q);
  if (ADMIN_COMPANIES.status) params.set("status", ADMIN_COMPANIES.status);

  const r = await api("/admin/companies.php?" + params.toString());
  if (!r.ok || !r.data?.success) { tableBox.innerHTML = `<div class="in-empty">Could not load companies.</div>`; pager.innerHTML = ""; return; }

  const { companies, total, page, limit } = r.data.data;
  if (!companies.length) { tableBox.innerHTML = `<div class="in-empty">No companies match.</div>`; pager.innerHTML = ""; return; }

  tableBox.innerHTML = "";
  const table = el(`
    <table class="in-admin-table">
      <thead><tr><th>Company</th><th>Email</th><th>Industry</th><th>Open jobs</th><th>Status</th><th>Joined</th><th></th></tr></thead>
      <tbody></tbody>
    </table>`);
  const tbody = table.querySelector("tbody");

  companies.forEach(c => {
    const joined = (c.created_at || "").slice(0, 10);
    const active = !!Number(c.is_active);
    const loc    = [c.city, c.state].filter(Boolean).join(", ");

    const row = el(`
      <tr>
        <td>
          <div class="in-admin-user">
            <a href="#company/${esc(c.uuid)}" class="in-admin-username" style="text-decoration:none">${esc(c.name)}${Number(c.is_verified) ? ' <span class="post-tag">Verified</span>' : ""}</a>
            ${loc ? `<span class="in-admin-name">${esc(loc)}</span>` : ""}
          </div>
        </td>
        <td>${esc(c.email || "")}</td>
        <td>${esc(c.industry || "—")}</td>
        <td>${Number(c.open_jobs) || 0}</td>
        <td><span class="in-admin-badge ${active ? "ok" : "off"}">${active ? "Active" : "Inactive"}</span></td>
        <td>${esc(joined)}</td>
        <td><button class="in-btn ghost in-admin-toggle" style="flex:none;padding:6px 14px">${active ? "Deactivate" : "Activate"}</button></td>
      </tr>`);

    const toggleBtn = row.querySelector(".in-admin-toggle");
    toggleBtn.onclick = async () => {
      const nowActive = !!Number(c.is_active);
      if (nowActive && !confirm(`Deactivate ${c.name}? They won't be able to sign in until reactivated.`)) return;
      toggleBtn.disabled = true;
      const res = await api("/admin/set-company-active.php", "POST", { uuid: c.uuid, active: !nowActive });
      if (res.ok && res.data?.success) {
        c.is_active = nowActive ? 0 : 1;
        msg.className = "in-set-msg ok";
        msg.textContent = `${nowActive ? "Deactivated" : "Activated"} ${c.name}.`;
        const badge = row.querySelector(".in-admin-badge");
        const active = !!Number(c.is_active);
        badge.className = `in-admin-badge ${active ? "ok" : "off"}`;
        badge.textContent = active ? "Active" : "Inactive";
        toggleBtn.textContent = active ? "Deactivate" : "Activate";
      } else {
        msg.className = "in-set-msg err";
        msg.textContent = res.data?.error || "Could not update the company.";
      }
      toggleBtn.disabled = false;
    };

    tbody.appendChild(row);
  });

  tableBox.appendChild(table);
  adminPager(pager, ADMIN_COMPANIES, total, page, limit, "companies", loadAdminCompanies);
}

// =====================================================================
// POSTS — moderation: search, open, delete
// =====================================================================
function renderAdminPostsSection(section) {
  const card = el(`
    <div class="in-card2">
      <h2>Post Moderation</h2>
      <div class="in-admin-toolbar">
        <input type="text" id="admin-post-search" placeholder="Search post text or author…" value="${esc(ADMIN_POSTS.q)}">
        <select id="admin-post-author">
          <option value="">All authors</option>
          <option value="user" ${ADMIN_POSTS.author_type === "user" ? "selected" : ""}>Users</option>
          <option value="company" ${ADMIN_POSTS.author_type === "company" ? "selected" : ""}>Companies</option>
        </select>
      </div>
      <div class="in-set-msg" id="admin-post-msg"></div>
      <div id="admin-post-table"></div>
      <div class="in-admin-pager" id="admin-post-pager"></div>
    </div>`);
  section.appendChild(card);

  $("admin-post-search").addEventListener("input", debounce(() => {
    ADMIN_POSTS.q = $("admin-post-search").value.trim();
    ADMIN_POSTS.page = 1;
    loadAdminPosts();
  }, 350));
  $("admin-post-author").onchange = () => {
    ADMIN_POSTS.author_type = $("admin-post-author").value;
    ADMIN_POSTS.page = 1;
    loadAdminPosts();
  };

  loadAdminPosts();
}

async function loadAdminPosts() {
  const tableBox = $("admin-post-table");
  const pager    = $("admin-post-pager");
  const msg      = $("admin-post-msg");
  if (!tableBox) return;
  msg.className = "in-set-msg"; msg.textContent = "";
  tableBox.innerHTML = `<div class="in-loading">Loading posts…</div>`;

  const params = new URLSearchParams({ page: ADMIN_POSTS.page, limit: ADMIN_POSTS.limit });
  if (ADMIN_POSTS.q)           params.set("q", ADMIN_POSTS.q);
  if (ADMIN_POSTS.author_type) params.set("author_type", ADMIN_POSTS.author_type);

  const r = await api("/admin/posts.php?" + params.toString());
  if (!r.ok || !r.data?.success) { tableBox.innerHTML = `<div class="in-empty">Could not load posts.</div>`; pager.innerHTML = ""; return; }

  const { posts, total, page, limit } = r.data.data;
  if (!posts.length) { tableBox.innerHTML = `<div class="in-empty">No posts match.</div>`; pager.innerHTML = ""; return; }

  tableBox.innerHTML = "";
  const table = el(`
    <table class="in-admin-table">
      <thead><tr><th>Post</th><th>Author</th><th>Engagement</th><th>Posted</th><th></th></tr></thead>
      <tbody></tbody>
    </table>`);
  const tbody = table.querySelector("tbody");

  posts.forEach(p => {
    const posted   = (p.created_at || "").slice(0, 10);
    const isCo     = p.author_type === "company";
    const profHash = isCo ? `company/${esc(p.author_uuid)}` : `user/${esc(p.author_uuid)}`;
    const label    = p.snippet || (p.has_media ? "(image post)" : `(${esc(p.post_type)} post)`);
    const extras   = [
      p.has_media ? "🖼" : "",
      p.visibility === "followers" ? "👥" : "",
    ].filter(Boolean).join(" ");

    const row = el(`
      <tr>
        <td>
          <a href="#post/${p.id}" class="in-admin-snippet" title="Open post" style="text-decoration:none;display:block">${esc(label)}</a>
          ${extras ? `<span class="in-admin-name">${extras}</span>` : ""}
        </td>
        <td><a href="#${profHash}" style="color:var(--in-accent);text-decoration:none">${isCo ? esc(p.author_name || "Unknown") : "@" + esc(p.author_name || "unknown")}</a></td>
        <td><span class="in-admin-name">♥ ${p.likes} · 💬 ${p.comments}</span></td>
        <td>${esc(posted)}</td>
        <td><button class="del" data-del title="Delete post">✕</button></td>
      </tr>`);

    row.querySelector("[data-del]").onclick = async () => {
      if (!confirm(`Delete this post by ${p.author_name}? This can't be undone.`)) return;
      const res = await api("/posts/delete.php", "POST", { id: p.id });
      if (res.ok && res.data?.success) { msg.className = "in-set-msg ok"; msg.textContent = "Post deleted."; loadAdminPosts(); }
      else { msg.className = "in-set-msg err"; msg.textContent = res.data?.error || "Could not delete the post."; }
    };

    tbody.appendChild(row);
  });

  tableBox.appendChild(table);
  adminPager(pager, ADMIN_POSTS, total, page, limit, "posts", loadAdminPosts);
}

// =====================================================================
// JOBS — search, open, delete
// =====================================================================
const ADMIN_EMP = {
  full_time: "Full-time", part_time: "Part-time", contract: "Contract",
  internship: "Internship", temporary: "Temporary",
};

function renderAdminJobsSection(section) {
  const card = el(`
    <div class="in-card2">
      <h2>Job Management</h2>
      <div class="in-admin-toolbar">
        <input type="text" id="admin-job-search" placeholder="Search job title or company…" value="${esc(ADMIN_JOBS.q)}">
        <select id="admin-job-status">
          <option value="">All statuses</option>
          <option value="open" ${ADMIN_JOBS.status === "open" ? "selected" : ""}>Open</option>
          <option value="draft" ${ADMIN_JOBS.status === "draft" ? "selected" : ""}>Draft</option>
          <option value="closed" ${ADMIN_JOBS.status === "closed" ? "selected" : ""}>Closed</option>
        </select>
      </div>
      <div class="in-set-msg" id="admin-job-msg"></div>
      <div id="admin-job-table"></div>
      <div class="in-admin-pager" id="admin-job-pager"></div>
    </div>`);
  section.appendChild(card);

  $("admin-job-search").addEventListener("input", debounce(() => {
    ADMIN_JOBS.q = $("admin-job-search").value.trim();
    ADMIN_JOBS.page = 1;
    loadAdminJobs();
  }, 350));
  $("admin-job-status").onchange = () => {
    ADMIN_JOBS.status = $("admin-job-status").value;
    ADMIN_JOBS.page = 1;
    loadAdminJobs();
  };

  loadAdminJobs();
}

async function loadAdminJobs() {
  const tableBox = $("admin-job-table");
  const pager    = $("admin-job-pager");
  const msg      = $("admin-job-msg");
  if (!tableBox) return;
  msg.className = "in-set-msg"; msg.textContent = "";
  tableBox.innerHTML = `<div class="in-loading">Loading jobs…</div>`;

  const params = new URLSearchParams({ page: ADMIN_JOBS.page, limit: ADMIN_JOBS.limit });
  if (ADMIN_JOBS.q) params.set("q", ADMIN_JOBS.q);
  if (ADMIN_JOBS.status) params.set("status", ADMIN_JOBS.status);

  const r = await api("/admin/jobs.php?" + params.toString());
  if (!r.ok || !r.data?.success) { tableBox.innerHTML = `<div class="in-empty">Could not load jobs.</div>`; pager.innerHTML = ""; return; }

  const { jobs, total, page, limit } = r.data.data;
  if (!jobs.length) { tableBox.innerHTML = `<div class="in-empty">No jobs match.</div>`; pager.innerHTML = ""; return; }

  tableBox.innerHTML = "";
  const table = el(`
    <table class="in-admin-table">
      <thead><tr><th>Job</th><th>Company</th><th>Type</th><th>Status</th><th>Posted</th><th></th></tr></thead>
      <tbody></tbody>
    </table>`);
  const tbody = table.querySelector("tbody");

  jobs.forEach(j => {
    const type = j.employment_type ? (ADMIN_EMP[j.employment_type] || j.employment_type) : "—";
    const posted = (j.created_at || "").slice(0, 10);
    const statusBadge = j.status === "open"
      ? `<span class="in-admin-badge ok">Open</span>`
      : `<span class="in-admin-badge off">${esc(j.status)}</span>`;

    const row = el(`
      <tr>
        <td><a href="#job/${esc(j.uuid)}" class="in-admin-username" style="text-decoration:none">${esc(j.title)}</a><div class="in-admin-name">${esc(j.location || "")}</div></td>
        <td><a href="#company/${esc(j.company_uuid)}" style="color:var(--in-accent);text-decoration:none">${esc(j.company_name)}</a></td>
        <td>${esc(type)}</td>
        <td>${statusBadge}</td>
        <td>${esc(posted)}</td>
        <td><button class="del" data-del title="Delete">✕</button></td>
      </tr>`);
    row.querySelector("[data-del]").onclick = async () => {
      if (!confirm(`Delete "${j.title}" by ${j.company_name}? This can't be undone.`)) return;
      const res = await api("/admin/delete-job.php", "POST", { uuid: j.uuid });
      if (res.ok && res.data?.success) { msg.className = "in-set-msg ok"; msg.textContent = `Deleted "${j.title}".`; loadAdminJobs(); }
      else { msg.className = "in-set-msg err"; msg.textContent = res.data?.error || "Could not delete the job."; }
    };
    tbody.appendChild(row);
  });

  tableBox.appendChild(table);
  adminPager(pager, ADMIN_JOBS, total, page, limit, "jobs", loadAdminJobs);
}

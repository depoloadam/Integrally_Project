// =====================================================================
// admin.js — admin dashboard (#admin route)
//   Stats overview + searchable/filterable user list with inline
//   role management. Admin-only; shell.js gates nav visibility and
//   routing, but this file double-checks ME.role before rendering.
// =====================================================================

let ADMIN_STATE = { q: "", role: "", page: 1, limit: 25 };

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

  // ---- stats card --------------------------------------------------
  const statsBox = el(`<div class="in-card2"><div class="in-loading">Loading stats…</div></div>`);
  wrap.appendChild(statsBox);
  loadAdminStats(statsBox);

  // ---- user management card ----------------------------------------
  const card = el(`
    <div class="in-card2">
      <h2>User Management</h2>
      <div class="in-admin-toolbar">
        <input type="text" id="admin-search" placeholder="Search username, email, or name…">
        <select id="admin-role-filter">
          <option value="">All roles</option>
          <option value="user">User</option>
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="in-set-msg" id="admin-msg"></div>
      <div id="admin-user-table"></div>
      <div class="in-admin-pager" id="admin-pager"></div>
    </div>`);
  wrap.appendChild(card);

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
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.total_companies}</div><div class="in-admin-stat-label">Companies</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.total_posts}</div><div class="in-admin-stat-label">Posts</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.new_users_7d}</div><div class="in-admin-stat-label">New (7d)</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.role_counts.admin}</div><div class="in-admin-stat-label">Admins</div></div>
      <div class="in-admin-stat"><div class="in-admin-stat-num">${s.role_counts.moderator}</div><div class="in-admin-stat-label">Moderators</div></div>
    </div>`;
}

async function loadAdminUsers() {
  const tableBox = $("admin-user-table");
  const pager    = $("admin-pager");
  const msg      = $("admin-msg");
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
    const status  = u.is_active ? "Active" : "Inactive";

    const row = el(`
      <tr>
        <td>
          <div class="in-admin-user">
            <span class="in-admin-username">@${esc(u.username)}</span>
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
        <td><span class="in-admin-badge ${u.is_active ? "ok" : "off"}">${status}</span></td>
        <td>${esc(joined)}</td>
        <td>
          <button class="in-btn ghost in-admin-save" style="flex:none;padding:6px 14px" ${isSelf ? "disabled title=\"You can't change your own role\"" : ""}>Save</button>
        </td>
      </tr>`);

    const select = row.querySelector(".in-admin-role-select");
    const saveBtn = row.querySelector(".in-admin-save");

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
    }

    tbody.appendChild(row);
  });

  tableBox.appendChild(table);

  // ---- pagination -----------------------------------------------------
  const totalPages = Math.max(1, Math.ceil(total / limit));
  pager.innerHTML = "";
  if (totalPages > 1) {
    const prev = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>`);
    const info = el(`<span class="in-admin-pageinfo">Page ${page} of ${totalPages} · ${total} users</span>`);
    const next = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page >= totalPages ? "disabled" : ""}>Next ›</button>`);
    prev.onclick = () => { ADMIN_STATE.page = Math.max(1, page - 1); loadAdminUsers(); };
    next.onclick = () => { ADMIN_STATE.page = Math.min(totalPages, page + 1); loadAdminUsers(); };
    pager.append(prev, info, next);
  }
}
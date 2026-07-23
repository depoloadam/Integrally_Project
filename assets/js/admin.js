// =====================================================================
// admin.js — admin dashboard (#admin route)
//   Overview stats + five management sections behind sub-tabs:
//   Users (role + activate/deactivate), Companies (activate/deactivate),
//   Posts (moderation: view + delete), Jobs (view + delete), Reports
//   (moderation queue for user-filed post reports), and an Audit tab
//   (read-only log of admin actions).
//   Admin-only; shell.js gates nav visibility and routing, but this
//   file double-checks ME.role before rendering.
// =====================================================================

let ADMIN_TAB = "users";   // 'users'|'companies'|'posts'|'jobs'|'reports'|'audit'

let ADMIN_STATE     = { q: "", role: "", page: 1, limit: 25 };
let ADMIN_COMPANIES = { q: "", status: "", page: 1, limit: 25 };
let ADMIN_POSTS     = { q: "", author_type: "", page: 1, limit: 25 };
let ADMIN_JOBS      = { q: "", status: "", page: 1, limit: 25 };
let ADMIN_AUDIT     = { q: "", action: "", page: 1, limit: 25 };
let ADMIN_REPORTS   = { q: "", status: "open", reason: "", page: 1, limit: 25 };

// Open-report count for the tab badge. Refreshed by every reports load
// so the badge tracks the queue without its own polling.
let ADMIN_OPEN_REPORTS = null;

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// Save/action feedback: sets the tab's inline status line AND fires a
// corner toast (shell.js), so confirmation is visible even when the
// acted-on row is scrolled far below the status line.
function adminNotify(msgEl, kind, text) {
  if (msgEl) {
    msgEl.className = "in-set-msg " + kind;
    msgEl.textContent = text;
  }
  toast(text, kind);
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
      <button data-atab="reports">Reports<span class="in-tab-badge" id="admin-reports-badge" hidden></span></button>
      <button data-atab="certs">Certs</button>
      <button data-atab="audit">Audit</button>
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
  else if (ADMIN_TAB === "reports")   renderAdminReportsSection(section);
  else if (ADMIN_TAB === "certs")     renderAdminCertsSection(section);
  else if (ADMIN_TAB === "audit")     renderAdminAuditSection(section);
  else                                renderAdminJobsSection(section);
}


// ---- certification catalog -------------------------------------------
// Admin-added OFFICIAL catalog entries. These merge into score
// relevance (CertCatalog::loadCustom) and the profile cert typeahead,
// alongside the static generated catalog. Category names come from the
// global JOB_CATALOG (jobs-catalog.js loads before this file).
// ---- certification catalog -------------------------------------------
// Review + adjust the whole catalog. Two sources are merged:
//   built-in — the generated static catalog (CertCatalog::ROSTER). Lives
//              in code, so it can't be edited here; "Override" creates a
//              custom entry keyed on the same name, which wins during
//              resolution (CertCatalog::categoriesForCert checks custom
//              keys first).
//   custom   — admin-added rows (cert_catalog_entries), fully editable.
// Both feed score relevance and the profile cert typeahead.
function renderAdminCertsSection(section) {
  const card = el(`<div class="in-card2">
    <h2>Certification catalog</h2>
    <div class="in-set-toggle-sub" style="margin-bottom:14px">
      Entries here are recognized by the score engine and suggested in the profile certification
      typeahead. Built-in certifications are managed in code — adjust one by saving an override.
    </div>
    <div id="acert-form"></div>
    <div class="acert-toolbar">
      <input id="acert-q" placeholder="Search name, issuer, or alias…" autocomplete="off">
      <select id="acert-src">
        <option value="all">All sources</option>
        <option value="custom">Admin-added</option>
        <option value="builtin">Built-in</option>
      </select>
      <select id="acert-cat"><option value="">All categories</option></select>
      <span class="acert-count" id="acert-count"></span>
    </div>
    <div id="acert-list"><div class="in-empty">Loading…</div></div>
  </div>`);
  section.appendChild(card);

  const catNames = (typeof JOB_CATALOG !== "undefined") ? JOB_CATALOG.map(g => g.category) : [];
  let ENTRIES = [], CATEGORIES = catNames, EDITING = null;

  // ---- add / edit form ----
  const form = el(`<div class="acert-add">
    <div class="acert-form-head" id="acert-form-head" hidden></div>
    <div class="row">
      <div><label>Name *</label><input id="acert-name" maxlength="190" placeholder="e.g. Certified Widget Engineer"></div>
      <div><label>Issuer</label><input id="acert-issuer" maxlength="190" placeholder="e.g. Widget Institute"></div>
    </div>
    <label>Aliases <span class="in-set-toggle-sub" style="display:inline">(comma-separated match strings — acronyms, short forms)</span></label>
    <input id="acert-aliases" placeholder="e.g. cwe, widget engineer">
    <label>Categories * <span class="in-set-toggle-sub" style="display:inline">(what fields this certification is relevant to)</span></label>
    <div class="acert-cats" id="acert-cats"></div>
    <div class="acert-form-actions">
      <button class="in-btn primary" id="acert-save" style="flex:none;padding:9px 18px">Add to catalog</button>
      <button class="in-btn ghost" id="acert-cancel" style="flex:none;padding:9px 18px" hidden>Cancel</button>
    </div>
  </div>`);
  card.querySelector("#acert-form").appendChild(form);

  const nameEl = form.querySelector("#acert-name");
  const issEl  = form.querySelector("#acert-issuer");
  const aliEl  = form.querySelector("#acert-aliases");
  const catsEl = form.querySelector("#acert-cats");
  const headEl = form.querySelector("#acert-form-head");
  const saveEl = form.querySelector("#acert-save");
  const cancelEl = form.querySelector("#acert-cancel");

  const drawCats = () => {
    catsEl.innerHTML = CATEGORIES.map((n, i) =>
      `<label class="acert-cat"><input type="checkbox" value="${i}"> ${esc(n)}</label>`).join("");
  };
  drawCats();

  const setChecked = (ids) => {
    const want = new Set((ids || []).map(Number));
    catsEl.querySelectorAll("input").forEach(c => { c.checked = want.has(parseInt(c.value, 10)); });
  };

  const resetForm = () => {
    EDITING = null;
    headEl.hidden = true; headEl.textContent = "";
    nameEl.value = ""; issEl.value = ""; aliEl.value = "";
    setChecked([]);
    nameEl.disabled = false;
    saveEl.textContent = "Add to catalog";
    cancelEl.hidden = true;
  };

  // Load an entry into the form. Built-ins become an override draft:
  // the name is locked (it's the key that shadows the built-in) and the
  // existing mapping is pre-filled so the admin edits from a known state.
  const loadInto = (entry, mode) => {
    EDITING = { mode, id: entry.id || 0 };
    nameEl.value = entry.name;
    issEl.value  = entry.issuer || "";
    aliEl.value  = (entry.aliases || []).join(", ");
    setChecked(entry.cats);
    if (mode === "override") {
      nameEl.disabled = true;
      headEl.hidden = false;
      headEl.innerHTML = `<b>Overriding a built-in:</b> saving creates an admin entry named
        “${esc(entry.name)}” that takes precedence over the built-in mapping. Remove the override to
        restore the original.`;
      saveEl.textContent = "Save override";
    } else {
      nameEl.disabled = false;
      headEl.hidden = false;
      headEl.innerHTML = `<b>Editing:</b> “${esc(entry.name)}”`;
      saveEl.textContent = "Save changes";
    }
    cancelEl.hidden = false;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    if (mode !== "override") nameEl.focus();
  };

  cancelEl.onclick = resetForm;

  saveEl.onclick = async () => {
    const name = nameEl.value.trim();
    if (!name) { toast("A certification name is required.", "err"); return; }
    const cats = [...catsEl.querySelectorAll("input:checked")].map(c => parseInt(c.value, 10));
    if (!cats.length) { toast("Pick at least one category.", "err"); return; }
    const aliases = aliEl.value.split(",").map(a => a.trim()).filter(Boolean);
    const body = { name, issuer: issEl.value.trim(), aliases, cats };
    // An override is an INSERT (no id); editing an existing custom row
    // sends its id so the endpoint updates in place.
    if (EDITING && EDITING.mode === "edit" && EDITING.id) body.id = EDITING.id;

    const r = await api("/admin/cert-catalog.php", "POST", body);
    if (!r.ok || !r.data?.success) { toast(r.data?.error || "Could not save the entry.", "err"); return; }
    toast(body.id ? "Changes saved." : (EDITING?.mode === "override" ? "Override saved." : "Added to the catalog."));
    resetForm();
    loadList();
  };

  // ---- list ----
  const listBox = card.querySelector("#acert-list");
  const qEl   = card.querySelector("#acert-q");
  const srcEl = card.querySelector("#acert-src");
  const catEl = card.querySelector("#acert-cat");
  const cntEl = card.querySelector("#acert-count");

  const visible = () => {
    const q = qEl.value.trim().toLowerCase();
    const src = srcEl.value;
    const cat = catEl.value === "" ? null : parseInt(catEl.value, 10);
    return ENTRIES.filter(e => {
      if (src !== "all" && e.source !== src) return false;
      if (cat !== null && !(e.cats || []).includes(cat)) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q)
          || (e.issuer || "").toLowerCase().includes(q)
          || (e.aliases || []).some(a => a.toLowerCase().includes(q));
    });
  };

  const draw = () => {
    const rows = visible();
    cntEl.textContent = `${rows.length} of ${ENTRIES.length}`;
    if (!rows.length) {
      listBox.innerHTML = `<div class="in-empty">No certifications match those filters.</div>`;
      return;
    }
    listBox.innerHTML = `<table class="in-admin-table"><thead><tr>
        <th>Name</th><th>Issuer</th><th>Categories</th><th>Aliases</th><th>Source</th><th></th>
      </tr></thead><tbody></tbody></table>`;
    const tbody = listBox.querySelector("tbody");
    // Cap the DOM: the built-in roster alone is ~184 rows and grows.
    const LIMIT = 200;
    for (const e of rows.slice(0, LIMIT)) {
      const tr = el(`<tr>
        <td></td><td></td><td></td><td></td>
        <td><span class="acert-src-tag"></span></td>
        <td class="acert-actions"></td>
      </tr>`);
      const tds = tr.querySelectorAll("td");
      tds[0].textContent = e.name;
      tds[1].textContent = e.issuer || "—";
      tds[2].textContent = (e.cats || []).map(i => CATEGORIES[i] || `#${i}`).join(", ");
      tds[3].textContent = (e.aliases || []).length ? e.aliases.join(", ") : "—";

      const tag = tr.querySelector(".acert-src-tag");
      if (e.source === "custom") { tag.textContent = "Admin"; tag.classList.add("is-custom"); }
      else if (e.overridden)     { tag.textContent = "Overridden"; tag.classList.add("is-over"); }
      else                       { tag.textContent = "Built-in"; }

      const act = tr.querySelector(".acert-actions");
      if (e.source === "custom") {
        const ed = el(`<button class="in-btn ghost acert-btn">Edit</button>`);
        ed.onclick = () => loadInto(e, "edit");
        const rm = el(`<button class="in-btn ghost acert-btn">Remove</button>`);
        rm.onclick = async () => {
          if (!confirm(`Remove "${e.name}" from the catalog? Scores computed after removal lose this mapping.`)) return;
          const r2 = await api("/admin/delete-cert-catalog.php", "POST", { id: e.id });
          if (!r2.ok || !r2.data?.success) { toast(r2.data?.error || "Could not remove the entry.", "err"); return; }
          toast("Removed."); loadList();
        };
        act.appendChild(ed); act.appendChild(rm);
      } else {
        const ov = el(`<button class="in-btn ghost acert-btn">${e.overridden ? "Edit override" : "Override"}</button>`);
        ov.onclick = () => {
          if (e.overridden) {
            const own = ENTRIES.find(x => x.source === "custom"
              && x.name.trim().toLowerCase() === e.name.trim().toLowerCase());
            if (own) { loadInto(own, "edit"); return; }
          }
          loadInto(e, "override");
        };
        act.appendChild(ov);
      }
      tbody.appendChild(tr);
    }
    if (rows.length > LIMIT) {
      listBox.appendChild(el(`<div class="in-set-toggle-sub" style="margin-top:10px">
        Showing the first ${LIMIT} of ${rows.length}. Narrow the search to see the rest.</div>`));
    }
  };

  qEl.oninput = draw;
  srcEl.onchange = draw;
  catEl.onchange = draw;

  async function loadList() {
    const r = await api("/admin/cert-catalog.php");
    if (!r.ok || !r.data?.success) {
      listBox.innerHTML = `<div class="in-empty">Could not load the catalog.</div>`;
      return;
    }
    const d = r.data.data;
    ENTRIES = d.entries || [];
    if (Array.isArray(d.categories) && d.categories.length) {
      CATEGORIES = d.categories;
      drawCats();
      catEl.innerHTML = `<option value="">All categories</option>`
        + CATEGORIES.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join("");
    }
    draw();
  }
  loadList();
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
        <th>User</th><th>Email</th><th>Role</th><th>Plan</th><th>Status</th><th>Joined</th><th></th>
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
        <td>
          <select class="in-admin-plan-select">
            <option value="free" ${u.plan === "free" ? "selected" : ""}>Free</option>
            <option value="plus" ${u.plan === "plus" ? "selected" : ""}>Plus</option>
          </select>
        </td>
        <td><span class="in-admin-badge ${active ? "ok" : "off"}">${active ? "Active" : "Inactive"}</span></td>
        <td>${esc(joined)}</td>
        <td>
          <div class="in-admin-actions">
            <button class="in-btn ghost in-admin-toggle" style="flex:none;padding:6px 14px" ${isSelf ? 'disabled title="You can\'t deactivate yourself"' : ""}>${active ? "Deactivate" : "Activate"}</button>
          </div>
        </td>
      </tr>`);

    const select     = row.querySelector(".in-admin-role-select");
    const planSelect = row.querySelector(".in-admin-plan-select");
    const toggleBtn  = row.querySelector(".in-admin-toggle");

    // Plan is editable for everyone including self (no lockout risk),
    // so its handler is wired outside the !isSelf block below.
    planSelect.onchange = async () => {
      const newPlan = planSelect.value;
      if (newPlan === u.plan) return;
      planSelect.disabled = true;
      const res = await api("/admin/set-plan.php", "POST", { uuid: u.uuid, plan: newPlan });
      if (res.ok && res.data?.success) {
        adminNotify(msg, "ok", `Set @${u.username} to ${newPlan === "plus" ? "Plus" : "Free"}.`);
        u.plan = newPlan;
      } else {
        adminNotify(msg, "err", res.data?.error || "Could not update plan.");
        planSelect.value = u.plan; // revert on failure
      }
      planSelect.disabled = false;
    };

    if (!isSelf) {
      // Role saves immediately on change. Admin privileges are the one
      // change with real consequences, so granting OR removing admin
      // asks for confirmation first; user<->moderator changes just save.
      select.onchange = async () => {
        const newRole = select.value;
        if (newRole === u.role) return;

        const touchesAdmin = newRole === "admin" || u.role === "admin";
        if (touchesAdmin) {
          const what = newRole === "admin"
            ? `Grant ADMIN access to @${u.username}? They'll have full control of the admin dashboard.`
            : `Remove ADMIN access from @${u.username}?`;
          if (!(await confirmDialog(what, { confirmText: "Change role" }))) { select.value = u.role; return; }
        }

        select.disabled = true;
        const res = await api("/admin/set-role.php", "POST", { uuid: u.uuid, role: newRole });
        if (res.ok && res.data?.success) {
          adminNotify(msg, "ok", `Updated @${u.username} to ${newRole}.`);
          u.role = newRole;
        } else {
          adminNotify(msg, "err", res.data?.error || "Could not update role.");
          select.value = u.role; // revert on failure
        }
        select.disabled = false;
      };

      toggleBtn.onclick = async () => {
        const nowActive = !!Number(u.is_active);
        const verb = nowActive ? "Deactivate" : "Activate";
        if (nowActive && !(await confirmDialog(`Deactivate @${u.username}? They won't be able to sign in until reactivated.`, { confirmText: "Deactivate", danger: true }))) return;
        toggleBtn.disabled = true;
        toggleBtn.textContent = verb.replace(/e$/, "ing…");
        const res = await api("/admin/set-active.php", "POST", { uuid: u.uuid, active: !nowActive });
        if (res.ok && res.data?.success) {
          u.is_active = nowActive ? 0 : 1;
          adminNotify(msg, "ok", `${nowActive ? "Deactivated" : "Activated"} @${u.username}.`);
          // Update the row in place rather than reloading the page of results.
          const badge = row.querySelector(".in-admin-badge");
          const active = !!Number(u.is_active);
          badge.className = `in-admin-badge ${active ? "ok" : "off"}`;
          badge.textContent = active ? "Active" : "Inactive";
          toggleBtn.textContent = active ? "Deactivate" : "Activate";
        } else {
          adminNotify(msg, "err", res.data?.error || "Could not update the account.");
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
      if (nowActive && !(await confirmDialog(`Deactivate ${c.name}? They won't be able to sign in until reactivated.`, { confirmText: "Deactivate", danger: true }))) return;
      toggleBtn.disabled = true;
      const res = await api("/admin/set-company-active.php", "POST", { uuid: c.uuid, active: !nowActive });
      if (res.ok && res.data?.success) {
        c.is_active = nowActive ? 0 : 1;
        adminNotify(msg, "ok", `${nowActive ? "Deactivated" : "Activated"} ${c.name}.`);
        const badge = row.querySelector(".in-admin-badge");
        const active = !!Number(c.is_active);
        badge.className = `in-admin-badge ${active ? "ok" : "off"}`;
        badge.textContent = active ? "Active" : "Inactive";
        toggleBtn.textContent = active ? "Deactivate" : "Activate";
      } else {
        adminNotify(msg, "err", res.data?.error || "Could not update the company.");
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
      if (!(await confirmDialog(`Delete this post by ${p.author_name}? This can't be undone.`, { confirmText: "Delete", danger: true }))) return;
      const res = await api("/posts/delete.php", "POST", { id: p.id });
      if (res.ok && res.data?.success) { adminNotify(msg, "ok", "Post deleted."); loadAdminPosts(); }
      else { adminNotify(msg, "err", res.data?.error || "Could not delete the post."); }
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
      if (!(await confirmDialog(`Delete "${j.title}" by ${j.company_name}? This can't be undone.`, { confirmText: "Delete", danger: true }))) return;
      const res = await api("/admin/delete-job.php", "POST", { uuid: j.uuid });
      if (res.ok && res.data?.success) { adminNotify(msg, "ok", `Deleted "${j.title}".`); loadAdminJobs(); }
      else { adminNotify(msg, "err", res.data?.error || "Could not delete the job."); }
    };
    tbody.appendChild(row);
  });

  tableBox.appendChild(table);
  adminPager(pager, ADMIN_JOBS, total, page, limit, "jobs", loadAdminJobs);
}

// =====================================================================
// AUDIT LOG — read-only trail of admin actions
// =====================================================================

// action -> { label, badge class } for display
const AUDIT_ACTIONS = {
  set_role:           { label: "Role changed" },
  set_plan:           { label: "Plan changed" },
  set_user_active:    { label: "User account toggled" },
  set_company_active: { label: "Company account toggled" },
  delete_post:        { label: "Post deleted" },
  delete_job:         { label: "Job deleted" },
  review_reports:     { label: "Reports reviewed" },
  dismiss_reports:    { label: "Reports dismissed" },
  reopen_reports:     { label: "Reports reopened" },
  purge_reports:      { label: "Reports cleared" },
};

function renderAdminAuditSection(section) {
  const options = Object.entries(AUDIT_ACTIONS).map(([v, a]) =>
    `<option value="${v}" ${ADMIN_AUDIT.action === v ? "selected" : ""}>${a.label}</option>`).join("");
  const card = el(`
    <div class="in-card2">
      <h2>Audit Log</h2>
      <div class="in-admin-toolbar">
        <input type="text" id="admin-audit-search" placeholder="Search admin or target…" value="${esc(ADMIN_AUDIT.q)}">
        <select id="admin-audit-action">
          <option value="">All actions</option>
          ${options}
        </select>
      </div>
      <div id="admin-audit-table"></div>
      <div class="in-admin-pager" id="admin-audit-pager"></div>
    </div>`);
  section.appendChild(card);

  $("admin-audit-search").addEventListener("input", debounce(() => {
    ADMIN_AUDIT.q = $("admin-audit-search").value.trim();
    ADMIN_AUDIT.page = 1;
    loadAdminAudit();
  }, 350));
  $("admin-audit-action").onchange = () => {
    ADMIN_AUDIT.action = $("admin-audit-action").value;
    ADMIN_AUDIT.page = 1;
    loadAdminAudit();
  };

  loadAdminAudit();
}

// Renders one entry's detail JSON as a compact human string.
function auditDetailText(e) {
  const d = e.detail;
  if (!d) return "";
  if (d.from !== undefined && d.to !== undefined) return `${d.from} → ${d.to}`;
  if (d.to !== undefined) return `→ ${d.to}`;
  if (e.action === "delete_post" && d.author_type) return `by ${d.author_type} #${d.author_id}`;
  if (d.reports_resolved !== undefined) return `${d.reports_resolved} report${d.reports_resolved === 1 ? "" : "s"}${d.post_deleted ? " (post already deleted)" : ""}`;
  if (d.reports_reopened !== undefined) return `${d.reports_reopened} report${d.reports_reopened === 1 ? "" : "s"}`;
  if (d.reports_removed  !== undefined) return `${d.reports_removed} report${d.reports_removed === 1 ? "" : "s"} cleared`;
  return "";
}

async function loadAdminAudit() {
  const tableBox = $("admin-audit-table");
  const pager    = $("admin-audit-pager");
  if (!tableBox) return;

  tableBox.innerHTML = `<div class="in-loading">Loading audit log…</div>`;

  const params = new URLSearchParams({
    page: ADMIN_AUDIT.page, limit: ADMIN_AUDIT.limit,
  });
  if (ADMIN_AUDIT.q)      params.set("q", ADMIN_AUDIT.q);
  if (ADMIN_AUDIT.action) params.set("action", ADMIN_AUDIT.action);

  const r = await api("/admin/audit.php?" + params.toString());
  if (!r.ok || !r.data?.success) {
    tableBox.innerHTML = `<div class="in-empty">Could not load the audit log. If this is a fresh setup, make sure the audit-log migration has been run.</div>`;
    pager.innerHTML = "";
    return;
  }

  const { entries, total, page, limit } = r.data.data;

  if (!entries.length) {
    tableBox.innerHTML = `<div class="in-empty">No audit entries${ADMIN_AUDIT.q || ADMIN_AUDIT.action ? " match" : " yet — admin actions will appear here"}.</div>`;
    pager.innerHTML = "";
    return;
  }

  tableBox.innerHTML = "";
  const table = el(`
    <table class="in-admin-table">
      <thead><tr>
        <th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th>
      </tr></thead>
      <tbody></tbody>
    </table>`);
  const tbody = table.querySelector("tbody");

  entries.forEach(e => {
    const a     = AUDIT_ACTIONS[e.action] || { label: e.action };
    const when  = (e.created_at || "").slice(0, 16).replace("T", " ");
    const row = el(`
      <tr>
        <td style="white-space:nowrap">${esc(when)}</td>
        <td>@${esc(e.admin_username)}</td>
        <td><span class="in-audit-action">${esc(a.label)}</span></td>
        <td class="in-audit-target">${esc(e.target_label)}</td>
        <td class="in-audit-detail">${esc(auditDetailText(e))}</td>
      </tr>`);
    tbody.appendChild(row);
  });

  tableBox.appendChild(table);
  adminPager(pager, ADMIN_AUDIT, total, page, limit, "entries", loadAdminAudit);
}

// =====================================================================
// REPORTS — moderation queue for user-filed post reports
//
// Rows are grouped by post (a post reported twelve times is one row),
// so the queue reflects work to be done rather than complaint volume.
// Each row expands to show individual reporters, their chosen reason,
// and any free-text detail they added.
//
// Actions settle every report against the post at once:
//   Delete post -> deletes via the existing /posts/delete.php admin
//                  override, then marks the reports reviewed
//   Reviewed    -> valid, acted on, post kept
//   Dismissed   -> not actionable
//   Reopen      -> pull a settled post back into the queue
//   Clear       -> drop orphan reports whose post is already gone
// =====================================================================

// Short labels for the reason chips — the full sentences from
// PostActions::REASONS are too long for a table cell.
const REPORT_REASON_SHORT = {
  spam: "Spam", harassment: "Harassment", nudity: "Nudity",
  violence: "Violence", misinfo: "False info", ip: "IP", other: "Other",
};

// Post IDs whose reporter detail is expanded. Kept outside the render
// so a resolve/refresh doesn't collapse everything the admin opened.
const REPORTS_EXPANDED = new Set();

function updateReportsBadge(n) {
  ADMIN_OPEN_REPORTS = n;
  const badge = $("admin-reports-badge");
  if (!badge) return;
  if (n > 0) { badge.textContent = n > 99 ? "99+" : String(n); badge.hidden = false; }
  else       { badge.textContent = ""; badge.hidden = true; }
}

function renderAdminReportsSection(section) {
  const reasonOpts = Object.entries(REPORT_REASON_SHORT).map(([v, label]) =>
    `<option value="${v}" ${ADMIN_REPORTS.reason === v ? "selected" : ""}>${esc(label)}</option>`).join("");

  const card = el(`
    <div class="in-card2">
      <h2>Reported Posts</h2>
      <div class="in-admin-toolbar">
        <input type="text" id="admin-report-search" placeholder="Search post text or author…" value="${esc(ADMIN_REPORTS.q)}">
        <select id="admin-report-status">
          <option value="open"      ${ADMIN_REPORTS.status === "open"      ? "selected" : ""}>Open</option>
          <option value="reviewed"  ${ADMIN_REPORTS.status === "reviewed"  ? "selected" : ""}>Reviewed</option>
          <option value="dismissed" ${ADMIN_REPORTS.status === "dismissed" ? "selected" : ""}>Dismissed</option>
          <option value=""          ${ADMIN_REPORTS.status === ""          ? "selected" : ""}>All statuses</option>
        </select>
        <select id="admin-report-reason">
          <option value="">All reasons</option>
          ${reasonOpts}
        </select>
      </div>
      <div class="in-set-msg" id="admin-report-msg"></div>
      <div id="admin-report-table"></div>
      <div class="in-admin-pager" id="admin-report-pager"></div>
    </div>`);
  section.appendChild(card);

  $("admin-report-search").addEventListener("input", debounce(() => {
    ADMIN_REPORTS.q = $("admin-report-search").value.trim();
    ADMIN_REPORTS.page = 1;
    loadAdminReports();
  }, 350));
  $("admin-report-status").onchange = () => {
    ADMIN_REPORTS.status = $("admin-report-status").value;
    ADMIN_REPORTS.page = 1;
    loadAdminReports();
  };
  $("admin-report-reason").onchange = () => {
    ADMIN_REPORTS.reason = $("admin-report-reason").value;
    ADMIN_REPORTS.page = 1;
    loadAdminReports();
  };

  loadAdminReports();
}

async function loadAdminReports() {
  const tableBox = $("admin-report-table");
  const pager    = $("admin-report-pager");
  const msg      = $("admin-report-msg");
  if (!tableBox) return;

  tableBox.innerHTML = `<div class="in-loading">Loading reports…</div>`;

  const params = new URLSearchParams({ page: ADMIN_REPORTS.page, limit: ADMIN_REPORTS.limit });
  if (ADMIN_REPORTS.q)      params.set("q", ADMIN_REPORTS.q);
  if (ADMIN_REPORTS.reason) params.set("reason", ADMIN_REPORTS.reason);
  // status is sent even when empty so the endpoint's 'open' default
  // can't override an explicit "All statuses" choice.
  params.set("status", ADMIN_REPORTS.status);

  const r = await api("/admin/reports.php?" + params.toString());
  if (!r.ok || !r.data?.success) {
    tableBox.innerHTML = `<div class="in-empty">Could not load reports. If this is a fresh setup, make sure the post-actions migration has been run.</div>`;
    pager.innerHTML = "";
    return;
  }

  const { reports, total, page, limit, open_posts } = r.data.data;
  updateReportsBadge(open_posts || 0);

  if (!reports.length) {
    const filtered = ADMIN_REPORTS.q || ADMIN_REPORTS.reason || ADMIN_REPORTS.status !== "open";
    tableBox.innerHTML = `<div class="in-empty">${filtered ? "No reports match." : "Nothing in the queue — reported posts will appear here."}</div>`;
    pager.innerHTML = "";
    return;
  }

  tableBox.innerHTML = "";
  const table = el(`
    <table class="in-admin-table in-report-table">
      <thead><tr>
        <th>Reported post</th><th>Author</th><th>Reasons</th><th>Reports</th><th>Last</th><th></th>
      </tr></thead>
      <tbody></tbody>
    </table>`);
  const tbody = table.querySelector("tbody");

  reports.forEach(rep => {
    tbody.appendChild(buildReportRow(rep, msg));
    tbody.appendChild(buildReportDetailRow(rep));
  });

  tableBox.appendChild(table);
  adminPager(pager, ADMIN_REPORTS, total, page, limit, "reports", loadAdminReports);
}

// ---- one queue row ----------------------------------------------------
function buildReportRow(rep, msg) {
  const deleted = rep.post_deleted;
  const isCo    = rep.author_type === "company";
  const label   = deleted
    ? "(post deleted)"
    : (rep.snippet || (rep.has_media ? "(image post)" : `(${rep.post_type} post)`));

  const chips = rep.reasons.map(x =>
    `<span class="in-report-chip">${esc(REPORT_REASON_SHORT[x.key] || x.label)}</span>`).join("");

  const authorCell = deleted || !rep.author_uuid
    ? `<span class="in-admin-name">—</span>`
    : `<a href="#${isCo ? "company" : "user"}/${esc(rep.author_uuid)}" style="color:var(--in-accent);text-decoration:none">${
        isCo ? esc(rep.author_name || "Unknown") : "@" + esc(rep.author_name || "unknown")}</a>`;

  const postCell = deleted
    ? `<span class="in-admin-snippet in-report-gone">${esc(label)}</span>`
    : `<a href="#post/${rep.post_id}" class="in-admin-snippet" title="Open post" style="text-decoration:none;display:block">${esc(label)}</a>`;

  // open_count separates live work from history when viewing "All".
  const countCell = rep.open_count > 0 && rep.open_count !== rep.report_count
    ? `${rep.report_count} <span class="in-admin-name">(${rep.open_count} open)</span>`
    : String(rep.report_count);

  const row = el(`
    <tr class="in-report-row">
      <td>
        <button class="in-report-toggle" data-toggle aria-expanded="false" title="Show reporters">▸</button>
        ${postCell}
      </td>
      <td>${authorCell}</td>
      <td class="in-report-chips">${chips}</td>
      <td>${countCell}</td>
      <td style="white-space:nowrap">${esc((rep.last_reported || "").slice(0, 10))}</td>
      <td class="in-report-actions"></td>
    </tr>`);

  // ---- expand / collapse ---------------------------------------------
  const toggle = row.querySelector("[data-toggle]");
  const syncToggle = () => {
    const open = REPORTS_EXPANDED.has(rep.post_id);
    toggle.textContent = open ? "▾" : "▸";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const detail = row.nextElementSibling;
    if (detail && detail.classList.contains("in-report-detail")) detail.hidden = !open;
  };
  toggle.onclick = () => {
    if (REPORTS_EXPANDED.has(rep.post_id)) REPORTS_EXPANDED.delete(rep.post_id);
    else REPORTS_EXPANDED.add(rep.post_id);
    syncToggle();
  };
  // Defer: the detail row is appended after this one, so it doesn't
  // exist yet at build time.
  setTimeout(syncToggle, 0);

  // ---- actions --------------------------------------------------------
  const actions = row.querySelector(".in-report-actions");
  const hasOpen = rep.open_count > 0;

  const act = async (action, confirmOpts) => {
    if (confirmOpts && !(await confirmDialog(confirmOpts.message, confirmOpts))) return;
    const res = await api("/admin/resolve-report.php", "POST", { post_id: rep.post_id, action });
    if (res.ok && res.data?.success) {
      adminNotify(msg, "ok", confirmOpts?.okText || "Reports updated.");
      loadAdminReports();
    } else {
      adminNotify(msg, "err", res.data?.error || "Could not update these reports.");
    }
  };

  if (rep.post_deleted) {
    // Nothing left to moderate — the only useful action is clearing
    // the orphaned rows out of the queue.
    const clear = el(`<button class="in-btn-mini" title="Remove these reports from the queue">Clear</button>`);
    clear.onclick = () => act("purge", {
      message: `The post is already deleted. Remove its ${rep.report_count} report${rep.report_count === 1 ? "" : "s"} from the queue?`,
      confirmText: "Clear", okText: "Reports cleared.",
    });
    actions.appendChild(clear);
  } else if (hasOpen) {
    const del = el(`<button class="in-btn-mini danger" title="Delete the post and close its reports">Delete post</button>`);
    del.onclick = async () => {
      const ok = await confirmDialog(
        `Delete this post by ${rep.author_name || "unknown"}? This can't be undone. Its ${rep.open_count} open report${rep.open_count === 1 ? "" : "s"} will be marked reviewed.`,
        { confirmText: "Delete post", danger: true }
      );
      if (!ok) return;
      const res = await api("/posts/delete.php", "POST", { id: rep.post_id });
      if (!res.ok || !res.data?.success) {
        adminNotify(msg, "err", res.data?.error || "Could not delete the post.");
        return;
      }
      // Post is gone; settle the reports so the row leaves the queue.
      // If this second call fails the post is still deleted, so say so
      // rather than implying nothing happened.
      const res2 = await api("/admin/resolve-report.php", "POST", { post_id: rep.post_id, action: "reviewed" });
      if (res2.ok && res2.data?.success) adminNotify(msg, "ok", "Post deleted and reports closed.");
      else adminNotify(msg, "err", "Post deleted, but its reports could not be closed. Use Clear to remove them.");
      loadAdminReports();
    };

    const keep = el(`<button class="in-btn-mini" title="Report was valid and handled">Reviewed</button>`);
    keep.onclick = () => act("reviewed", {
      message: `Mark ${rep.open_count} report${rep.open_count === 1 ? "" : "s"} against this post as reviewed? The post stays up.`,
      confirmText: "Mark reviewed", okText: "Marked reviewed.",
    });

    const dismiss = el(`<button class="in-btn-mini" title="Report was not actionable">Dismiss</button>`);
    dismiss.onclick = () => act("dismissed", {
      message: `Dismiss ${rep.open_count} report${rep.open_count === 1 ? "" : "s"} against this post?`,
      confirmText: "Dismiss", okText: "Reports dismissed.",
    });

    actions.append(del, keep, dismiss);
  } else {
    const reopen = el(`<button class="in-btn-mini" title="Put this back in the queue">Reopen</button>`);
    reopen.onclick = () => act("reopen", {
      message: `Reopen ${rep.report_count} report${rep.report_count === 1 ? "" : "s"} against this post?`,
      confirmText: "Reopen", okText: "Reports reopened.",
    });
    actions.appendChild(reopen);
  }

  return row;
}

// ---- expandable reporter detail --------------------------------------
function buildReportDetailRow(rep) {
  const items = rep.reporters.map(rp => {
    const who  = rp.reporter_name
      ? (rp.reporter_type === "company" ? esc(rp.reporter_name) : "@" + esc(rp.reporter_name))
      : "(deleted account)";
    const when = (rp.created_at || "").slice(0, 10);
    return `
      <li class="in-report-item">
        <div class="in-report-item-head">
          <span class="in-report-chip">${esc(REPORT_REASON_SHORT[rp.reason] || rp.reason_label)}</span>
          <span class="in-admin-name">${who} · ${esc(when)}</span>
          <span class="in-report-status is-${esc(rp.status)}">${esc(rp.status)}</span>
        </div>
        ${rp.detail ? `<div class="in-report-item-detail">${esc(rp.detail)}</div>` : ""}
      </li>`;
  }).join("");

  const capped = rep.report_count > rep.reporters.length
    ? `<li class="in-report-item"><span class="in-admin-name">…and ${rep.report_count - rep.reporters.length} more.</span></li>`
    : "";

  const row = el(`
    <tr class="in-report-detail" hidden>
      <td colspan="6">
        <ul class="in-report-list">${items}${capped}</ul>
      </td>
    </tr>`);
  return row;
}

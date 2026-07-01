// =====================================================================
// connect.js — Connect page (#connect)
//   Search users and companies; follow/unfollow inline. Clicking a
//   result opens its public profile (user or company).
// =====================================================================

let CONNECT_STATE = { q: "", type: "all", page: 1, limit: 20 };

async function renderConnect() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === "connect"));
  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  wrap.appendChild(el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px">Connect</h2>
      <div class="in-empty" style="font-style:normal;margin:-6px 0 14px">Find and follow people and companies.</div>
      <div class="in-admin-toolbar">
        <input type="text" id="connect-q" placeholder="Search by name, company, industry, location…" value="${esc(CONNECT_STATE.q)}">
      </div>
      <div class="in-feedtabs" id="connect-tabs">
        <button data-ctype="all">All</button>
        <button data-ctype="users">People</button>
        <button data-ctype="companies">Companies</button>
      </div>
      <div id="connect-results"></div>
      <div class="in-admin-pager" id="connect-pager"></div>
    </div>`));

  // tab state
  const tabs = wrap.querySelector("#connect-tabs");
  const syncTabs = () => tabs.querySelectorAll("[data-ctype]").forEach(b => b.classList.toggle("active", b.dataset.ctype === CONNECT_STATE.type));
  syncTabs();
  tabs.querySelectorAll("[data-ctype]").forEach(b => {
    b.onclick = () => { CONNECT_STATE.type = b.dataset.ctype; CONNECT_STATE.page = 1; syncTabs(); loadConnect(); };
  });

  $("connect-q").addEventListener("input", debounce(() => {
    CONNECT_STATE.q = $("connect-q").value.trim();
    CONNECT_STATE.page = 1;
    loadConnect();
  }, 350));

  loadConnect();
}

async function loadConnect() {
  const box = $("connect-results");
  const pager = $("connect-pager");
  box.innerHTML = `<div class="in-loading">Searching…</div>`;

  const params = new URLSearchParams({ type: CONNECT_STATE.type, page: CONNECT_STATE.page, limit: CONNECT_STATE.limit });
  if (CONNECT_STATE.q) params.set("q", CONNECT_STATE.q);

  const r = await api("/connect/search.php?" + params.toString());
  if (!r.ok || !r.data?.success) { box.innerHTML = `<div class="in-empty">Could not load results.</div>`; pager.innerHTML = ""; return; }

  const { results, total, page, limit } = r.data.data;
  if (!results.length) { box.innerHTML = `<div class="in-empty">${CONNECT_STATE.q ? "No matches found." : "Nothing to show yet."}</div>`; pager.innerHTML = ""; return; }

  box.innerHTML = "";
  // Only logged-in USERS can follow people/companies; a company session
  // browsing Connect sees results without a follow button.
  const canFollow = !!ME && !CO;
  results.forEach(res => {
    const avatarChar = (res.title || "?").charAt(0).toUpperCase();
    const isCompany = res.kind === "company";
    const sub = [res.subtitle, res.location].filter(Boolean).join(" · ");
    const verified = res.verified ? ` <span class="post-tag" style="vertical-align:middle">Verified</span>` : "";

    const row = el(`
      <div class="connect-row">
        <div class="connect-ava ${isCompany ? "company" : ""}">${res.image ? `<img src="${esc(res.image)}" alt="">` : esc(avatarChar)}</div>
        <div class="connect-main">
          <div class="connect-title">${isCompany ? esc(res.title) : "@" + esc(res.title)}${verified}</div>
          <div class="connect-sub">${esc(sub || (isCompany ? "Company" : "Member"))}</div>
        </div>
        ${canFollow ? `<button class="in-follow-btn connect-follow ${res.following ? "following" : ""}" style="width:auto;flex:none;margin-top:0;padding:8px 18px">${res.following ? "Following" : "Follow"}</button>` : ""}
      </div>`);

    // Navigate to the public profile when clicking the row (but not the button).
    row.addEventListener("click", (e) => {
      if (e.target.closest(".connect-follow")) return;
      location.hash = (isCompany ? "company/" : "user/") + res.uuid;
    });

    const btn = row.querySelector(".connect-follow");
    if (btn) {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const following = btn.classList.contains("following");
        btn.disabled = true;
        const endpoint = following ? "/follow/unfollow.php" : "/follow/follow.php";
        const resp = await api(endpoint, "POST", { target_type: res.kind, target_uuid: res.uuid });
        if (resp.ok && resp.data?.success) {
          btn.classList.toggle("following");
          btn.textContent = btn.classList.contains("following") ? "Following" : "Follow";
        } else {
          alert(resp.data?.error || "Could not update follow status.");
        }
        btn.disabled = false;
      };
    }

    box.appendChild(row);
  });

  const totalPages = Math.max(1, Math.ceil(total / limit));
  pager.innerHTML = "";
  if (totalPages > 1) {
    const prev = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>`);
    const info = el(`<span class="in-admin-pageinfo">Page ${page} of ${totalPages} · ${total} results</span>`);
    const next = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page >= totalPages ? "disabled" : ""}>Next ›</button>`);
    prev.onclick = () => { CONNECT_STATE.page = Math.max(1, page - 1); loadConnect(); };
    next.onclick = () => { CONNECT_STATE.page = Math.min(totalPages, page + 1); loadConnect(); };
    pager.append(prev, info, next);
  }
}
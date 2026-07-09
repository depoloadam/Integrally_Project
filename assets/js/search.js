// =====================================================================
// search.js — top-nav search
//   • The nav 🔍 icon toggles a drop-down bar below the nav.
//   • The bar is only an ENTRY POINT: submitting navigates to the
//     dedicated Search results page (#search/<query>). No searching or
//     results happen in the bar itself.
//   • renderSearchPage() draws the results tab (people + companies +
//     jobs), with kind filters and inline follow for people/companies.
// =====================================================================

let SEARCH_STATE = { q: "", type: "all", page: 1, limit: 20 };

// ---- drop-down bar (entry point) -------------------------------------
// On the search page the bar is PINNED: it stays open, doesn't close on
// submit / click-away / Escape, and lets the user re-query in place.
// Elsewhere it behaves as a transient drop-down.
let SEARCHBAR_PINNED = false;

function setSearchbarPinned(on) {
  SEARCHBAR_PINNED = !!on;
  const bar     = $("searchbar");
  const trigger = $("search-trigger");
  const input   = $("searchbar-input");
  const closeBtn= $("searchbar-close");
  if (!bar) return;
  if (on) {
    bar.classList.add("open", "pinned");
    bar.setAttribute("aria-hidden", "false");
    if (trigger) { trigger.classList.add("open"); trigger.setAttribute("aria-expanded", "true"); }
    if (closeBtn) closeBtn.style.display = "none";   // no close affordance when pinned
    if (input && SEARCH_STATE.q) input.value = SEARCH_STATE.q;
  } else {
    bar.classList.remove("pinned");
    if (closeBtn) closeBtn.style.display = "";
  }
}

function initSearchBar() {
  const trigger = $("search-trigger");
  const bar     = $("searchbar");
  const input   = $("searchbar-input");
  const goBtn   = $("searchbar-go");
  const closeBtn= $("searchbar-close");
  if (!trigger || !bar || !input) return;

  const openBar = () => {
    bar.classList.add("open");
    bar.setAttribute("aria-hidden", "false");
    trigger.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    if (SEARCH_STATE.q) input.value = SEARCH_STATE.q;
    setTimeout(() => input.focus(), 60);
  };
  const closeBar = () => {
    if (SEARCHBAR_PINNED) return;   // pinned bar never closes
    bar.classList.remove("open");
    bar.setAttribute("aria-hidden", "true");
    trigger.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
  };
  const toggleBar = () => (bar.classList.contains("open") && !SEARCHBAR_PINNED ? closeBar() : openBar());

  const submit = () => {
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    if (SEARCHBAR_PINNED) {
      // Already on the search page: re-query in place, keep bar open.
      if (q !== SEARCH_STATE.q) location.hash = "search/" + encodeURIComponent(q);
      input.blur();
      return;
    }
    closeBar();
    location.hash = "search/" + encodeURIComponent(q);
  };

  trigger.onclick = toggleBar;
  goBtn.onclick = submit;
  if (closeBtn) closeBtn.onclick = closeBar;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "Escape") { if (!SEARCHBAR_PINNED) closeBar(); else input.blur(); }
  });

  // Click-away closes the transient bar only (never when pinned).
  document.addEventListener("click", (e) => {
    if (SEARCHBAR_PINNED) return;
    if (!bar.classList.contains("open")) return;
    if (e.target.closest("#searchbar") || e.target.closest("#search-trigger")) return;
    closeBar();
  });
}
document.addEventListener("DOMContentLoaded", initSearchBar);

// ---- results page (#search/<query>) ----------------------------------
async function renderSearchPage(rawQuery) {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.remove("active"));
  const q = (rawQuery ? decodeURIComponent(rawQuery) : "").trim();
  SEARCH_STATE.q = q;
  SEARCH_STATE.page = 1;
  SEARCH_STATE.type = "all";
  setSearchbarPinned(true);   // bar stays open + pinned on this page only

  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  wrap.appendChild(el(`
    <div class="in-card2">
      <div class="in-search-head">
        <h1>Search</h1>
        ${q ? `<span class="in-search-q">for “${esc(q)}”</span>` : ""}
      </div>
      <div class="in-search-tabs" id="search-tabs">
        <button class="in-search-tab active" data-stype="all">All</button>
        <button class="in-search-tab" data-stype="users">People<span class="in-search-tabn" data-count="users"></span></button>
        <button class="in-search-tab" data-stype="companies">Companies<span class="in-search-tabn" data-count="companies"></span></button>
        <button class="in-search-tab" data-stype="jobs">Jobs<span class="in-search-tabn" data-count="jobs"></span></button>
      </div>
      <div id="search-results"></div>
      <div class="in-admin-pager" id="search-pager"></div>
    </div>`));

  const tabs = wrap.querySelector("#search-tabs");
  tabs.querySelectorAll("[data-stype]").forEach(b => {
    b.onclick = () => {
      SEARCH_STATE.type = b.dataset.stype;
      SEARCH_STATE.page = 1;
      tabs.querySelectorAll("[data-stype]").forEach(x => x.classList.toggle("active", x === b));
      loadSearch();
    };
  });

  if (!q) {
    $("search-results").innerHTML = `<div class="in-empty">Type a query in the search bar to get started.</div>`;
    return;
  }
  loadSearch();
}

async function loadSearch() {
  const box   = $("search-results");
  const pager = $("search-pager");
  box.innerHTML = `<div class="in-loading">Searching…</div>`;

  const params = new URLSearchParams({
    q: SEARCH_STATE.q,
    type: SEARCH_STATE.type,
    page: SEARCH_STATE.page,
    limit: SEARCH_STATE.limit,
  });

  const r = await api("/search/global.php?" + params.toString());
  if (!r.ok || !r.data?.success) {
    box.innerHTML = `<div class="in-empty">Could not load results.</div>`;
    pager.innerHTML = "";
    return;
  }

  const { results, total, page, limit, counts } = r.data.data;

  // Update tab counts (from the full unpaged set).
  if (counts) {
    const set = (k, v) => { const s = document.querySelector(`[data-count="${k}"]`); if (s) s.textContent = v ? ` ${v}` : ""; };
    set("users", counts.users);
    set("companies", counts.companies);
    set("jobs", counts.jobs);
  }

  if (!results.length) {
    box.innerHTML = `<div class="in-empty">No matches found for “${esc(SEARCH_STATE.q)}”.</div>`;
    pager.innerHTML = "";
    return;
  }

  box.innerHTML = "";

  // In "All" view we group with labels; in a filtered view we don't.
  const grouped = SEARCH_STATE.type === "all";
  const labels = { user: "People", company: "Companies", job: "Jobs" };
  let lastKind = null;

  results.forEach(res => {
    if (grouped && res.kind !== lastKind) {
      box.appendChild(el(`<div class="in-search-group-label">${labels[res.kind] || ""}</div>`));
      lastKind = res.kind;
    }
    box.appendChild(res.kind === "job" ? jobRow(res) : entityRow(res));
  });

  // Pager
  const totalPages = Math.max(1, Math.ceil(total / limit));
  pager.innerHTML = "";
  if (totalPages > 1) {
    const prev = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>`);
    const info = el(`<span class="in-admin-pageinfo">Page ${page} of ${totalPages} · ${total} results</span>`);
    const next = el(`<button class="in-btn ghost" style="flex:none;padding:7px 14px" ${page >= totalPages ? "disabled" : ""}>Next ›</button>`);
    prev.onclick = () => { if (SEARCH_STATE.page > 1) { SEARCH_STATE.page--; loadSearch(); window.scrollTo(0, 0); } };
    next.onclick = () => { if (SEARCH_STATE.page < totalPages) { SEARCH_STATE.page++; loadSearch(); window.scrollTo(0, 0); } };
    pager.append(prev, info, next);
  }
}

// ---- user / company result row (mirrors connect-row) -----------------
function entityRow(res) {
  const isCompany = res.kind === "company";
  const isSelfRow = !!CO && isCompany && res.uuid === CO.uuid;
  const canFollow = !!(ME || CO) && !isSelfRow;
  const avatarChar = (res.title || "?").charAt(0).toUpperCase();
  const jobLine = res.job ? (res.job.company ? [res.job.title, res.job.company].filter(Boolean).join(" @ ") : (res.job.title || "")) : "";
  const verified = res.verified ? ` <span class="post-tag" style="vertical-align:middle">Verified</span>` : "";

  const mainLine = isCompany ? esc(res.title) : esc(res.subtitle || "@" + res.title);
  const subLine  = isCompany
    ? esc(res.subtitle || "Company")
    : (res.subtitle ? "@" + esc(res.title) : "Member");
  const jobHtml = jobLine ? `<b>${esc(jobLine)}</b>` : "";
  const locHtml = res.location ? esc(res.location) : "";
  const detailHtml = isCompany ? locHtml : [jobHtml, locHtml].filter(Boolean).join(" - ");

  const row = el(`
    <div class="connect-row">
      <div class="connect-ava ${isCompany ? "company" : ""}">${res.image ? `<img src="${esc(res.image)}" alt="">` : esc(avatarChar)}</div>
      <div class="connect-main">
        <div class="connect-title">${mainLine}${verified}</div>
        <div class="connect-sub">${subLine}</div>
      </div>
      ${detailHtml ? `<div class="connect-details">${detailHtml}</div>` : ""}
      ${canFollow ? `<button class="in-follow-btn connect-follow ${res.following ? "following" : ""}" style="width:auto;flex:none;margin-top:0;padding:8px 18px">${res.following ? "Following" : "Follow"}</button>` : ""}
    </div>`);

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
  return row;
}

// ---- job result row --------------------------------------------------
function jobRow(res) {
  const avatarChar = (res.subtitle || res.title || "?").charAt(0).toUpperCase();
  const empMap = { "full-time": "Full-time", "part-time": "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary" };
  const remoteMap = { remote: "Remote", hybrid: "Hybrid", on_site: "On-site", onsite: "On-site" };
  const chips = [];
  if (res.employment_type) chips.push(esc(empMap[res.employment_type] || res.employment_type));
  if (res.remote_policy)   chips.push(esc(remoteMap[res.remote_policy] || res.remote_policy));
  const salary = fmtSalary(res.salary_min, res.salary_max, res.salary_currency);

  const detailBits = [];
  if (res.subtitle) detailBits.push(esc(res.subtitle));
  if (res.location) detailBits.push(esc(res.location));

  const row = el(`
    <div class="connect-row">
      <div class="connect-ava company">${res.image ? `<img src="${esc(res.image)}" alt="">` : esc(avatarChar)}</div>
      <div class="connect-main">
        <div class="connect-title">${esc(res.title)}</div>
        <div class="connect-sub">${detailBits.join(" · ") || "Job"}</div>
        ${(chips.length || salary) ? `<div class="in-jobchips">
          ${chips.map(c => `<span class="in-jobchip">${c}</span>`).join("")}
          ${salary ? `<span class="in-jobchip salary">${esc(salary)}</span>` : ""}
        </div>` : ""}
      </div>
    </div>`);

  row.addEventListener("click", () => { location.hash = "job/" + res.uuid; });
  return row;
}

function fmtSalary(min, max, cur) {
  if (min == null && max == null) return "";
  const sym = cur === "USD" || !cur ? "$" : (cur + " ");
  const k = (n) => (n >= 1000 ? Math.round(n / 1000) + "k" : String(n));
  if (min != null && max != null) return `${sym}${k(min)}–${k(max)}`;
  if (min != null) return `${sym}${k(min)}+`;
  return `Up to ${sym}${k(max)}`;
}

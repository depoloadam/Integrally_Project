// =====================================================================
// connect.js — Connect page (#connect)
//   Two modes in one page:
//     - No query  -> ranked SUGGESTIONS (api/connect/suggestions.php),
//                    each with a reason line. No pager: a suggestion list
//                    is a short curated set, not a browsable directory.
//     - Query      -> the existing paged search (api/connect/search.php).
//   Follow/unfollow inline; clicking a row opens the public profile.
// =====================================================================

let CONNECT_STATE = { q: "", type: "all", page: 1, limit: 20 };
const CONNECT_SUGGEST_LIMIT = 12;
// Offset for "Browse more" — reset on every tab change / new query.
let CONNECT_SUGGEST_OFFSET = 0;

async function renderConnect() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === "connect"));
  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`<div class="in-admin"></div>`);
  view.appendChild(wrap);

  wrap.appendChild(el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:18px;letter-spacing:-0.2px">Connect</h2>
      <div class="in-empty" style="font-style:normal;margin:-6px 0 14px" id="connect-blurb">Find and follow people and companies.</div>
      <div class="in-admin-toolbar">
        <input type="text" id="connect-q" placeholder="Search by name, company, industry, location…" value="${esc(CONNECT_STATE.q)}">
      </div>
      <div class="in-feedtabs" id="connect-tabs">
        <button data-ctype="all">All</button>
        <button data-ctype="users">People</button>
        <button data-ctype="companies">Companies</button>
      </div>
      <div class="connect-secline" id="connect-secline"></div>
      <div id="connect-results"></div>
      <div class="in-admin-pager" id="connect-pager"></div>
    </div>`));

  // tab state
  const tabs = wrap.querySelector("#connect-tabs");
  const syncTabs = () => tabs.querySelectorAll("[data-ctype]").forEach(b => b.classList.toggle("active", b.dataset.ctype === CONNECT_STATE.type));
  syncTabs();
  tabs.querySelectorAll("[data-ctype]").forEach(b => {
    b.onclick = () => { CONNECT_STATE.type = b.dataset.ctype; CONNECT_STATE.page = 1; CONNECT_SUGGEST_OFFSET = 0; syncTabs(); loadConnect(); };
  });

  $("connect-q").addEventListener("input", debounce(() => {
    CONNECT_STATE.q = $("connect-q").value.trim();
    CONNECT_STATE.page = 1;
    CONNECT_SUGGEST_OFFSET = 0;
    loadConnect();
  }, 350));

  loadConnect();
}

async function loadConnect() {
  const box = $("connect-results");
  const pager = $("connect-pager");
  const secline = $("connect-secline");
  const suggesting = !CONNECT_STATE.q;
  box.innerHTML = `<div class="in-loading">${suggesting ? "Finding suggestions…" : "Searching…"}</div>`;
  pager.innerHTML = "";

  let results, total, page, limit;

  let hasMore = false;

  if (suggesting) {
    CONNECT_SUGGEST_OFFSET = 0;   // a fresh load always starts from the top
    const params = new URLSearchParams({ type: CONNECT_STATE.type, limit: CONNECT_SUGGEST_LIMIT, offset: 0 });
    const r = await api("/connect/suggestions.php?" + params.toString());
    if (!r.ok || !r.data?.success) {
      box.innerHTML = `<div class="in-empty">Could not load suggestions.</div>`;
      if (secline) secline.textContent = "";
      return;
    }
    results = r.data.data.results || [];
    hasMore = !!r.data.data.has_more;
    CONNECT_SUGGEST_OFFSET = results.length;
    if (secline) {
      secline.textContent = results.length
        ? (CONNECT_STATE.type === "companies" ? "Companies you may want to follow"
          : CONNECT_STATE.type === "users"    ? "People you may want to follow"
          : "Suggested for you")
        : "";
    }
    if (!results.length) {
      box.innerHTML = `<div class="in-empty">No suggestions yet — try searching by name, company, or location.</div>`;
      return;
    }
  } else {
    if (secline) secline.textContent = "";
    const params = new URLSearchParams({ type: CONNECT_STATE.type, page: CONNECT_STATE.page, limit: CONNECT_STATE.limit });
    params.set("q", CONNECT_STATE.q);
    const r = await api("/connect/search.php?" + params.toString());
    if (!r.ok || !r.data?.success) { box.innerHTML = `<div class="in-empty">Could not load results.</div>`; return; }
    ({ results, total, page, limit } = r.data.data);
    if (!results.length) { box.innerHTML = `<div class="in-empty">No matches found.</div>`; return; }
  }

  box.innerHTML = "";
  appendConnectRows(box, results);

  if (suggesting) {
    renderBrowseMore(pager, hasMore);
    return;   // suggestions are a curated set — no page numbers
  }

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

// ---- "Browse more" ----------------------------------------------------
// Appends the next batch of suggestions in place. The server returns rows
// in a deterministic order and we advance a simple offset, so nobody is
// repeated or skipped between batches.
function renderBrowseMore(pager, hasMore) {
  pager.innerHTML = "";
  if (!hasMore) return;

  const btn = el(`<button class="in-btn ghost connect-more" id="connect-more">Browse more…</button>`);
  pager.appendChild(btn);

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Loading…";
    const params = new URLSearchParams({
      type: CONNECT_STATE.type,
      limit: CONNECT_SUGGEST_LIMIT,
      offset: CONNECT_SUGGEST_OFFSET,
    });
    const r = await api("/connect/suggestions.php?" + params.toString());
    if (!r.ok || !r.data?.success) {
      btn.disabled = false;
      btn.textContent = "Browse more…";
      toast("Could not load more suggestions.", "err");
      return;
    }
    const more = r.data.data.results || [];
    CONNECT_SUGGEST_OFFSET += more.length;
    appendConnectRows($("connect-results"), more);

    if (r.data.data.has_more && more.length) {
      btn.disabled = false;
      btn.textContent = "Browse more…";
    } else {
      // Nothing left — retire the button rather than leaving a dead one.
      pager.innerHTML = `<div class="in-empty" style="margin:0">That's everyone for now.</div>`;
    }
  };
}

// Renders result rows into a container. Used for the initial paint AND
// for each "Browse more" batch, so both look and behave identically.
function appendConnectRows(box, results) {
  // Any signed-in identity — user OR company — can follow. The only
  // exception: a company doesn't get a follow button on its own row.
  results.forEach(res => {
    const isCompany = res.kind === "company";
    const isSelfRow = !!CO && isCompany && res.uuid === CO.uuid;
    const canFollow = !!(ME || CO) && !isSelfRow;
    const avatarChar = (res.title || "?").charAt(0).toUpperCase();
    const jobLine = res.job ? (res.job.company ? [res.job.title, res.job.company].filter(Boolean).join(" @ ") : (res.job.title || "")) : "";
    const verified = res.verified ? ` <span class="post-tag" style="vertical-align:middle">Verified</span>` : "";

    // Users: full name is the main line (fallback to @username when no name),
    // with the @username in smaller text beneath. Companies keep name/industry.
    const mainLine = isCompany ? esc(res.title) : esc(res.subtitle || "@" + res.title);
    const subLine  = isCompany
      ? esc(res.subtitle || "Company")
      : (res.subtitle ? "@" + esc(res.title) : "Member");
    // Right-hand detail line: "**Title @ Company** - Location", vertically
    // centered. Bold job, plain location, joined by " - " only when both exist.
    const jobHtml = jobLine ? `<b>${esc(jobLine)}</b>` : "";
    const locHtml = res.location ? esc(res.location) : "";
    const detailHtml = isCompany
      ? locHtml
      : [jobHtml, locHtml].filter(Boolean).join(" - ");

    const row = el(`
      <div class="connect-row">
        <div class="connect-ava ${isCompany ? "company" : ""}">${res.image ? `<img src="${esc(res.image)}" alt="">` : esc(avatarChar)}</div>
        <div class="connect-main">
          <div class="connect-title">${mainLine}${verified}</div>
          <div class="connect-sub">${subLine}</div>
          ${res.reason ? `<div class="connect-reason">${esc(res.reason)}</div>` : ""}
        </div>
        ${detailHtml ? `<div class="connect-details">${detailHtml}</div>` : ""}
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

}
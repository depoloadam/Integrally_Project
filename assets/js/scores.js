// =====================================================================
// FILE: assets/js/scores.js
// The Scores hub — the platform's flagship page. Sits between Feed and
// Connect. Pulls everything from api/score/insights.php in one call and
// composes four regions:
//
//   1. Summary  — your score count, your mean, and your strongest target.
//   2. Your scores — a TABBED panel, one tab per scored target. Each tab
//                    shows that target's badge, where you sit on the
//                    red->green rail, and how you compare to the community
//                    (average + percentile), plus links into the existing
//                    full-breakdown / history detail pages.
//   3. Averages — platform means by target type, with your own mean
//                 overlaid so "how do I stack up" is answerable at a glance.
//   4. Trending — the most-active titles and industries right now, so the
//                 page doubles as a place to discover what to score next.
//
// Everything reuses the existing score design language (.in-score-badge,
// .score-bar, .in-card2) so the page reads as native, not bolted on. New
// structure gets .in-scores-* classes scoped in app.css.
//
// State is kept module-level so re-entering the tab (or re-scoring
// elsewhere and coming back) restores the last-open target tab.
// =====================================================================

let SCORES_STATE = { activeTarget: null };   // "type|value" of open tab
let SCORES_CACHE = null;                     // last insights payload

async function renderScores() {
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === "scores"));

  if (!ME) { renderSignedOut(); return; }

  const view = $("view");
  view.innerHTML = "";
  const wrap = el(`<div class="in-scores"></div>`);
  view.appendChild(wrap);

  // Loading shell — quiet, matches the app's other pages.
  wrap.appendChild(el(`<div class="in-empty" id="scores-loading" style="font-style:normal;padding:28px 0">Loading your scores…</div>`));

  let data;
  try {
    data = await api("/score/insights.php");
  } catch (e) {
    wrap.innerHTML = "";
    wrap.appendChild(el(`
      <div class="in-card2">
        <div class="in-empty" style="font-style:normal">Couldn't load your scores just now. Refresh to try again.</div>
      </div>`));
    return;
  }
  SCORES_CACHE = data;
  wrap.innerHTML = "";

  const personal = Array.isArray(data.personal) ? data.personal : [];

  // ---- Region 1: summary -------------------------------------------
  wrap.appendChild(buildSummary(data, personal));

  // ---- Region 2: your scores (tabbed) ------------------------------
  wrap.appendChild(buildPersonalPanel(personal));

  // ---- Region 3: averages ------------------------------------------
  wrap.appendChild(buildAverages(data, personal));

  // ---- Region 4: trending ------------------------------------------
  wrap.appendChild(buildTrending(data));
}

// ---------------------------------------------------------------------
// Region 1 — summary hero. Three plain facts, no invented metrics: how
// many targets you've scored, your mean across them, and your strongest.
// ---------------------------------------------------------------------
function buildSummary(data, personal) {
  const mean = data.personal_mean;
  const count = personal.length;
  const strongest = personal.reduce((best, p) =>
    (!best || p.score_value > best.score_value) ? p : best, null);

  const card = el(`<div class="in-card2 in-scores-hero"></div>`);

  if (count === 0) {
    card.appendChild(el(`
      <div class="in-scores-hero-empty">
        <div class="in-scores-hero-title">You haven't scored yet</div>
        <div class="in-empty" style="font-style:normal;margin:2px 0 14px">
          Score yourself against a job title, skill, or field to see where you stand.
        </div>
        <button class="in-btn primary" id="scores-go-score" style="flex:none;padding:9px 16px">Score me →</button>
      </div>`));
    card.querySelector("#scores-go-score").onclick = () => { location.hash = "profile"; };
    return card;
  }

  const meanVal = mean != null ? Math.round(mean) : "—";
  card.appendChild(el(`
    <div class="in-scores-hero-grid">
      <div class="in-scores-stat">
        <div class="in-scores-stat-num">${count}</div>
        <div class="in-scores-stat-lbl">${count === 1 ? "target scored" : "targets scored"}</div>
      </div>
      <div class="in-scores-stat">
        <div class="in-scores-stat-num">${meanVal}</div>
        <div class="in-scores-stat-lbl">your average score</div>
      </div>
      <div class="in-scores-stat in-scores-stat-strong">
        <div class="in-score-badge in-scores-hero-badge">${Math.round(strongest.score_value)}</div>
        <div class="in-scores-stat-strongmeta">
          <div class="in-scores-stat-lbl">strongest</div>
          <div class="in-scores-stat-strongval">${esc(strongest.target_value)}</div>
        </div>
      </div>
    </div>`));
  return card;
}

// ---------------------------------------------------------------------
// Region 2 — the signature: one tab per scored target. Selecting a tab
// swaps the panel body to that target's standing.
// ---------------------------------------------------------------------
function buildPersonalPanel(personal) {
  const card = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:16px;letter-spacing:-0.2px">Your scores</h2>
      <div class="in-empty" style="font-style:normal;margin:-8px 0 12px">Each tab is one thing you've scored against. See where you stand and how you compare.</div>
    </div>`);

  if (personal.length === 0) {
    card.appendChild(el(`<div class="in-empty" style="font-style:normal">Nothing scored yet — your targets will appear here as tabs.</div>`));
    return card;
  }

  // Restore or default the active tab.
  const keyOf = p => p.target_type + "|" + p.target_value;
  if (!SCORES_STATE.activeTarget || !personal.some(p => keyOf(p) === SCORES_STATE.activeTarget)) {
    SCORES_STATE.activeTarget = keyOf(personal[0]);
  }

  // Tab strip — horizontally scrollable if many targets (mirrors sub-nav).
  const tabs = el(`<div class="in-scores-tabs" role="tablist"></div>`);
  personal.forEach(p => {
    const k = keyOf(p);
    const b = el(`
      <button class="in-scores-tab" role="tab" data-target="${esc(k)}">
        <span class="in-scores-tab-badge">${Math.round(p.score_value)}</span>
        <span class="in-scores-tab-name">${esc(p.target_value)}</span>
      </button>`);
    tabs.appendChild(b);
  });
  card.appendChild(tabs);

  const body = el(`<div class="in-scores-panel" role="tabpanel"></div>`);
  card.appendChild(body);

  const syncTabs = () => {
    tabs.querySelectorAll(".in-scores-tab").forEach(b =>
      b.classList.toggle("active", b.dataset.target === SCORES_STATE.activeTarget));
  };
  const paint = () => {
    syncTabs();
    const p = personal.find(x => keyOf(x) === SCORES_STATE.activeTarget) || personal[0];
    body.innerHTML = "";
    body.appendChild(buildTargetStanding(p));
  };
  tabs.querySelectorAll(".in-scores-tab").forEach(b => {
    b.onclick = () => { SCORES_STATE.activeTarget = b.dataset.target; paint(); };
  });
  paint();
  return card;
}

// One target's standing: big badge, the red->green rail with your marker
// AND a community-average marker, the comparison line, and detail links.
function buildTargetStanding(p) {
  const val = Math.max(0, Math.min(100, Math.round(p.score_value)));
  const typeLabel = esc(p.target_type.replace("_", " "));
  const date = new Date(p.created_at).toLocaleDateString();
  const avg = p.community_avg;
  const pool = p.pool_size || 0;
  const top = p.top_percent;

  // Comparison sentence — plain language, honest about thin pools.
  let compareLine;
  if (pool <= 1) {
    compareLine = `You're the first to score against ${esc(p.target_value)}. As others join, you'll see how you compare.`;
  } else if (top != null) {
    const vsAvg = avg != null
      ? (val >= avg ? `above the community average of ${Math.round(avg)}` : `below the community average of ${Math.round(avg)}`)
      : "";
    compareLine = `You're in the <strong>top ${Math.max(1, top)}%</strong> of ${pool} people scored against this${vsAvg ? ", " + vsAvg : ""}.`;
  } else {
    compareLine = `${pool} people have scored against this${avg != null ? `, averaging ${Math.round(avg)}` : ""}.`;
  }

  const avgPct = avg != null ? Math.max(0, Math.min(100, avg)) : null;

  const node = el(`
    <div class="in-scores-standing">
      <div class="in-scores-standing-head">
        <div class="in-score-badge in-scores-standing-badge">${val}</div>
        <div class="in-scores-standing-meta">
          <div class="in-scores-standing-target">${esc(p.target_value)}${p.hidden ? '<span class="score-hidden-tag">Hidden</span>' : ""}</div>
          <div class="in-scores-standing-sub">${typeLabel} · last scored ${date}</div>
        </div>
      </div>

      <div class="score-bar in-scores-standing-bar">
        <div class="score-bar-track"></div>
        ${avgPct != null ? `<div class="in-scores-avg-tick" style="left:${avgPct}%" title="Community average: ${Math.round(avg)}"></div>` : ""}
        <div class="score-bar-marker" style="left:${val}%"><div class="score-bar-arrow"></div></div>
      </div>
      <div class="in-scores-bar-legend">
        <span class="in-scores-legend-you"><span class="dot"></span>You (${val})</span>
        ${avgPct != null ? `<span class="in-scores-legend-avg"><span class="tick"></span>Avg (${Math.round(avg)})</span>` : ""}
      </div>

      <div class="in-scores-compare">${compareLine}</div>

      <div class="in-scores-standing-actions">
        <button class="in-btn ghost in-scores-full" style="flex:none;padding:8px 14px">View full breakdown →</button>
        <button class="in-btn ghost in-scores-hist" style="flex:none;padding:8px 14px">View history →</button>
      </div>
    </div>`);

  // Full breakdown needs the score id; insights doesn't carry it (it's a
  // per-target aggregate), so route via history which resolves by target.
  const encoded = encodeURIComponent(p.target_type + "|" + p.target_value);
  node.querySelector(".in-scores-hist").onclick = () => { location.hash = "score-history/" + encoded; };
  node.querySelector(".in-scores-full").onclick = () => { location.hash = "score-history/" + encoded; };
  return node;
}

// ---------------------------------------------------------------------
// Region 3 — platform averages by type, your own mean drawn alongside.
// ---------------------------------------------------------------------
function buildAverages(data, personal) {
  const bt = (data.averages && data.averages.by_type) || {};
  const overall = (data.averages && data.averages.overall) || { avg: null, samples: 0 };
  const yourMean = data.personal_mean;

  const TYPE_LABEL = { job_title: "Job titles", skill: "Skills", field: "Fields" };

  const card = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:16px;letter-spacing:-0.2px">How the platform scores</h2>
      <div class="in-empty" style="font-style:normal;margin:-8px 0 12px">Average scores across everyone${yourMean != null ? ", with your average marked" : ""}.</div>
    </div>`);

  const rows = el(`<div class="in-scores-avgrows"></div>`);
  ["job_title", "skill", "field"].forEach(t => {
    const a = bt[t] || { avg: null, samples: 0 };
    if (!a.samples) return;
    const avgPct = a.avg != null ? Math.max(0, Math.min(100, a.avg)) : 0;
    const youPct = yourMean != null ? Math.max(0, Math.min(100, yourMean)) : null;
    rows.appendChild(el(`
      <div class="in-scores-avgrow">
        <div class="in-scores-avgrow-top">
          <span class="in-scores-avgrow-lbl">${TYPE_LABEL[t]}</span>
          <span class="in-scores-avgrow-val">${Math.round(a.avg)} avg · ${a.samples} scored</span>
        </div>
        <div class="in-scores-avgbar">
          <div class="in-scores-avgbar-fill" style="width:${avgPct}%"></div>
          ${youPct != null ? `<div class="in-scores-avgbar-you" style="left:${youPct}%" title="Your average: ${Math.round(yourMean)}"></div>` : ""}
        </div>
      </div>`));
  });

  if (!rows.children.length) {
    card.appendChild(el(`<div class="in-empty" style="font-style:normal">Not enough scores across the platform yet to show averages.</div>`));
  } else {
    card.appendChild(rows);
    if (overall.avg != null) {
      card.appendChild(el(`<div class="in-scores-overall">Overall average across all ${overall.samples} scores: <strong>${Math.round(overall.avg)}</strong></div>`));
    }
  }
  return card;
}

// ---------------------------------------------------------------------
// Region 4 — trending titles / fields / skills. A discovery surface:
// what people are scoring against right now. Clicking pre-fills the
// score dialog on the profile (via hash the profile can read).
// ---------------------------------------------------------------------
function buildTrending(data) {
  const tr = data.trending || {};
  const card = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:16px;letter-spacing:-0.2px">Trending now</h2>
      <div class="in-empty" style="font-style:normal;margin:-8px 0 12px">The most-scored titles, fields, and skills across the platform.</div>
    </div>`);

  const groups = [
    ["job_title", "Job titles"],
    ["field", "Fields & industries"],
    ["skill", "Skills"],
  ];
  const cols = el(`<div class="in-scores-trend-cols"></div>`);
  let any = false;

  groups.forEach(([key, label]) => {
    const list = Array.isArray(tr[key]) ? tr[key] : [];
    if (!list.length) return;
    any = true;
    const col = el(`
      <div class="in-scores-trend-col">
        <div class="in-scores-trend-head">${label}</div>
      </div>`);
    list.forEach((item, i) => {
      const row = el(`
        <button class="in-scores-trend-item" data-type="${esc(key)}" data-value="${esc(item.target_value)}">
          <span class="in-scores-trend-rank">${i + 1}</span>
          <span class="in-scores-trend-name">${esc(item.target_value)}</span>
          <span class="in-scores-trend-stat">${item.pool_size} scored · ${Math.round(item.avg)} avg</span>
        </button>`);
      col.appendChild(row);
    });
    cols.appendChild(col);
  });

  if (!any) {
    card.appendChild(el(`<div class="in-empty" style="font-style:normal">Nothing trending yet. As people score themselves, popular targets show up here.</div>`));
    return card;
  }
  card.appendChild(cols);

  // Clicking a trending target opens the Score dialog pre-filled with that
  // type + value, so you can score yourself against it in one step. Falls
  // back to the profile if the score flow isn't loaded for any reason.
  cols.querySelectorAll(".in-scores-trend-item").forEach(b => {
    b.onclick = () => {
      const target_type = b.dataset.type, target_value = b.dataset.value;
      if (typeof scoreMe === "function") scoreMe({ target_type, target_value });
      else location.hash = "profile";
    };
  });
  return card;
}

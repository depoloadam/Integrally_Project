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

  let res;
  try {
    res = await api("/score/insights.php");
  } catch (e) {
    res = { ok: false, data: null };
  }
  if (!res.ok || !res.data || !res.data.success) {
    wrap.innerHTML = "";
    wrap.appendChild(el(`
      <div class="in-card2">
        <div class="in-empty" style="font-style:normal">Couldn't load your scores just now. Refresh to try again.</div>
      </div>`));
    return;
  }
  // api() returns { ok, status, data:{ success, data, error } } — the
  // actual insights payload is one level in.
  const data = res.data.data || {};
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
      <h2 style="text-transform:none;font-size:16px;letter-spacing:-0.2px">Your scores<button class="add" id="scores-settings-btn" title="Score settings" aria-label="Score settings">⚙</button></h2>
      <div class="in-empty" style="font-style:normal;margin:-8px 0 12px">Each tab is one thing you've scored against. See where you stand and how you compare.</div>
    </div>`);
  // Same gear + destination as the profile Scores card, so the control is
  // consistent wherever scores appear.
  card.querySelector("#scores-settings-btn").onclick = () => { location.hash = "settings/scores"; };

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
  const TYPE_LABEL = { job_title: "Job titles", skill: "Skills", field: "Fields" };

  const card = el(`
    <div class="in-card2">
      <h2 style="text-transform:none;font-size:16px;letter-spacing:-0.2px">Where you stand</h2>
      <div class="in-empty" style="font-style:normal;margin:-8px 0 14px">How each of your scores compares to everyone scored against the same thing — not the platform as a whole.</div>
    </div>`);

  // Only targets with a real comparison pool (more than just you) can show
  // a standing. Separate them from solo ones so we don't imply a ranking
  // that doesn't exist.
  const ranked = personal.filter(p => (p.pool_size || 0) > 1 && p.rank != null);

  if (!ranked.length) {
    card.appendChild(el(`
      <div class="in-empty" style="font-style:normal">
        No one else has scored against your targets yet, so there's nothing to compare against.
        As others score against the same titles and fields, your standing shows up here.
      </div>`));
    appendPlatformFootnote(card, bt, overall, TYPE_LABEL);
    return card;
  }

  // --- "Biggest gap to close": the target where you're furthest BELOW the
  // pool average. Only surfaces if you're actually behind on something. ---
  const behind = ranked.filter(p => p.gap_to_avg != null && p.gap_to_avg < 0);
  if (behind.length) {
    const worst = behind.reduce((w, p) => (p.gap_to_avg < w.gap_to_avg ? p : w), behind[0]);
    const gap = Math.abs(Math.round(worst.gap_to_avg));
    card.appendChild(el(`
      <div class="in-scores-gap">
        <div class="in-scores-gap-tag">Biggest gap to close</div>
        <div class="in-scores-gap-body">
          Your <strong>${esc(worst.target_value)}</strong> score is <strong>${gap}</strong> below the average of the ${worst.pool_size} people scored against it.
          Closing this gap is where you'll move the most.
        </div>
        <button class="in-btn ghost in-scores-gap-btn" style="flex:none;padding:7px 13px">Improve this score →</button>
      </div>`));
    card.querySelector(".in-scores-gap-btn").onclick = () => { location.hash = "profile"; };
  } else {
    // Nothing below average — lead with the strongest standing instead.
    const best = ranked.reduce((b, p) => (p.rank < b.rank ? p : b), ranked[0]);
    card.appendChild(el(`
      <div class="in-scores-gap in-scores-gap-positive">
        <div class="in-scores-gap-tag">Your standing</div>
        <div class="in-scores-gap-body">
          You're at or above average on every target with a pool. Strongest: <strong>${esc(best.target_value)}</strong>, ranked <strong>#${best.rank}</strong> of ${best.pool_size}.
        </div>
      </div>`));
  }

  // --- Per-target standing: one row per pooled target, richest-first by
  // how far above/below average you are (biggest gaps surface). ---
  const rows = el(`<div class="in-scores-stand-rows"></div>`);
  const ordered = ranked.slice().sort((a, b) => (a.gap_to_avg ?? 0) - (b.gap_to_avg ?? 0));
  ordered.forEach(p => rows.appendChild(buildStandingRow(p)));
  card.appendChild(rows);

  appendPlatformFootnote(card, bt, overall, TYPE_LABEL);
  return card;
}

// One target's standing: rank, your score vs average, and a distribution
// histogram with your bucket highlighted.
function buildStandingRow(p) {
  const val = Math.round(p.score_value);
  const avg = p.community_avg != null ? Math.round(p.community_avg) : null;
  const gap = p.gap_to_avg != null ? Math.round(p.gap_to_avg) : null;
  const gapClass = gap == null ? "" : (gap > 0 ? "up" : (gap < 0 ? "down" : "even"));
  const gapText = gap == null ? "" : (gap > 0 ? `+${gap} vs avg` : (gap < 0 ? `${gap} vs avg` : "at average"));
  const typeLabel = esc(p.target_type.replace("_", " "));

  // Distribution histogram. Scale bar heights to the fullest bucket; mark
  // the bucket the viewer's own score falls in.
  const hist = Array.isArray(p.histogram) ? p.histogram : [];
  const maxBucket = hist.length ? Math.max(...hist, 1) : 1;
  const myBucket = Math.min(9, Math.floor(Math.max(0, Math.min(100, val)) / 10));
  const bars = hist.map((count, i) => {
    const h = Math.round((count / maxBucket) * 100);
    const mine = i === myBucket ? " mine" : "";
    return `<span class="in-scores-hbar${mine}" style="height:${Math.max(count > 0 ? 8 : 2, h)}%" title="${count} in ${i * 10}-${i * 10 + 9}"></span>`;
  }).join("");

  const row = el(`
    <div class="in-scores-stand">
      <div class="in-scores-stand-top">
        <div class="in-scores-stand-name">${esc(p.target_value)}<span class="in-scores-stand-type">${typeLabel}</span></div>
        <div class="in-scores-stand-rank">#${p.rank}<span>of ${p.pool_size}</span></div>
      </div>
      <div class="in-scores-stand-nums">
        <span class="in-scores-stand-you">You ${val}</span>
        ${avg != null ? `<span class="in-scores-stand-avg">Avg ${avg}</span>` : ""}
        ${gapText ? `<span class="in-scores-gap-pill ${gapClass}">${gapText}</span>` : ""}
        ${(p.pool_min != null && p.pool_max != null) ? `<span class="in-scores-stand-range">Range ${Math.round(p.pool_min)}–${Math.round(p.pool_max)}</span>` : ""}
      </div>
      <div class="in-scores-hist" aria-hidden="true">${bars}</div>
    </div>`);
  return row;
}

// Platform-wide averages, demoted to a small footnote — broad context,
// not the headline.
function appendPlatformFootnote(card, bt, overall, TYPE_LABEL) {
  const parts = ["job_title", "skill", "field"]
    .filter(t => bt[t] && bt[t].samples)
    .map(t => `${TYPE_LABEL[t].toLowerCase()} ${Math.round(bt[t].avg)}`);
  if (!parts.length && overall.avg == null) return;
  const foot = el(`<div class="in-scores-footnote"></div>`);
  let text = "Platform-wide averages: ";
  text += parts.length ? parts.join(", ") : "—";
  if (overall.avg != null) text += ` · all scores ${Math.round(overall.avg)} (${overall.samples})`;
  text += ". These blend every different target together, so they're broad context only.";
  foot.textContent = text;
  card.appendChild(foot);
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

// =====================================================================
// tools/test_period_control_jsdom.mjs
// Behavioral test for the shared sort/period dropdown control in
// feed.js: the "prefix" option (Sort: vs Time:), the period option set,
// menu rendering, active-state, and onPick firing with label update.
// Extracts the REAL functions from assets/js/feed.js.
// =====================================================================

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/js/feed.js'), 'utf8');

let pass = 0, fail = 0; const fails = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}  ${detail}`); }
}

// Extract a top-level `const NAME = [ ... ];` array literal by name.
function extractConst(name) {
  const re = new RegExp(`const ${name} = \\[`);
  const m = src.match(re);
  if (!m) throw new Error('no const ' + name);
  let i = src.indexOf('[', m.index), depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return src.slice(m.index, end) + ';';
}
// Extract a named function body. Finds the body-opening brace AFTER the
// parameter list's closing paren, so default params like `opts = {}`
// don't fool the brace matcher.
function extractFn(name) {
  const re = new RegExp(`function ${name}\\s*\\(`);
  const m = src.match(re);
  if (!m) throw new Error('no fn ' + name);
  // Walk from the opening paren to its matching close paren.
  let p = src.indexOf('(', m.index), pd = 0, afterParams = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === '(') pd++;
    else if (src[j] === ')') { pd--; if (pd === 0) { afterParams = j + 1; break; } }
  }
  let i = src.indexOf('{', afterParams), depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return src.slice(m.index, end);
}

const bundle = [
  extractConst('SORT_OPTIONS'),
  'const SORT_LABEL = Object.fromEntries(SORT_OPTIONS);',
  extractConst('FEED_SORT_OPTIONS'),
  'const FEED_SORT_LABEL = Object.fromEntries(FEED_SORT_OPTIONS);',
  extractConst('PERIOD_OPTIONS'),
  'const PERIOD_LABEL = Object.fromEntries(PERIOD_OPTIONS);',
  extractFn('buildPeriodControl'),
  extractFn('buildSortControl'),
].join('\n\n');

function makeEnv() {
  const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { url: 'http://localhost/' });
  const { window } = dom;
  const doc = window.document;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (html) => { const t = doc.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstChild; };
  // JSDOM lacks layout; stub getBoundingClientRect + offset sizes used for menu positioning.
  window.Element.prototype.getBoundingClientRect = function () { return { left:0, top:0, right:100, bottom:20, width:100, height:20 }; };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable:true, get(){ return 120; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable:true, get(){ return 160; } });
  const factory = new Function('window','document','esc','el',
    `${bundle}\n; return { buildSortControl, buildPeriodControl, SORT_OPTIONS, PERIOD_OPTIONS, FEED_SORT_OPTIONS };`);
  const fns = factory(window, doc, esc, el);
  return { window, document: doc, el, ...fns };
}

console.log('== period option set ==');
{
  const env = makeEnv();
  const keys = env.PERIOD_OPTIONS.map(o => o[0]);
  check('has all five periods', JSON.stringify(keys) === JSON.stringify(['all','today','week','month','year']), JSON.stringify(keys));
}

console.log('\n== feed sort options exclude newest/oldest ==');
{
  const env = makeEnv();
  const keys = env.FEED_SORT_OPTIONS.map(o => o[0]);
  check('feed sort excludes newest', !keys.includes('newest'), JSON.stringify(keys));
  check('feed sort excludes oldest', !keys.includes('oldest'));
  check('feed sort is [relevance, engagement]', JSON.stringify(keys) === JSON.stringify(['relevance','engagement']), JSON.stringify(keys));
  // The generic SORT_OPTIONS (profile/saved) still has them.
  const gen = env.SORT_OPTIONS.map(o => o[0]);
  check('generic sort still has newest/oldest', gen.includes('newest') && gen.includes('oldest'));
  // A control built with the feed set renders exactly two items.
  const ctrl = env.buildSortControl('relevance', () => {}, { options: env.FEED_SORT_OPTIONS, labels: Object.fromEntries(env.FEED_SORT_OPTIONS) });
  env.document.body.appendChild(ctrl);
  ctrl.querySelector('.sort-btn').click();
  check('feed sort menu shows 2 items', env.document.querySelectorAll('.sort-menu-item').length === 2);
}

console.log('\n== sort control default prefix is "Sort:" ==');
{
  const env = makeEnv();
  const ctrl = env.buildSortControl('newest', () => {});
  env.document.body.appendChild(ctrl);
  check('button shows Sort: Newest', /Sort:\s*<strong>Newest<\/strong>/.test(ctrl.querySelector('.sort-btn-label').innerHTML), ctrl.querySelector('.sort-btn-label').innerHTML);
}

console.log('\n== period control uses "Time:" prefix + period labels ==');
{
  const env = makeEnv();
  const ctrl = env.buildPeriodControl('all', () => {});
  env.document.body.appendChild(ctrl);
  check('button shows Time: All time', /Time:\s*<strong>All time<\/strong>/.test(ctrl.querySelector('.sort-btn-label').innerHTML), ctrl.querySelector('.sort-btn-label').innerHTML);
}

console.log('\n== period menu renders options + active state ==');
{
  const env = makeEnv();
  const ctrl = env.buildPeriodControl('month', () => {});
  env.document.body.appendChild(ctrl);
  ctrl.querySelector('.sort-btn').click();
  const items = [...env.document.querySelectorAll('.sort-menu-item')];
  check('five menu items', items.length === 5, `got ${items.length}`);
  const active = items.find(i => i.classList.contains('active'));
  check('active item is Last 30 days', active && /Last 30 days/.test(active.textContent), active && active.textContent);
}

console.log('\n== picking a period fires onPick + updates label ==');
{
  const env = makeEnv();
  let picked = null;
  const ctrl = env.buildPeriodControl('all', (key) => { picked = key; });
  env.document.body.appendChild(ctrl);
  ctrl.querySelector('.sort-btn').click();
  const today = [...env.document.querySelectorAll('.sort-menu-item')].find(i => /Today/.test(i.textContent));
  today.click();
  check('onPick fired with "today"', picked === 'today', String(picked));
  check('label updated to Today', /<strong>Today<\/strong>/.test(ctrl.querySelector('.sort-btn-label').innerHTML), ctrl.querySelector('.sort-btn-label').innerHTML);
}

console.log('\n== picking same value is a no-op (no onPick) ==');
{
  const env = makeEnv();
  let calls = 0;
  const ctrl = env.buildPeriodControl('all', () => { calls++; });
  env.document.body.appendChild(ctrl);
  ctrl.querySelector('.sort-btn').click();
  const same = [...env.document.querySelectorAll('.sort-menu-item')].find(i => /All time/.test(i.textContent));
  same.click();
  check('re-picking active does not fire onPick', calls === 0, `calls=${calls}`);
}

console.log(`\n=================  ${pass} passed, ${fail} failed  =================`);
if (fail) { console.log('FAILURES: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

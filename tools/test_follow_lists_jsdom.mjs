// =====================================================================
// tools/test_follow_lists_jsdom.mjs
// Behavioral test for the client-side follower/following UI:
//   - followCountsHtml: tappable vs plain rendering + pluralization
//   - wireFollowCounts: only tappable stats get click handlers
//   - openFollowList: renders rows, navigates on row tap, handles the
//     hidden/empty/error states, and works for company followers
//   - live follower-count update math on follow/unfollow
//
// The three functions are extracted from the REAL assets/js/profile.js
// (not copied) so this exercises shipped code. Shell globals are stubbed.
// =====================================================================

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../assets/js/profile.js'), 'utf8');

let pass = 0, fail = 0; const fails = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}  ${detail}`); }
}

// --- Extract the three functions by name from the source ----------------
function extract(name, kind = 'function') {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${name}`);
  let i = src.indexOf('{', m.index);
  let depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  return src.slice(m.index, end);
}
const fnSource = [
  extract('followCountsHtml'),
  extract('wireFollowCounts'),
  extract('openFollowList'),
].join('\n\n');

// --- Fresh jsdom + stubbed globals per scenario -------------------------
function makeEnv(apiHandler) {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="modal"></div></body>`, { url: 'http://localhost/' });
  const { window } = dom;
  const doc = window.document;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (html) => { const t = doc.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstChild; };
  const $ = (id) => doc.getElementById(id);
  let modalOpen = false;
  const openModal = (html) => { modalOpen = true; $('modal').innerHTML = html; };
  const closeModal = () => { modalOpen = false; $('modal').innerHTML = ''; };
  const api = apiHandler || (async () => ({ ok: true, data: { success: true, data: [] } }));

  const ctx = { window, document: doc, esc, el, $, openModal, closeModal, api,
                get modalOpen() { return modalOpen; } };
  // A mutable holder so wireFollowCounts closes over a spy-able reference.
  const holder = {};
  // Rename the extracted openFollowList to _realOpenFollowList so the
  // spy-able wrapper below can delegate to it without name collision
  // (function-declaration hoisting would otherwise make them the same).
  const patchedSrc = fnSource.replace(/(?:async\s+)?function\s+openFollowList\s*\(/, 'async function _realOpenFollowList(');
  const factory = new Function(
    'window', 'document', 'location', 'esc', 'el', '$', 'openModal', 'closeModal', 'api', 'holder',
    `${patchedSrc}\n` +
    `; function openFollowList(u, m) { return (holder.openFollowList || _realOpenFollowList)(u, m); }` +
    `; return { followCountsHtml, wireFollowCounts, openFollowList };`
  );
  const fns = factory(window, doc, window.location, esc, el, $, openModal, closeModal, api, holder);
  return { ...ctx, ...fns, holder, dom };
}

const tick = () => new Promise(r => setTimeout(r, 0));

// ========================= Tests =========================

console.log('== followCountsHtml rendering ==');
{
  const env = makeEnv();
  // Public viewer, not hidden -> both tappable
  let html = env.followCountsHtml(2, 5, false, false);
  let wrap = env.el(html);
  const stats = wrap.querySelectorAll('[data-follow-list]');
  check('renders two stat buttons', stats.length === 2);
  check('both tappable when visible', [...stats].every(s => s.classList.contains('tappable')));
  check('follower count value', wrap.querySelector('[data-follow-list="followers"] .n').textContent === '2');
  check('following count value', wrap.querySelector('[data-follow-list="following"] .n').textContent === '5');

  // Singular pluralization
  const one = env.el(env.followCountsHtml(1, 0, false, false));
  check('singular "follower"', /1<\/span>\s*follower(?!s)/.test(one.querySelector('[data-follow-list="followers"]').innerHTML));

  // Hidden + non-owner -> NOT tappable
  const hidden = env.el(env.followCountsHtml(2, 5, true, false));
  check('not tappable when hidden for non-owner',
    [...hidden.querySelectorAll('[data-follow-list]')].every(s => !s.classList.contains('tappable')));
  check('aria-disabled set when hidden', hidden.querySelector('[data-follow-list="followers"]').getAttribute('aria-disabled') === 'true');

  // Hidden BUT owner -> still tappable
  const ownerHidden = env.el(env.followCountsHtml(2, 5, true, true));
  check('owner tappable even when hidden',
    [...ownerHidden.querySelectorAll('[data-follow-list]')].every(s => s.classList.contains('tappable')));
}

console.log('\n== wireFollowCounts click wiring ==');
{
  const env = makeEnv();
  const head = env.el(`<div>${env.followCountsHtml(3, 1, false, false)}</div>`);
  env.document.body.appendChild(head);
  let opened = null;
  env.holder.openFollowList = (uuid, mode) => { opened = { uuid, mode }; }; // spy
  env.wireFollowCounts(head, 'uuid-123', false, false);
  head.querySelector('[data-follow-list="followers"]').click();
  check('clicking followers opens followers list', opened && opened.mode === 'followers' && opened.uuid === 'uuid-123', JSON.stringify(opened));
  head.querySelector('[data-follow-list="following"]').click();
  check('clicking following opens following list', opened && opened.mode === 'following');

  // hidden non-owner: no handler
  const env2 = makeEnv();
  const head2 = env2.el(`<div>${env2.followCountsHtml(3, 1, true, false)}</div>`);
  let opened2 = false;
  env2.holder.openFollowList = () => { opened2 = true; };
  env2.wireFollowCounts(head2, 'x', true, false);
  head2.querySelector('[data-follow-list="followers"]').click();
  check('no handler on hidden non-owner stats', opened2 === false);
}

console.log('\n== openFollowList: populated list + row navigation ==');
{
  const rows = [
    { follower_type: 'user', uuid: 'u-bob', name: 'bob', avatar: null },
    { follower_type: 'company', uuid: 'c-acme', name: 'Acme Inc', avatar: 'http://x/logo.png' },
  ];
  const env = makeEnv(async (url) => {
    check('followers endpoint hit', url.includes('/follow/followers.php') && url.includes('type=user'));
    return { ok: true, data: { success: true, data: rows } };
  });
  await env.openFollowList('target-uuid', 'followers');
  await tick();
  const body = env.$('follow-list-body');
  const items = body.querySelectorAll('.in-followrow');
  check('two rows rendered', items.length === 2, `got ${items.length}`);
  check('user row shows @name', items[0].querySelector('.in-followrow-name').textContent.includes('@bob'));
  check('company row shows plain name', items[1].querySelector('.in-followrow-name').textContent.includes('Acme Inc'));
  check('company row tagged', !!items[1].querySelector('.in-followrow-tag'));
  check('user avatar falls back to initial', items[0].querySelector('.in-followrow-av').textContent.trim() === 'B');
  check('company avatar uses img', !!items[1].querySelector('.in-followrow-av img'));

  // Row click -> navigate + close modal
  items[0].click();
  check('user row navigates to #user/', env.window.location.hash === '#user/u-bob', env.window.location.hash);
  check('modal closed on navigate', env.modalOpen === false);

  // Company row navigation
  const env2 = makeEnv(async () => ({ ok: true, data: { success: true, data: rows } }));
  await env2.openFollowList('t', 'followers');
  await tick();
  env2.$('follow-list-body').querySelectorAll('.in-followrow')[1].click();
  check('company row navigates to #company/', env2.window.location.hash === '#company/c-acme', env2.window.location.hash);
}

console.log('\n== openFollowList: following mode uses following endpoint ==');
{
  const env = makeEnv(async (url) => {
    check('following endpoint hit', url.includes('/follow/following.php'));
    return { ok: true, data: { success: true, data: [{ target_type: 'user', uuid: 'u-x', name: 'xavier' }] } };
  });
  await env.openFollowList('me', 'following');
  await tick();
  check('following row rendered', env.$('follow-list-body').querySelectorAll('.in-followrow').length === 1);
}

console.log('\n== openFollowList: hidden / empty / error states ==');
{
  const hiddenEnv = makeEnv(async () => ({ ok: false, data: { success: false, code: 'follow_lists_hidden', error: 'hidden' } }));
  await hiddenEnv.openFollowList('t', 'followers');
  await tick();
  check('hidden -> private message', /private/i.test(hiddenEnv.$('follow-list-body').textContent));

  const emptyEnv = makeEnv(async () => ({ ok: true, data: { success: true, data: [] } }));
  await emptyEnv.openFollowList('t', 'followers');
  await tick();
  check('empty followers -> "No followers yet"', /no followers yet/i.test(emptyEnv.$('follow-list-body').textContent));
  await emptyEnv.openFollowList('t', 'following');
  await tick();
  check('empty following -> "Not following anyone"', /not following anyone/i.test(emptyEnv.$('follow-list-body').textContent));

  const errEnv = makeEnv(async () => ({ ok: false, data: { success: false, error: 'boom' } }));
  await errEnv.openFollowList('t', 'followers');
  await tick();
  check('error -> could not load', /couldn.t load/i.test(errEnv.$('follow-list-body').textContent));
}

console.log('\n== live follower-count update math ==');
{
  // Mirrors the handler logic in renderPublicProfile.
  const env = makeEnv();
  const head = env.el(`<div>${env.followCountsHtml(5, 0, false, false)}</div>`);
  const applyDelta = (nowFollowing) => {
    let liveFollowers = parseInt(head.querySelector('[data-follow-list="followers"] .n').textContent, 10);
    liveFollowers = Math.max(0, liveFollowers + (nowFollowing ? 1 : -1));
    const stat = head.querySelector('[data-follow-list="followers"] .n');
    const label = head.querySelector('[data-follow-list="followers"]');
    stat.textContent = liveFollowers;
    label.lastChild.textContent = ` follower${liveFollowers === 1 ? '' : 's'}`;
    return liveFollowers;
  };
  check('follow increments 5 -> 6', applyDelta(true) === 6);
  check('unfollow decrements 6 -> 5', applyDelta(false) === 5);
  // drive down to 1 to check pluralization flip
  applyDelta(false); applyDelta(false); applyDelta(false); // 5->2
  const atOne = applyDelta(false); // 2 -> 1
  check('reaches 1', atOne === 1);
  check('label singular at 1', head.querySelector('[data-follow-list="followers"]').lastChild.textContent === ' follower');
  const atZero = applyDelta(false); // 1 -> 0
  check('never goes below 0', atZero === 0);
  check('label plural at 0', head.querySelector('[data-follow-list="followers"]').lastChild.textContent === ' followers');
}

console.log(`\n=================  ${pass} passed, ${fail} failed  =================`);
if (fail) { console.log('FAILURES: ' + fails.join(', ')); process.exit(1); }
process.exit(0);

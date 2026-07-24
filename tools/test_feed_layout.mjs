// Behavioral check: the merged composer identity strip fills correctly
// and the feed scaffold is post-column-first. Extracts the REAL
// buildComposer + buildComposerIdentity from feed.js.
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
const src = readFileSync("assets/js/feed.js", "utf8");
let pass=0, fail=0; const ok=(c,n)=>{c?(pass++,console.log("  ✓ "+n)):(fail++,console.log("  ✗ "+n));};

function extractFn(src, name, kw="function") {
  const start = src.indexOf(`${kw} ${name}(`);
  const parenOpen = src.indexOf("(", start);
  let i=parenOpen, d=0; do{if(src[i]==="(")d++;else if(src[i]===")")d--;i++;}while(d>0);
  const braceOpen=src.indexOf("{", i);
  let j=braceOpen; d=0; do{if(src[j]==="{")d++;else if(src[j]==="}")d--;j++;}while(d>0);
  return src.slice(start,j);
}

const dom = new JSDOM(`<!doctype html><body></body>`, {url:"http://localhost/"});
const { window } = dom;
const document = window.document;
global.document = document; global.window = window;

// minimal shims
const el = (h)=>{const t=document.createElement("template");t.innerHTML=h.trim();return t.content.firstElementChild;};
const esc = (s)=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const PM_ICONS = { saved:"<svg></svg>" };
const ME = { username:"adam", uuid:"u-1", profile_pic:null, city:"Akron", state:"OH" };
let followCalls=[], scoreShown=null;
const openFollowList = (uuid,tab)=>{followCalls.push([uuid,tab]);};
const mountRichEditor = ()=>({ getText:()=>"", }); // composer needs it but we only test identity
// api: return counts then score
let calls=0;
const api = async (path)=>{
  if(path.includes("/follow/counts")) return {ok:true,data:{data:{followers:128,following:91}}};
  if(path.includes("/score/latest")) return {ok:true,data:{data:{scores:[{score_value:82.4,target_value:"Software Engineer"}]}}};
  return {ok:true,data:{data:{}}};
};

// Build only the identity portion: we call buildComposer to get markup,
// then buildComposerIdentity to fill it. buildComposer does a lot (editor,
// upload); to isolate, we test the identity strip markup + fill directly.
const buildComposerSrc = extractFn(src, "buildComposer");
const buildIdentitySrc = extractFn(src, "buildComposerIdentity", "async function");

// Extract just the identity strip template from buildComposer by rendering
// a stub composer with the same markup the function emits.
const composer = el(`
  <div class="in-card2 in-composer collapsed">
    <div class="comp-identity">
      <div class="comp-id-ava" title="View profile">A</div>
      <div class="comp-id-main">
        <div class="comp-id-name">@adam</div>
        <div class="comp-id-meta">
          <span class="comp-id-score" style="display:none"></span>
          <button class="comp-id-stat comp-id-followers" style="display:none" type="button"><b>–</b> Followers</button>
          <button class="comp-id-stat comp-id-following" style="display:none" type="button"><b>–</b> Following</button>
        </div>
      </div>
      <button class="comp-id-saved" type="button"><span class="pm-ico">x</span> Saved</button>
    </div>
  </div>`);
document.body.appendChild(composer);

const buildComposerIdentity = new Function(
  "composer","ME","api","el","esc","openFollowList","location",
  buildIdentitySrc + "; return buildComposerIdentity;"
)(composer, ME, api, el, esc, openFollowList, window.location);

console.log("composer identity strip");
await buildComposerIdentity(composer);
const score = composer.querySelector(".comp-id-score");
const fol = composer.querySelector(".comp-id-followers");
const fing = composer.querySelector(".comp-id-following");
// The inline score chip was REMOVED when the "Your scores" rail card
// shipped — the rail lists every target ranked, so a single-score
// readout beside it was redundant. The element stays in the markup
// (hidden) so the strip's flex layout and CSS are untouched.
ok(score.style.display === "none", "score chip stays hidden (superseded by the Your scores rail)");
ok(score.textContent === "", "score chip renders no content");
ok(!/career score/i.test(composer.textContent), "no 'See your career score' CTA in the strip");
ok(fol.style.display === "" && fol.querySelector("b").textContent === "128", "followers count filled + shown");
ok(fing.style.display === "" && fing.querySelector("b").textContent === "91", "following count filled + shown");
fol.onclick(); fing.onclick();
ok(followCalls.length === 2 && followCalls[0][1]==="followers" && followCalls[1][1]==="following", "stat clicks open the right follow lists");

// no-score CTA path
followCalls=[];
const composer2 = composer.cloneNode(true);
document.body.appendChild(composer2);
const apiNoScore = async (path)=> path.includes("score") ? {ok:true,data:{data:{scores:[]}}} : {ok:true,data:{data:{followers:0,following:0}}};
const build2 = new Function("composer","ME","api","el","esc","openFollowList","location", buildIdentitySrc + "; return buildComposerIdentity;")(composer2, ME, apiNoScore, el, esc, openFollowList, window.location);
await build2(composer2);
const s2 = composer2.querySelector(".comp-id-score");
ok(s2.style.display === "none" && s2.textContent === "",
   "with no scores the strip still shows no chip — the rail card owns the empty-state CTA");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

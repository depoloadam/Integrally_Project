// =====================================================================
// feed.js — feed view: composer (with image upload), main/explore
//   tabs, and post rendering (incl. cert cards, delete, clickable
//   authors).
//   Depends on shell.js globals: api, $, el, esc, ME, uploadImage.
// =====================================================================

let FEED_TAB = "main";   // 'main' | 'explore'

async function renderFeed() {
  const view = $("view");
  view.innerHTML = "";

  // ---- composer ----
  const composer = el(`
    <div class="in-card2 in-composer">
      <div class="comp-top">
        <div class="comp-avatar">${esc((ME.username||"?").charAt(0).toUpperCase())}</div>
        <textarea id="comp-body" placeholder="Share an update, @${esc(ME.username)}…" rows="2"></textarea>
      </div>
      <div id="comp-preview" class="comp-preview" style="display:none">
        <img id="comp-preview-img" src="" alt="">
        <button id="comp-preview-x" title="Remove image">✕</button>
      </div>
      <div class="comp-actions">
        <input type="file" id="comp-file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none">
        <button class="comp-imgbtn" id="comp-img" title="Add image">🖼️ Image</button>
        <select id="comp-vis" title="Who can see this">
          <option value="public">🌐 Public</option>
          <option value="followers">👥 Followers</option>
        </select>
        <button class="in-btn primary" id="comp-post" style="flex:none;padding:9px 18px">Post</button>
      </div>
    </div>`);
  view.appendChild(composer);
  const ta = composer.querySelector("#comp-body");
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; });

  let attachedUrl = null;
  const fileInput = composer.querySelector("#comp-file");
  const preview = composer.querySelector("#comp-preview");
  const previewImg = composer.querySelector("#comp-preview-img");
  composer.querySelector("#comp-img").onclick = () => fileInput.click();
  composer.querySelector("#comp-preview-x").onclick = () => { attachedUrl = null; fileInput.value = ""; preview.style.display = "none"; previewImg.src = ""; };
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { alert("Image must be 5 MB or smaller."); fileInput.value = ""; return; }
    previewImg.src = URL.createObjectURL(f);
    preview.style.display = "block";
    const imgBtn = composer.querySelector("#comp-img"); imgBtn.disabled = true; imgBtn.textContent = "Uploading…";
    const up = await uploadImage(f);
    imgBtn.disabled = false; imgBtn.textContent = "🖼️ Image";
    if (up?.url) { attachedUrl = up.url; }
    else { alert("Image upload failed. Please try another file."); attachedUrl = null; fileInput.value = ""; preview.style.display = "none"; previewImg.src = ""; }
  };
  composer.querySelector("#comp-post").onclick = async () => {
    const body = ta.value.trim();
    if (!body && !attachedUrl) return;
    if (!body && attachedUrl) { if (!confirm("Post this image without any text?")) return; }
    const btn = composer.querySelector("#comp-post"); btn.disabled = true; btn.textContent = "Posting…";
    await api("/posts/create.php", "POST", { body, visibility: composer.querySelector("#comp-vis").value, media_url: attachedUrl });
    renderFeed();
  };

  // ---- sub-tabs ----
  const tabs = el(`
    <div class="in-feedtabs">
      <button data-ftab="main" class="${FEED_TAB==="main"?"active":""}">Following</button>
      <button data-ftab="explore" class="${FEED_TAB==="explore"?"active":""}">Explore</button>
    </div>`);
  view.appendChild(tabs);
  tabs.querySelectorAll("[data-ftab]").forEach(b => b.onclick = () => { FEED_TAB = b.dataset.ftab; renderFeed(); });

  // ---- posts ----
  const list = el(`<div id="feed-list"></div>`);
  view.appendChild(list);
  const endpoint = FEED_TAB === "main" ? "/feed/main.php" : "/feed/explore.php";
  const res = await api(endpoint);
  const items = res.data?.data?.items || [];
  if (!items.length) {
    list.appendChild(el(`<div class="in-card2"><div class="in-empty" style="text-align:center">${
      FEED_TAB === "main"
        ? "Your feed is quiet. Follow people and companies, or share your first post above."
        : "Nothing to explore yet. Public posts from across Integrally will show here."
    }</div></div>`));
    return;
  }
  const container = el(`<div class="in-card2 in-post-list"></div>`);
  items.forEach(it => container.appendChild(renderPost(it)));
  list.appendChild(container);
}

// ---- single post card ------------------------------------------------
function renderPost(it) {
  const a = it.author || {};
  const initial = (a.name || "?").charAt(0).toUpperCase();
  const when = new Date(it.created_at).toLocaleString();
  const isCompany = a.type === "company";
  const isMine = (a.type === "user" && a.uuid && a.uuid === ME.uuid);
  const isAdmin = (ME.role === "admin");
  // Admins can delete ANY post; everyone else only their own.
  const canDelete = isMine || isAdmin;

  let contentHtml;
  if (it.post_type === "cert" && it.meta) {
    const m = it.meta;
    contentHtml = `
      <div class="post-cert">
        <div class="cert-icon">🎓</div>
        <div>
          <div class="cert-label">Earned a certification</div>
          <div class="cert-name">${esc(m.name || "")}</div>
          ${m.issuer ? `<div class="cert-issuer">${esc(m.issuer)}</div>` : ""}
        </div>
      </div>
      ${it.body ? `<div class="post-body" style="margin-top:12px">${esc(it.body).replace(/\n/g,"<br>")}</div>` : ""}`;
  } else {
    contentHtml = `<div class="post-body">${esc(it.body || "").replace(/\n/g, "<br>")}</div>`;
  }

  const clickable = (a.type === "user" && a.uuid && !isMine);
  const nameClass = clickable ? "post-name linkable" : "post-name";
  const avaClass  = "post-avatar" + (isCompany ? " company" : "") + (clickable ? " linkable" : "");
  const goProfile = clickable ? `onclick="location.hash='user/${esc(a.uuid)}'"` : "";

  const card = el(`
    <div class="in-post-item">
      <div class="post-head">
        <div class="${avaClass}" ${goProfile}>${esc(initial)}</div>
        <div>
          <div class="${nameClass}" ${goProfile}>${esc(a.name || "Unknown")}${isCompany ? ' <span class="post-tag">Company</span>' : ""}</div>
          <div class="post-when">${esc(when)}${it.reason === "self" ? " · You" : ""}</div>
        </div>
        ${canDelete ? `<button class="post-del" title="${isMine ? "Delete post" : "Delete (admin)"}">🗑</button>` : ""}
      </div>
      ${contentHtml}
      ${it.media_url ? `<img class="post-media" src="${esc(it.media_url)}" alt="">` : ""}
    </div>`);

  if (canDelete) {
    card.querySelector(".post-del").onclick = async () => {
      const msg = isMine ? "Delete this post? This cannot be undone."
                         : "Delete this post as admin? This cannot be undone.";
      if (!confirm(msg)) return;
      const r = await api("/posts/delete.php", "POST", { id: it.post_id });
      if (r.ok && r.data?.success) card.remove();
      else alert(r.data?.error || "Could not delete the post.");
    };
  }
  return card;
}
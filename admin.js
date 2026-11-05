// 编目协作审核页 / admin review page
// 中文：用管理口令读取待审条目，逐条采纳或不采纳并附说明，可导出全部记录。
// English: read the queue with the admin token, accept/reject with a note, export CSV.
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KIND_CN = { comment: "评论", edit: "修改建议", add_record: "补充记录", add_species: "新增物种" };
const ST_CN = { pending: "待审", accepted: "已采纳", rejected: "未采纳" };
let token = "", status = "pending";
try { token = sessionStorage.getItem("hn-admin") || ""; } catch (e) { /* storage unavailable */ }

async function call(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 401) throw new Error("口令错误");
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "请求失败（" + r.status + "）");
  return r;
}
function card(x) {
  const rows = [["物种", `${x.taxon_id ? x.taxon_id + " " : ""}${x.taxon_name}`], ["修改", x.field ? `${x.field} → ${x.proposed}` : ""],
    ["县级代码", x.county_code], ["地点", x.place_note], ["意见", x.body], ["凭证", [x.evidence_type, x.voucher].filter(Boolean).join("：")],
    ["提交人", `${x.author_name}（${x.author_unit}）${x.credit_ok ? "" : " · 公开时匿名"}`], ["联系方式", x.contact], ["审核说明", x.review_note]].filter(([, v]) => v);
  return `<article class="item ${x.status}" data-id="${x.id}"><div class="hd"><span>#${x.id}</span><span>${KIND_CN[x.kind]}</span><span>${esc(ST_CN[x.status])}</span>
    <span>${esc((x.created_at || "").replace("T", " ").slice(0, 16))}</span>${x.taxon_id ? `<a href="atlas.html#${esc(x.taxon_id)}" target="_blank" rel="noopener">在地图中查看</a>` : ""}</div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <div class="row"><input placeholder="审核说明（会随采纳内容公开）" value="${esc(x.review_note || "")}" maxlength="500">
    <button class="btn" type="button" data-act="accepted">采纳</button><button class="btn ghost" type="button" data-act="rejected">不采纳</button>
    ${x.status !== "pending" ? '<button class="btn ghost" type="button" data-act="pending">退回待审</button>' : ""}</div></article>`;
}
async function load() {
  $("msg").textContent = "加载中…";
  try {
    const r = await call(`/api/admin/items?status=${status}`);
    const { items } = await r.json();
    $("list").innerHTML = items.length ? items.map(card).join("") : '<p class="empty">没有条目。</p>';
    $("msg").textContent = `${items.length} 条`;
    $("login").hidden = true; $("app").hidden = false; $("lmsg").textContent = "";
  } catch (e) {
    $("msg").textContent = e.message;
    // 中文：未登录时错误显示在口令框下；English: show errors under the login box when logged out.
    if (e.message === "口令错误" || $("app").hidden) { $("app").hidden = true; $("login").hidden = false; $("lmsg").textContent = e.message; }
  }
}
$("login").addEventListener("submit", (e) => {
  e.preventDefault(); token = $("tok").value.trim();
  try { sessionStorage.setItem("hn-admin", token); } catch (err) { /* ignore */ }
  load();
});
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-s]"); if (!b) return;
  status = b.dataset.s; document.querySelectorAll("#tabs [data-s]").forEach((x) => x.setAttribute("aria-selected", String(x === b))); load();
});
$("list").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const art = b.closest("article"), note = art.querySelector("input").value;
  b.disabled = true;
  try { await call(`/api/admin/items/${art.dataset.id}`, { method: "POST", body: JSON.stringify({ status: b.dataset.act, review_note: note }) }); load(); }
  catch (err) { $("msg").textContent = err.message; b.disabled = false; }
});
$("export").addEventListener("click", async () => {
  try {
    const r = await call("/api/admin/export");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await r.blob()), download: "河南编目协作_全部提交.csv" });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) { $("msg").textContent = err.message; }
});
if (!API) { $("login").hidden = true; $("lmsg").textContent = "协作后台尚未部署。"; }
else if (token) load();

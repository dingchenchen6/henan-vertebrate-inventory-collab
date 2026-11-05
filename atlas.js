// 河南编目协作地图 / Henan inventory interactive atlas
// 中文：按县浏览物种、按物种查看分布与讨论，并向后台提交待审建议。
// English: browse species by county, view a species' distribution and thread,
//          and send pending suggestions to the collaboration API.
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SVGNS = "http://www.w3.org/2000/svg";
const CLASSES = [["", "全部"], ["两栖纲", "两栖"], ["爬行纲", "爬行"], ["鸟纲", "鸟类"], ["哺乳纲", "兽类"]];
const KIND_CN = { comment: "评论", edit: "修改建议", add_record: "补充记录", add_species: "新增物种" };
const S = { rows: [], geo: null, places: null, byId: {}, cty: {}, cls: "", county: null, taxon: null, summary: {}, online: false };

// ---------- data / 数据 ----------
async function loadJSON(path) { const r = await fetch(path); if (!r.ok) throw new Error(path + " " + r.status); return r.json(); }
async function api(path, opts = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(API + path, { ...opts, signal: ctl.signal, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || "请求失败（" + r.status + "）");
    return body;
  } finally { clearTimeout(t); }
}
function countsFor(cls) {
  const n = {};
  for (const r of S.rows) if (r.status.startsWith("名录") && (!cls || r.cls === cls)) for (const c of r.cty) n[c] = (n[c] || 0) + 1;
  return n;
}

// ---------- map / 地图 ----------
function drawMap() {
  const g = S.geo, svg = $("map");
  svg.setAttribute("viewBox", `0 0 ${g.width} ${g.height}`);
  const frag = document.createDocumentFragment();
  for (const c of g.counties) {
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", c.d); p.setAttribute("class", "cty"); p.dataset.code = c.code;
    p.setAttribute("tabindex", "0"); p.setAttribute("role", "button"); p.setAttribute("aria-label", c.name);
    frag.appendChild(p); S.cty[c.code] = { ...c, el: p };
  }
  for (const c of g.cities) {
    const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", c.d); p.setAttribute("class", "city"); p.dataset.city = c.name; frag.appendChild(p);
    const t = document.createElementNS(SVGNS, "text"); t.setAttribute("x", c.c[0]); t.setAttribute("y", c.c[1]); t.setAttribute("text-anchor", "middle"); t.textContent = c.name.replace(/市$/, ""); frag.appendChild(t);
  }
  svg.appendChild(frag);
  svg.addEventListener("click", (e) => { const p = e.target.closest("path.cty"); if (p) selectCounty(p.dataset.code); });
  svg.addEventListener("keydown", (e) => { const p = e.target.closest("path.cty"); if (p && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectCounty(p.dataset.code); } });
  svg.addEventListener("mousemove", (e) => {
    const p = e.target.closest("path.cty"), tip = $("tip");
    if (!p) { tip.hidden = true; return; }
    const c = S.cty[p.dataset.code], n = S.taxon ? null : (countsFor(S.cls)[c.code] || 0);
    tip.textContent = `${c.city} ${c.name}` + (n === null ? "" : `：${n} 种`);
    tip.hidden = false; tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + "px"; tip.style.top = (e.clientY + 14) + "px";
  });
  svg.addEventListener("mouseleave", () => { $("tip").hidden = true; });
}
const BINS = [0, 1, 20, 50, 100, 160];
function binOf(n) { let k = 0; for (let i = 0; i < BINS.length; i++) if (n >= BINS[i]) k = i; return k; }
function paint() {
  const cityHl = new Set();
  if (S.taxon) {
    const r = S.byId[S.taxon], has = new Set(r.cty);
    for (const c of Object.values(S.cty)) c.el.style.fill = has.has(c.code) ? "var(--hl)" : "var(--r0)";
    if (r.cityonly) r.cities.forEach((x) => cityHl.add(x));
    $("legend").innerHTML = `<span><i style="background:var(--hl)"></i>有县级记录</span>` +
      (r.cityonly && r.cities.length ? `<span><i style="border:2px dashed var(--hl);height:6px"></i>仅公开到市级</span>` : "") + `<span><i style="background:var(--r0);border:1px solid var(--rule)"></i>无记录</span>`;
  } else {
    const n = countsFor(S.cls);
    for (const c of Object.values(S.cty)) c.el.style.fill = `var(--r${binOf(n[c.code] || 0)})`;
    const lab = ["0", "1–19", "20–49", "50–99", "100–159", "≥160"];
    $("legend").innerHTML = "<span>县级有记录物种数：</span>" + lab.map((l, i) => `<span><i style="background:var(--r${i})"></i>${l}</span>`).join("");
  }
  document.querySelectorAll("path.city").forEach((p) => p.classList.toggle("hl", cityHl.has(p.dataset.city)));
  document.querySelectorAll("path.cty").forEach((p) => p.classList.toggle("sel", p.dataset.code === S.county));
}

// ---------- views / 视图 ----------
function badge(id) {
  const s = S.summary[id];
  if (!s) return "";
  return `<span class="badge">${s.accepted ? `讨论 ${s.accepted}` : ""}${s.accepted && s.pending ? " · " : ""}${s.pending ? `<b>待审 ${s.pending}</b>` : ""}</span>`;
}
function flagPills(r) { return r.flags.map((f) => `<span class="pill ${f === "存疑" || f === "官方提及未收录" ? "p1" : f === "无县级记录" ? "p3" : "p2"}">${f}</span>`).join(" "); }
function speciesButton(r, note) {
  return `<button class="sp" type="button" data-id="${r.id}"><span><b>${esc(r.cn || r.sci)}</b><i>${esc(r.sci)}</i>${note ? `<i>${note}</i>` : ""} ${flagPills(r)}</span>${badge(r.id)}</button>`;
}
function viewProvince() {
  const listed = S.rows.filter((r) => r.status.startsWith("名录")).length, hi = S.rows.filter((r) => r.prio === "高").length;
  $("view").innerHTML = `<div class="card2"><h3>河南省 <i>点击地图上的县开始</i></h3>
    <dl class="kv"><dt>名录收录</dt><dd>${listed} 种</dd><dt>待审单元</dt><dd>${S.rows.length - listed} 个（存疑、移除、官方提及未收录）</dd><dt>高优先级</dt><dd>${hi} 个</dd></dl>
    <p style="font-size:.86rem">也可以在上方搜索任一物种，查看它的县级分布和讨论。</p></div>`;
}
function selectCounty(code) {
  S.county = code; S.taxon = null;
  const c = S.cty[code], cls = S.cls;
  const here = S.rows.filter((r) => r.cty.includes(code) && (!cls || r.cls === cls));
  const cityOnly = S.rows.filter((r) => r.cityonly && r.cities.includes(c.city) && (!cls || r.cls === cls));
  const res = S.places.reserves.filter((x) => x.cty.includes(code));
  const groups = CLASSES.slice(1).filter(([k]) => !cls || k === cls).map(([k, lab]) => {
    const xs = here.filter((r) => r.cls === k);
    return xs.length ? `<details class="grp" ${cls || xs.length < 40 ? "open" : ""}><summary>${lab} ${xs.length} 种</summary>${xs.map((r) => speciesButton(r)).join("")}</details>` : "";
  }).join("");
  $("view").innerHTML = `<div class="card2"><p class="crumbs"><button type="button" data-go="prov">河南省</button> › ${esc(c.city)}</p>
    <h3>${esc(c.name)} <i>${here.length} 种县级记录${cls ? "（" + CLASSES.find((x) => x[0] === cls)[1] + "）" : ""}</i></h3>
    ${res.length ? `<p style="font-size:.86rem"><b>位于本县的保护地：</b>${res.map((x) => `${esc(x.name)}${x.hab.length ? `（重要栖息地名录主要保护物种：${esc(x.hab.join("、"))}等）` : ""}`).join("；")}</p>` : ""}
    <div class="acts"><button class="btn ghost" type="button" data-form="add_record_county">为本县补充记录</button></div>
    ${groups || '<p class="count">本县暂无该类群的县级记录，欢迎补充。</p>'}
    ${cityOnly.length ? `<details class="grp"><summary>${esc(c.city)}仅公开到市级的单元 ${cityOnly.length} 个</summary>${cityOnly.map((r) => speciesButton(r, r.status)).join("")}</details>` : ""}
    <p class="count">县级记录不等于保护区内记录。</p></div>`;
  paint();
}
async function selectTaxon(id, fromSearch) {
  const r = S.byId[id]; if (!r) return;
  S.taxon = id; S.county = null;
  const prot = [r.natl && `国家${r.natl === "I" ? "一" : "二"}级`, r.rl && `红色名录 ${r.rl}`, r.iucn && `IUCN ${r.iucn}`, r.endemic && "中国特有", r.prov && "河南省重点保护"].filter(Boolean).join(" · ");
  const kv = [["编号", r.id], ["分类", `${r.cls} · ${r.order} · ${r.family}`], ["收录状态", r.status], ["证据依据", r.basis], ["证据解释", r.interp],
    ["保护与受威胁", prot || "—"], ["市（县）分布", r.dist || "暂无可公开的县级记录"], ["国家重要栖息地名录", r.hab.join("；")],
    ["观鸟报告", r.reports ? `${r.reports} 次，跨 ${r.years} 年` : ""], ["需要的证据", r.need]].filter(([, v]) => v);
  $("view").innerHTML = `<div class="card2"><p class="crumbs"><button type="button" data-go="prov">河南省</button> › 物种</p>
    <h3>${esc(r.cn || r.sci)} <i>${esc(r.sci)}</i></h3><div>${flagPills(r)} <span class="pill">优先级 ${r.prio}</span></div>
    <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <div class="acts"><button class="btn" type="button" data-form="comment">发表评论</button><button class="btn ghost" type="button" data-form="edit">建议修改</button><button class="btn ghost" type="button" data-form="add_record">补充分布记录</button></div>
    <h3 style="font-size:1rem">讨论与已采纳建议</h3><div class="thread" id="thread"><p class="count">${S.online ? "加载中…" : "在线讨论暂不可用。"}</p></div></div>`;
  paint();
  if (fromSearch) $("map").scrollIntoView({ block: "nearest" });
  if (!S.online) return;
  try {
    const { items } = await api(`/api/items?taxon=${encodeURIComponent(id)}`);
    if (S.taxon !== id) return;
    const pend = (S.summary[id] || {}).pending || 0;
    $("thread").innerHTML = (items.length ? items.map(postHTML).join("") : '<p class="count">还没有已采纳的讨论，欢迎第一个发表意见。</p>') +
      (pend ? `<p class="count">另有 ${pend} 条建议正在审核。</p>` : "");
  } catch (e) { $("thread").innerHTML = `<p class="count">讨论加载失败：${esc(e.message)}</p>`; }
}
function postHTML(x) {
  const cty = x.county_code && S.cty[x.county_code] ? `${S.cty[x.county_code].city}${S.cty[x.county_code].name}` : "";
  const what = x.kind === "edit" ? `<b>${esc(x.field)}</b> → ${esc(x.proposed)}` : x.kind === "add_record" ? `<b>补充记录：</b>${esc([cty, x.place_note].filter(Boolean).join("，"))}` : x.kind === "add_species" ? `<b>新增物种：</b>${esc(x.taxon_name)}` : "";
  return `<div class="post ${x.kind}"><span class="who">${KIND_CN[x.kind]} · ${esc(x.author_name)}${x.author_unit ? "（" + esc(x.author_unit) + "）" : ""} · ${esc((x.created_at || "").slice(0, 10))}</span>
    ${what ? `<span>${what}</span>` : ""}<span>${esc(x.body)}</span>${x.voucher ? `<span class="who">凭证：${esc(x.evidence_type || "")} ${esc(x.voucher)}</span>` : ""}
    ${x.review_note ? `<span class="note">项目组：${esc(x.review_note)}</span>` : ""}</div>`;
}

// ---------- form / 表单 ----------
function openForm(kind) {
  if (!S.online) { $("offline").hidden = false; $("offline").scrollIntoView({ block: "center" }); return; }
  const f = $("form"), r = S.taxon ? S.byId[S.taxon] : null;
  const k = kind === "add_record_county" ? "add_record" : kind;
  f.reset(); f.dataset.kind = k; f.dataset.taxon = k === "add_species" ? "" : (r ? r.id : "");
  $("f-title").textContent = { comment: "发表评论", edit: "建议修改", add_record: "补充分布记录", add_species: "提出新增物种" }[k];
  $("f-sub").textContent = r && k !== "add_species" && kind !== "add_record_county" ? `${r.id} ${r.cn} ${r.sci}` : kind === "add_record_county" ? `${S.cty[S.county].city}${S.cty[S.county].name}：请在下方写明物种` : "名录尚未收录的物种";
  $("f-edit").hidden = k !== "edit"; $("f-rec").hidden = k !== "add_record"; $("f-new").hidden = !(k === "add_species" || kind === "add_record_county");
  $("f-sens").hidden = !(r && r.cityonly && r.status.startsWith("名录") && k !== "add_species" && kind !== "add_record_county");
  if (kind === "add_record_county") { f.county_code.value = S.county; f.dataset.taxon = ""; }
  try { const me = JSON.parse(localStorage.getItem("hn-collab-me") || "{}"); f.author_name.value = me.n || ""; f.author_unit.value = me.u || ""; f.contact.value = me.c || ""; } catch (e) { /* storage unavailable */ }
  $("f-status").textContent = ""; $("f-status").className = "status"; $("f-send").disabled = false;
  $("dlg").showModal();
}
async function sendForm(e) {
  e.preventDefault();
  const f = $("form"), k = f.dataset.kind, r = f.dataset.taxon ? S.byId[f.dataset.taxon] : null;
  const fd = Object.fromEntries(new FormData(f).entries());
  const body = { kind: k, taxon_id: r ? r.id : null, taxon_name: r ? `${r.cn} ${r.sci}`.trim() : (fd.taxon_name || "").trim(),
    county_code: fd.county_code || null, place_note: fd.place_note, field: fd.field, proposed: fd.proposed, body: fd.body,
    evidence_type: fd.evidence_type, voucher: fd.voucher, author_name: fd.author_name, author_unit: fd.author_unit, contact: fd.contact,
    credit_ok: f.credit_ok.checked, website: fd.website };
  // 中文：县页面补充记录若写的是名录内物种，则挂到该物种编号下；English: attach to a checklist ID when the name matches.
  if (!r && k === "add_record") {
    const hit = S.rows.find((x) => body.taxon_name && (body.taxon_name.includes(x.cn) && x.cn || body.taxon_name.includes(x.sci)));
    if (hit) { body.taxon_id = hit.id; body.taxon_name = `${hit.cn} ${hit.sci}`; } else { body.kind = "add_species"; }
  }
  const miss = [!body.author_name && "姓名", !body.author_unit && "单位", !body.body && "意见或依据", !body.taxon_name && "物种",
    k === "edit" && !body.proposed && "建议值", k === "add_record" && !body.county_code && !body.place_note && "县或保护地"].filter(Boolean);
  if (miss.length) { $("f-status").textContent = "请填写：" + miss.join("、"); $("f-status").className = "status err"; return; }
  $("f-send").disabled = true; $("f-status").textContent = "正在提交…";
  try {
    await api("/api/items", { method: "POST", body: JSON.stringify(body) });
    try { localStorage.setItem("hn-collab-me", JSON.stringify({ n: body.author_name, u: body.author_unit, c: body.contact })); } catch (err) { /* ignore */ }
    const key = body.taxon_id || "NEW"; S.summary[key] = S.summary[key] || { accepted: 0, pending: 0 }; S.summary[key].pending++;
    $("f-status").textContent = "已提交，感谢！项目组审核后会在此公开。"; $("f-status").className = "status ok";
    setTimeout(() => { $("dlg").close(); if (S.taxon) selectTaxon(S.taxon); else if (S.county) selectCounty(S.county); }, 1400);
  } catch (err) { $("f-status").textContent = "提交失败：" + err.message; $("f-status").className = "status err"; $("f-send").disabled = false; }
}

// ---------- search & feed / 搜索与动态 ----------
function search() {
  const q = $("q").value.trim().toLowerCase(), box = $("hits");
  if (!q) { box.hidden = true; return; }
  const hits = S.rows.filter((r) => [r.cn, r.sci, r.id, r.reported].join(" ").toLowerCase().includes(q)).slice(0, 12);
  box.innerHTML = hits.length ? hits.map((r) => `<button type="button" data-id="${r.id}">${esc(r.cn || r.sci)} <i style="color:var(--muted)">${esc(r.sci)} · ${r.id} · ${esc(r.status)}</i></button>`).join("") : '<p class="count" style="padding:8px 12px;margin:0">没有找到。如为名录未收录的物种，可在右侧“新增物种”中提出。</p>';
  box.hidden = false;
}
async function loadFeed() {
  if (!S.online) { $("feed").innerHTML = '<p class="count">在线讨论暂不可用。</p>'; return; }
  try {
    const { items } = await api("/api/items");
    $("feed").innerHTML = items.length ? items.slice(0, 8).map((x) => `<div>${x.taxon_id && S.byId[x.taxon_id] ? `<button class="sp" type="button" data-id="${x.taxon_id}" style="border:0;padding:0"><b>${esc(S.byId[x.taxon_id].cn)}</b></button>` : `<b>${esc(x.taxon_name)}</b>`}${postHTML(x)}</div>`).join("") : '<p class="count">尚无已采纳的提交。</p>';
  } catch (e) { $("feed").innerHTML = `<p class="count">${esc(e.message)}</p>`; }
}

// ---------- boot / 启动 ----------
async function boot() {
  const [geo, rows, places] = await Promise.all([loadJSON("data/atlas_geo.json"), loadJSON("data/review_rows.json"), loadJSON("data/places.json")]);
  S.geo = geo; S.rows = rows; S.places = places; rows.forEach((r) => { S.byId[r.id] = r; });
  $("cls-seg").innerHTML = CLASSES.map(([k, lab]) => `<button type="button" data-cls="${k}" aria-pressed="${k === ""}">${lab}</button>`).join("");
  const sel = $("form").county_code;
  sel.insertAdjacentHTML("beforeend", places.counties.map(([c, n, city]) => `<option value="${c}">${esc(city)} ${esc(n)}</option>`).join(""));
  drawMap(); paint(); viewProvince();
  // 中文：未配置后台地址时直接进入只读模式；English: read-only when no API is configured.
  if (API) {
    try { const s = await api("/api/summary"); S.summary = s.taxa || {}; S.online = true; }
    catch (e) { S.online = false; }
  }
  $("offline").hidden = S.online;
  loadFeed();
  // 中文：支持从核查表直接跳转到某物种的评论、修改或补充记录表单；English: deep links such as ?act=edit#HN0001.
  const h = location.hash.match(/^#(HN\d{4})$/);
  if (h) {
    await selectTaxon(h[1]);
    const act = new URLSearchParams(location.search).get("act");
    if (["comment", "edit", "add_record"].includes(act) && S.byId[h[1]]) openForm(act);
    if (act) history.replaceState(null, "", location.pathname + location.hash);
  }
}
document.addEventListener("click", (e) => {
  const sp = e.target.closest("[data-id]"); if (sp) { $("hits").hidden = true; $("q").value = ""; selectTaxon(sp.dataset.id, true); history.replaceState(null, "", "#" + sp.dataset.id); return; }
  const go = e.target.closest("[data-go]"); if (go) { S.taxon = null; S.county = null; paint(); viewProvince(); history.replaceState(null, "", location.pathname); return; }
  const fm = e.target.closest("[data-form]"); if (fm) { openForm(fm.dataset.form); return; }
  const cb = e.target.closest("[data-cls]");
  if (cb) { S.cls = cb.dataset.cls; document.querySelectorAll("[data-cls]").forEach((b) => b.setAttribute("aria-pressed", String(b === cb))); S.taxon = null; paint(); if (S.county) selectCounty(S.county); }
});
$("reset").addEventListener("click", () => { S.taxon = null; S.county = null; paint(); viewProvince(); history.replaceState(null, "", location.pathname); });
$("q").addEventListener("input", search);
$("add-species").addEventListener("click", () => { S.taxon = null; openForm("add_species"); });
$("form").addEventListener("submit", sendForm);
$("f-cancel").addEventListener("click", () => $("dlg").close());
boot().catch((e) => { $("view").innerHTML = `<p class="banner">页面数据加载失败：${esc(e.message)}</p>`; });

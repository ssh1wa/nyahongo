"use strict";

// ---------- 小工具 ----------
const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" width="19" height="19"><path fill="currentColor" d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
  loop: '<svg viewBox="0 0 24 24" width="19" height="19"><path fill="currentColor" d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="19" height="19"><path fill="currentColor" d="M6 19h4V5H6zm8-14v14h4V5z" opacity=".35"/><path fill="currentColor" d="M3 21 21 3l1.4 1.4-18 18z"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" width="44" height="44"><path fill="currentColor" d="M3 10h2v4H3zm4-3h2v10H7zm4-4h2v18h-2zm4 4h2v10h-2zm4 3h2v4h-2z"/></svg>',
  film: '<svg viewBox="0 0 24 24" width="36" height="36"><path fill="currentColor" d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm6 4.5v7l6-3.5z"/></svg>',
};

const POS_ZH = {
  名詞: "名词", 動詞: "动词", 形容詞: "形容词", 形状詞: "形容动词", 副詞: "副词", 助詞: "助词",
  助動詞: "助动词", 代名詞: "代词", 連体詞: "连体词", 接続詞: "接续词", 感動詞: "感叹词",
  接頭辞: "前缀", 接尾辞: "后缀", 補助記号: "标点", 記号: "符号", 空白: "空白",
};
const NON_WORD = new Set(["補助記号", "記号", "空白"]);

// ---------- 主题 ----------
(function initTheme() {
  const saved = store.get("theme", null);
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
  });
})();

// 侧边栏底部显示手机同步地址
let lanInfo = null;
api("/api/lan").then((lan) => {
  lanInfo = lan;
  if (!lan.enabled || !lan.urls.length) return;
  const el = $("#side-lan");
  el.innerHTML = `<span>手机连接地址</span><strong>${esc(lan.urls[0].replace("http://", ""))}</strong>`;
  el.title = "在手机 App 的「设置 → 同步与词典」里填写这个地址";
  el.hidden = false;
}).catch(() => {});

// 侧边栏：当前页高亮、处理中的任务、学习包数量、没填 Key 的提醒（每页都显示，定时刷新）
function markNav(name) {
  document.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
}
const finishedSeen = new Set();
let firstSidebarPoll = true;
async function pollSidebar() {
  try {
    const [jobs, lib, s] = await Promise.all([api("/api/jobs"), api("/api/library"), api("/api/settings")]);
    const active = jobs.jobs.filter((j) => j.status === "queued" || j.status === "running");
    const running = jobs.jobs.find((j) => j.status === "running");
    $("#badge-add").textContent = active.length ? String(active.length) : "";
    $("#badge-library").textContent = lib.length ? String(lib.length) : "";
    $("#badge-settings").className = `nav-badge${s.llm.has_key && s.llm.model ? "" : " dot"}`;
    $("#side-jobs").innerHTML = running ? `
      <a class="side-job" href="#/">
        <span class="spinner"></span>
        <span><strong>正在处理</strong>${esc(running.display)}</span>
      </a>` : "";
    for (const j of jobs.jobs) {
      if (j.status === "done" && !finishedSeen.has(j.id)) {
        finishedSeen.add(j.id);
        if (!firstSidebarPoll) toast(`「${j.display}」处理好了，在学习库里`);
      }
    }
    firstSidebarPoll = false;
  } catch {}
}
pollSidebar();
setInterval(pollSidebar, 2500);

// ---------- 路由 ----------
let cleanup = () => {};
function route() {
  cleanup();
  cleanup = () => {};
  const m = location.hash.match(/^#\/play\/([^/?]+)/);
  const page = m ? "library" : location.hash.replace(/^#\/?/, "").split("/")[0] || "add";
  markNav(page);
  app.scrollTop = 0;
  if (m) renderPlayer(decodeURIComponent(m[1])); // 本地文件的 id 可能带中文，地址里是编码过的
  else if (page === "settings") renderSettings();
  else if (page === "library") renderLibraryPage();
  else if (page === "phone") renderPhone();
  else renderLibrary();
}
window.addEventListener("hashchange", route);

// ---------- 学习库 ----------
const uploads = new Map(); // 正在上传的本地文件（还没变成任务）
let currentWork = ""; // 导入页填的作品名
let currentTerms = ""; // 导入页手动补充的专有名词

function renderLibrary() {
  document.title = "にゃほんご PC 端";
  app.className = "page";
  app.innerHTML = `
    <header class="page-head">
      <div><h1>导入</h1><p>粘贴视频或播客的链接，或者把本地文件拖进窗口。处理好就能在手机上逐句精听。</p></div>
    </header>
    <section class="hero">
      <div id="setup-banner"></div>
      <div class="add-panel">
        <form class="add-row" id="add-form">
          <textarea class="url-input" id="url" rows="1" placeholder="粘贴视频或播客的链接，一次可以粘贴多行…" autocomplete="off"></textarea>
          <button class="btn primary" type="submit">开始处理</button>
        </form>
        <div class="add-options">
          <div class="switches">
            <label class="switch"><input type="checkbox" id="audio-only"><span class="track"></span>只保留音频（播客）</label>
            <label class="switch" title="B 站多 P、YouTube 播放列表等会拆成每集一个任务"><input type="checkbox" id="playlist"><span class="track"></span>展开整个合集</label>
            <label class="switch" title="测试版：英语视频做成中英双语字幕，点单词查英汉词典（不逐词拆解）"><input type="checkbox" id="lang-en"><span class="track"></span>英语（测试版）</label>
          </div>
          <span class="hint">也可以 <button class="link-btn" id="pick-file" type="button">选择本地文件（可多选）</button> 或直接拖进窗口</span>
        </div>
        <div class="work-row">
          <input class="text-input" id="work" maxlength="80" autocomplete="off" placeholder="作品名（可选），例如 轻音少女">
          <input class="text-input" id="terms" maxlength="500" autocomplete="off" placeholder="补充专有名词（可选），例如 唯（ゆい） 桜が丘">
          <label class="switch" title="作品名空着时，从视频标题或文件名里认出是哪部作品（用 AI 认，花费很少），再查角色名"><input type="checkbox" id="auto-work"><span class="track"></span>自动识别作品名</label>
          <span class="hint">填作品名会先从 Bangumi 查角色名、地名，AI 补上读音和昵称；查不到或不全的，在右边自己补，用空格隔开，括号里可以写读音。AI 校对时会把听错的人名改对，注音也按这里的读音。打开「自动识别作品名」，作品名空着时会按视频标题或文件名自己认（手动填的优先）。</span>
        </div>
        <div class="sites">
          <strong>支持的网站</strong>
          视频：B 站、YouTube、niconico、TVer、ABEMA 等 ·
          播客 / 广播：Apple Podcasts、Voicy、NHK らじる★らじる、radiko、SoundCloud、喜马拉雅、播客的 RSS 地址 ·
          不支持 Spotify（有加密）
          <input type="file" id="file-input" accept="video/*,audio/*,.mkv" multiple hidden>
        </div>
      </div>
    </section>
    <div id="jobs-wrap"><div class="empty-hint">处理中的任务会显示在这里。一个视频一般几分钟，处理好会通知你。</div></div>`;

  const audioOnly = $("#audio-only");
  audioOnly.checked = store.get("audioOnly", false);
  audioOnly.addEventListener("change", () => store.set("audioOnly", audioOnly.checked));

  const langEn = $("#lang-en");
  langEn.checked = store.get("langEn", false);
  langEn.addEventListener("change", () => store.set("langEn", langEn.checked));
  const playlist = $("#playlist");
  playlist.checked = store.get("playlist", false);
  playlist.addEventListener("change", () => store.set("playlist", playlist.checked));

  // 作品名只在这次打开窗口期间记住：连着导入同一部作品的几集不用重填，换作品时不会误用
  const workBox = $("#work");
  workBox.value = currentWork;
  workBox.addEventListener("input", () => { currentWork = workBox.value.trim(); });
  const autoWork = $("#auto-work");
  autoWork.checked = store.get("autoWork", false);
  autoWork.addEventListener("change", () => store.set("autoWork", autoWork.checked));
  const termsBox = $("#terms");
  termsBox.value = currentTerms;
  termsBox.addEventListener("input", () => { currentTerms = termsBox.value.trim(); });

  const urlBox = $("#url");
  const autoGrow = () => { urlBox.style.height = "auto"; urlBox.style.height = `${Math.min(urlBox.scrollHeight, 180)}px`; };
  urlBox.addEventListener("input", autoGrow);
  // 回车提交，Shift+回车换行；粘贴多行链接不受影响
  urlBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#add-form").requestSubmit(); }
  });

  $("#add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sources = urlBox.value.split(/\s+/).filter((s) => /^https?:\/\//i.test(s));
    if (!sources.length) { toast(urlBox.value.trim() ? "没找到 http 开头的链接" : "请先粘贴链接"); return urlBox.focus(); }
    const btn = e.submitter;
    if (btn) { btn.disabled = true; btn.textContent = playlist.checked ? "展开合集中…" : "提交中…"; }
    try {
      const r = await api("/api/jobs/batch", { method: "POST", body: JSON.stringify({ sources, audio_only: audioOnly.checked, playlist: playlist.checked, lang: langEn.checked ? "en" : "ja", work: currentWork, terms: currentTerms, auto_work: autoWork.checked }) });
      urlBox.value = "";
      autoGrow();
      toast(r.failed.length ? `已加入 ${r.created} 个任务，${r.failed.length} 个合集展开失败，按单个链接处理` : `已加入 ${r.created} 个任务`);
      refreshJobs();
    } catch (err) { toast(err.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = "开始处理"; } }
  });
  $("#pick-file").addEventListener("click", () => $("#file-input").click());
  $("#file-input").addEventListener("change", (e) => {
    [...e.target.files].forEach(uploadFile);
    e.target.value = "";
  });

  refreshJobs();
  refreshSetupBanner();
  const timer = setInterval(refreshJobs, 1000);
  cleanup = () => { clearInterval(timer); };
}

async function loadLibrary() {
  const box = $("#library");
  if (!box) return;
  let items;
  try { items = await api("/api/library"); } catch (err) { box.innerHTML = `<div class="empty">读取失败：${esc(err.message)}</div>`; return; }
  $("#lib-count").textContent = items.length ? `${items.length} 个学习包 · 手机连上 PC 端后在「精听」页下载` : "";
  if (!items.length) {
    box.innerHTML = `<div class="empty"><div class="big" lang="ja">空</div>还没有学习包。<br><a class="btn primary" href="#/">去导入一个视频</a></div>`;
    return;
  }
  box.innerHTML = `<div class="grid">${items.map(cardHtml).join("")}</div>`;
  box.querySelectorAll("[data-redo]").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const item = items.find((x) => x.id === btn.dataset.redo);
    try {
      await api("/api/jobs", { method: "POST", body: JSON.stringify({ source: item.source_url, audio_only: item.media_type === "audio", overwrite: true, lang: item.lang || "ja", work: item.work, terms: item.terms }) });
      toast("已加入处理队列：已下载的视频和转写结果会直接复用");
      pollSidebar();
    } catch (err) { toast(err.message); }
  }));
  box.querySelectorAll(".card-delete[data-id]").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const item = items.find((x) => x.id === btn.dataset.id);
    if (!confirm(`删除「${item.title}」？\n学习包文件会被删除，原始下载文件保留。`)) return;
    try { await api(`/api/library/${encodeURIComponent(item.id)}`, { method: "DELETE" }); toast("已删除"); loadLibrary(); }
    catch (err) { toast(err.message); }
  }));
}

function cardHtml(m) {
  const thumb = m.has_thumb
    ? `<img src="/api/library/${encodeURIComponent(m.id)}/thumb" alt="" loading="lazy">`
    : m.media_type === "audio" ? ICONS.audio : ICONS.film;
  const source = (m.lang === "en" ? '<span class="tag manual">英语</span>' : "")
    + (m.subtitle_source === "manual" ? '<span class="tag manual">人工字幕</span>' : '<span class="tag">AI 转写</span>');
  return `
    <a class="card" href="#/play/${encodeURIComponent(m.id)}">
      <button class="card-delete" data-id="${m.id}" title="删除">${ICONS.trash}</button>
      ${m.source_url ? `<button class="card-delete redo" data-redo="${m.id}" title="重新处理（用上最新的 AI 校对和词典）">${ICONS.replay}</button>` : ""}
      <div class="thumb ${m.media_type === "audio" ? "audio" : ""}">${thumb}<span class="duration">${fmtTime(m.duration)}</span></div>
      <div class="card-body">
        <h3 class="card-title">${esc(m.title)}</h3>
        <div class="card-meta">${source}<span class="tag">${m.sentence_count} 句</span><span class="tag">${m.size_mb} MB</span></div>
      </div>
    </a>`;
}

// ---------- 处理任务 ----------
let stages = ["下载", "转写", "AI 校对", "分词查词", "打包"];
const seenDone = new Set();

async function refreshJobs() {
  const wrap = $("#jobs-wrap");
  if (!wrap) return;
  let data;
  try { data = await api("/api/jobs"); } catch { return; }
  stages = data.stages;
  let finishedNow = false;
  for (const j of data.jobs) {
    if (j.status === "done" && !seenDone.has(j.id)) { seenDone.add(j.id); finishedNow = true; }
  }
  if (finishedNow) pollSidebar();

  const rows = [...uploads.values()].map(uploadHtml).concat(data.jobs.map(jobHtml));
  if (!rows.length) { wrap.innerHTML = '<div class="empty-hint">处理中的任务会显示在这里。一个视频一般几分钟，处理好会通知你。</div>'; return; }
  const active = data.jobs.filter((j) => j.status === "queued" || j.status === "running").length + uploads.size;
  wrap.innerHTML = `
    <div class="section-title"><h2>处理队列</h2><span>${active ? `${active} 个进行中` : "全部完成"}</span></div>
    <div class="jobs">${rows.join("")}</div>`;

  wrap.querySelectorAll("[data-dismiss]").forEach((b) => b.addEventListener("click", async () => {
    await api(`/api/jobs/${b.dataset.dismiss}`, { method: "DELETE" });
    refreshJobs();
  }));
  wrap.querySelectorAll("[data-overwrite]").forEach((b) => b.addEventListener("click", async () => {
    const job = data.jobs.find((j) => j.id === b.dataset.overwrite);
    await api(`/api/jobs/${job.id}`, { method: "DELETE" });
    await api("/api/jobs", { method: "POST", body: JSON.stringify({ source: job.source, audio_only: job.audio_only, overwrite: true, title: job.title, lang: job.lang || "ja", work: job.work, terms: job.terms, auto_work: job.auto_work }) });
    toast("已重新加入队列");
    refreshJobs();
  }));
}

function stepperHtml(job) {
  return stages.map((name, i) => {
    let cls = "";
    if (job.status === "done" || i < job.stage) cls = "done";
    else if (i === job.stage && job.status === "running") cls = "active";
    return `<span class="step ${cls}">${name}</span>`;
  }).join('<span class="step-sep"></span>');
}

// 处理中遇到的情况（比如显卡用不了改用 CPU）
const notesHtml = (j) => (j.notes || []).map((n) => `<div class="job-note">${esc(n)}</div>`).join("");

function jobHtml(j) {
  const title = `<div class="job-title" title="${esc(j.source)}">${esc(j.display)}</div>`;
  if (j.status === "queued") {
    return `<div class="job">${title}
      <div class="job-actions"><button class="btn small ghost" data-dismiss="${j.id}" title="取消这个任务">${ICONS.close}</button></div>
      <div class="job-detail">排队中，等前面的任务处理完</div></div>`;
  }
  if (j.status === "running") {
    const p = j.stage_progress;
    const bar = p === null || p === undefined
      ? '<div class="progress indeterminate"><div></div></div>'
      : `<div class="progress"><div style="width:${Math.round(p * 100)}%"></div></div>`;
    return `<div class="job">${title}<div class="job-actions"></div>
      <div class="stepper">${stepperHtml(j)}<span style="margin-left:8px">${esc(j.detail)}</span></div>${bar}${notesHtml(j)}</div>`;
  }
  if (j.status === "done") {
    return `<div class="job done">${title}
      <div class="job-actions">
        <a class="btn small primary" href="#/play/${encodeURIComponent(j.pkg_id)}">开始学习</a>
        <button class="btn small ghost" data-dismiss="${j.id}" title="移除">${ICONS.close}</button>
      </div>
      <div class="job-detail">✓ ${esc(j.detail)}</div>${notesHtml(j)}</div>`;
  }
  const exists = j.exists
    ? `<a class="btn small" href="#/play/${encodeURIComponent(j.pkg_id)}">打开已有</a><button class="btn small" data-overwrite="${j.id}">覆盖重新生成</button>`
    : "";
  return `<div class="job error">${title}
    <div class="job-actions">${exists}<button class="btn small ghost" data-dismiss="${j.id}" title="移除">${ICONS.close}</button></div>
    <div class="job-detail">${esc(j.error)}</div>${notesHtml(j)}</div>`;
}

function uploadHtml(u) {
  const pct = Math.round(u.progress * 100);
  return `<div class="job"><div class="job-title">${esc(u.name)}</div><div class="job-actions"></div>
    <div class="job-detail">${u.started ? `导入文件 ${pct}%` : "等待导入…"}</div>
    <div class="progress"><div style="width:${pct}%"></div></div></div>`;
}

// 多个文件逐个上传：同时传会互相抢带宽，而且后面的处理本来就要排队
let uploading = false;
let uploadSeq = 0;

function uploadFile(file) {
  uploads.set(`u${uploadSeq++}`, { name: file.name, progress: 0, started: false, file, audioOnly: store.get("audioOnly", false), lang: store.get("langEn", false) ? "en" : "ja", work: currentWork, terms: currentTerms, autoWork: store.get("autoWork", false) });
  refreshJobs();
  pumpUploads();
}

function pumpUploads() {
  if (uploading) return;
  const next = [...uploads.entries()].find(([, u]) => !u.started);
  if (!next) return;
  const [key, u] = next;
  uploading = true;
  u.started = true;
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/upload?filename=${encodeURIComponent(u.name)}&audio_only=${u.audioOnly}&lang=${u.lang}&work=${encodeURIComponent(u.work || "")}&terms=${encodeURIComponent(u.terms || "")}&auto_work=${u.autoWork}`);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) u.progress = e.loaded / e.total; };
  xhr.onloadend = () => {
    uploads.delete(key);
    uploading = false;
    if (xhr.status !== 200) toast(`「${u.name}」导入失败：${xhr.statusText || xhr.status}`);
    else if (![...uploads.values()].length) toast("文件都已导入，正在排队处理");
    refreshJobs();
    pumpUploads();
  };
  xhr.send(u.file);
}

// 整个窗口都可以拖入文件
(function initDrop() {
  const overlay = $("#drop-overlay");
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; depth++; overlay.classList.add("show"); });
  window.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove("show"); });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove("show");
    const files = [...e.dataTransfer.files].filter((f) => /^(video|audio)\//.test(f.type) || /\.(mkv|flv|ts)$/i.test(f.name));
    if (!files.length) return toast("只支持视频或音频文件");
    if (!location.hash.startsWith("#/") || location.hash.startsWith("#/play") || location.hash.startsWith("#/library")) location.hash = "#/";
    files.forEach(uploadFile);
  });
})();

// ---------- 播放器 ----------
function rubyHtml(tokens, sIdx) {
  return tokens.map((t, tIdx) => {
    // 英语学习包没有注音，单词 token 带 word: true
    const inner = t.furigana ? t.furigana.map((f) => f.reading
      ? `<ruby>${esc(f.text)}<rt>${esc(f.reading)}</rt></ruby>`
      : esc(f.text)).join("") : esc(t.surface);
    const word = (t.furigana ? !NON_WORD.has(t.pos) : t.word) ? " word" : "";
    return `<span class="tok${word}" data-s="${sIdx}" data-t="${tIdx}">${inner}</span>`;
  }).join("");
}

async function renderPlayer(id) {
  app.className = "player-page";
  app.innerHTML = '<div class="empty">加载中…</div>';
  let data;
  try { data = await api(`/api/library/${encodeURIComponent(id)}`); } catch (err) {
    app.innerHTML = `<div class="empty">打不开这个学习包：${esc(err.message)}<br><br><a class="btn" href="#/library">返回学习库</a></div>`;
    return;
  }
  const { meta, subtitles, dictionary = {}, attribution = "" } = data;
  const sentences = subtitles.sentences;
  const hasZh = sentences.some((s) => s.zh);
  document.title = `${meta.title} · にゃほんご`;
  const isVideo = meta.media_type === "video";

  app.innerHTML = `
    <div class="player-head">
      <a class="icon-btn" href="#/library" title="返回学习库">${ICONS.back}</a>
      <h1 title="${esc(meta.title)}">${esc(meta.title)}</h1>
    </div>
    <div class="player-layout">
      <div class="stage">
        ${isVideo
          ? `<div class="video-box"><video id="media" src="/api/library/${encodeURIComponent(id)}/media" preload="auto" playsinline></video></div>`
          : `<div class="audio-box">${ICONS.audio}<div>${esc(meta.title)}</div><audio id="media" src="/api/library/${encodeURIComponent(id)}/media" preload="auto"></audio></div>`}
        <div class="timeline" id="timeline"><div class="fill" id="fill"></div></div>
        <div class="controls">
          <button class="icon-btn" id="btn-prev" title="上一句（←）">${ICONS.prev}</button>
          <button class="play-btn" id="btn-play" title="播放 / 暂停（空格）">${ICONS.play}</button>
          <button class="icon-btn" id="btn-next" title="下一句（→）">${ICONS.next}</button>
          <button class="icon-btn" id="btn-replay" title="重听这一句（R）">${ICONS.replay}</button>
          <span class="sep"></span>
          <button class="icon-btn" id="btn-loop" title="单句循环（L）">${ICONS.loop}</button>
          <button class="icon-btn" id="btn-autopause" title="每句读完自动暂停（P）">${ICONS.stop}</button>
          <span class="sep"></span>
          <span class="ctl-label">速度</span>
          <div class="seg" id="speed">${[0.75, 0.9, 1, 1.25].map((r) => `<button data-rate="${r}">${r}×</button>`).join("")}</div>
          <span class="ctl-label">注音</span>
          <div class="seg" id="ruby-mode"><button data-mode="show">显示</button><button data-mode="hover">悬停</button><button data-mode="hidden">隐藏</button></div>
          ${hasZh ? `<span class="ctl-label">译文</span>
          <div class="seg" id="zh-mode"><button data-zh="show">显示</button><button data-zh="blur">模糊</button><button data-zh="hidden">隐藏</button></div>` : ""}
        </div>
        <div class="now">
          <div class="now-text" lang="ja" id="now-text"></div>
          <div class="now-zh" id="now-zh"></div>
          <div class="now-time" id="now-time"></div>
        </div>
        <div class="word-card" id="word-card" hidden></div>
        <div class="kbd-hint"><kbd>空格</kbd> 播放/暂停 · <kbd>←</kbd><kbd>→</kbd> 上/下一句 · <kbd>R</kbd> 重听 · <kbd>L</kbd> 循环 · <kbd>P</kbd> 自动暂停 · <kbd>F</kbd> 切换注音${hasZh ? " · <kbd>T</kbd> 切换译文" : ""} · 点击单词看完整词条</div>
      </div>
      <aside class="transcript">
        <div class="transcript-head"><strong>字幕</strong><span>${sentences.length} 句 · ${meta.subtitle_source === "manual" ? "人工字幕" : "AI 转写"}${meta.refined_by ? " · AI 校对" : ""}</span></div>
        <div class="lines" id="lines">
          ${sentences.map((s, i) => `<div class="line" data-i="${i}"${s.original ? ` title="识别原文：${esc(s.original)}"` : ""}><span class="line-time">${fmtTime(s.start)}</span><div><div class="line-text" lang="ja">${rubyHtml(s.tokens, i)}</div>${s.zh ? `<div class="line-zh">${esc(s.zh)}</div>` : ""}</div></div>`).join("")}
        </div>
        ${Object.keys(dictionary).length ? `<div class="attribution">${esc(attribution)}</div>` : ""}
      </aside>
    </div>
    <div class="tooltip" id="tooltip"></div>`;

  const media = $("#media");
  const lines = $("#lines");
  const lineEls = [...lines.children];
  const nowText = $("#now-text");
  const nowTime = $("#now-time");
  const nowZh = $("#now-zh");
  const wordCard = $("#word-card");
  const playBtn = $("#btn-play");
  const fill = $("#fill");

  const state = {
    idx: -1,
    loop: store.get("loop", false),
    autoPause: store.get("autoPause", false),
    rate: store.get("rate", 1),
    rubyMode: store.get("rubyMode", "show"),
    zhMode: store.get("zhMode", "blur"),
    pauseAt: null, // 自动暂停的时间点
    userScrolledAt: 0,
  };

  // 找到 currentTime 所在（或刚刚过去）的句子
  function indexAt(t) {
    let lo = 0, hi = sentences.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sentences[mid].start <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function setCurrent(i) {
    if (i === state.idx) return;
    lineEls[state.idx]?.classList.remove("current");
    state.idx = i;
    const s = sentences[i];
    if (!s) { nowText.innerHTML = '<span style="color:var(--muted);font-size:16px">按空格开始播放</span>'; nowTime.textContent = ""; nowZh.textContent = ""; return; }
    lineEls[i].classList.add("current");
    nowText.innerHTML = rubyHtml(s.tokens, i);
    nowZh.textContent = s.zh || "";
    nowTime.textContent = `第 ${i + 1} / ${sentences.length} 句 · ${fmtTime(s.start)} – ${fmtTime(s.end)}`;
    if (!media.paused && state.autoPause) state.pauseAt = s.end;
    if (Date.now() - state.userScrolledAt > 3000) {
      const el = lineEls[i];
      lines.scrollTop = el.offsetTop - lines.clientHeight / 2 + el.offsetHeight / 2;
    }
  }

  function playSentence(i) {
    i = Math.max(0, Math.min(sentences.length - 1, i));
    const s = sentences[i];
    media.currentTime = Math.max(0, s.start - 0.08);
    state.idx = -1; // 强制刷新
    setCurrent(i);
    state.pauseAt = state.autoPause ? s.end : null;
    media.play();
  }

  // 用 requestAnimationFrame 检查句尾，比 timeupdate（约 4 次/秒）精确
  let raf = 0;
  function tick() {
    const t = media.currentTime;
    const cur = sentences[state.idx];
    if (state.loop && cur && t >= cur.end + 0.12) {
      media.currentTime = Math.max(0, cur.start - 0.08);
    } else if (state.pauseAt !== null && t >= state.pauseAt + 0.12) {
      state.pauseAt = null;
      media.pause();
    } else if (!state.loop) {
      setCurrent(indexAt(t));
    }
    raf = requestAnimationFrame(tick);
  }

  media.addEventListener("play", () => { playBtn.innerHTML = ICONS.pause; cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  media.addEventListener("pause", () => { playBtn.innerHTML = ICONS.play; cancelAnimationFrame(raf); });
  media.addEventListener("timeupdate", () => {
    fill.style.width =`${(media.currentTime / (media.duration || meta.duration || 1)) * 100}%`;
    if (media.paused) setCurrent(indexAt(media.currentTime));
  });
  media.addEventListener("loadedmetadata", () => { media.playbackRate = state.rate; });
  if (isVideo) media.addEventListener("click", () => togglePlay());

  function togglePlay() {
    if (media.paused) {
      const cur = sentences[state.idx];
      if (state.autoPause && cur) state.pauseAt = cur.end;
      // 自动暂停后再按播放：从下一句开头继续
      if (state.autoPause && cur && media.currentTime >= cur.end) return playSentence(state.idx + 1);
      media.play();
    } else media.pause();
  }
  function prev() {
    const cur = sentences[state.idx];
    if (cur && media.currentTime - cur.start > 1.2) playSentence(state.idx);
    else playSentence(state.idx - 1);
  }
  const next = () => playSentence(state.idx + 1);
  const replay = () => playSentence(Math.max(state.idx, 0));

  function syncToggles() {
    $("#btn-loop").classList.toggle("active", state.loop);
    $("#btn-autopause").classList.toggle("active", state.autoPause);
    document.querySelectorAll("#speed button").forEach((b) => b.classList.toggle("on", Number(b.dataset.rate) === state.rate));
    document.querySelectorAll("#ruby-mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.rubyMode));
    app.classList.toggle("ruby-hidden", state.rubyMode === "hidden");
    app.classList.toggle("ruby-hover", state.rubyMode === "hover");
    document.querySelectorAll("#zh-mode button").forEach((b) => b.classList.toggle("on", b.dataset.zh === state.zhMode));
    app.classList.toggle("zh-blur", state.zhMode === "blur");
    app.classList.toggle("zh-hidden", state.zhMode === "hidden");
  }
  function cycleZh() {
    if (!hasZh) return;
    const modes = ["show", "blur", "hidden"];
    state.zhMode = modes[(modes.indexOf(state.zhMode) + 1) % modes.length];
    store.set("zhMode", state.zhMode);
    syncToggles();
    toast({ show: "译文：显示", blur: "译文：模糊，鼠标移上去显示", hidden: "译文：隐藏" }[state.zhMode]);
  }
  function toggleLoop() { state.loop = !state.loop; store.set("loop", state.loop); syncToggles(); toast(state.loop ? "单句循环：开" : "单句循环：关"); }
  function toggleAutoPause() {
    state.autoPause = !state.autoPause;
    state.pauseAt = state.autoPause && !media.paused ? sentences[state.idx]?.end ?? null : null;
    store.set("autoPause", state.autoPause);
    syncToggles();
    toast(state.autoPause ? "每句读完自动暂停：开" : "自动暂停：关");
  }
  function cycleRuby() {
    const modes = ["show", "hover", "hidden"];
    state.rubyMode = modes[(modes.indexOf(state.rubyMode) + 1) % modes.length];
    store.set("rubyMode", state.rubyMode);
    syncToggles();
    toast({ show: "注音：显示", hover: "注音：鼠标悬停时显示", hidden: "注音：隐藏" }[state.rubyMode]);
  }

  playBtn.addEventListener("click", togglePlay);
  $("#btn-prev").addEventListener("click", prev);
  $("#btn-next").addEventListener("click", next);
  $("#btn-replay").addEventListener("click", replay);
  $("#btn-loop").addEventListener("click", toggleLoop);
  $("#btn-autopause").addEventListener("click", toggleAutoPause);
  $("#speed").addEventListener("click", (e) => {
    const r = Number(e.target.dataset.rate);
    if (!r) return;
    state.rate = r; media.playbackRate = r; store.set("rate", r); syncToggles();
  });
  $("#ruby-mode").addEventListener("click", (e) => {
    if (!e.target.dataset.mode) return;
    state.rubyMode = e.target.dataset.mode; store.set("rubyMode", state.rubyMode); syncToggles();
  });
  $("#zh-mode")?.addEventListener("click", (e) => {
    if (!e.target.dataset.zh) return;
    state.zhMode = e.target.dataset.zh; store.set("zhMode", state.zhMode); syncToggles();
  });

  // 点击当前句里的单词：显示完整词条
  function showWordCard(token) {
    const entry = token.dict != null ? dictionary[token.dict] : null;
    const head = entry ? (entry.kanji[0] || entry.readings[0]) : token.base || token.surface;
    const readings = entry?.phonetic ? `/${entry.phonetic}/` : entry ? entry.readings.slice(0, 3).join("、") : token.reading || "";
    const senses = entry ? entry.senses.map((s, i) => `
      <li>
        <div class="ws-tags">${[...s.pos, ...s.tags].map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        <div class="ws-zh">${esc(s.zh || s.en.join("; "))}</div>
        ${s.zh ? `<div class="ws-en">${esc(s.en.join("; "))}</div>` : ""}
      </li>`).join("") : `<li><div class="ws-en">词典里没有找到这个词</div></li>`;
    wordCard.innerHTML = `
      <button class="icon-btn wc-close" title="关闭">${ICONS.close}</button>
      <div class="wc-head"><span class="wc-word" lang="ja">${esc(head)}</span><span class="wc-reading" lang="ja">${esc(readings)}</span>
        ${entry?.common ? '<span class="tag manual">常用词</span>' : ""}</div>
      ${token.surface.toLowerCase() !== String(head).toLowerCase() ? `<div class="wc-form">原文中的形式：<span lang="ja">${esc(token.surface)}</span></div>` : ""}
      <ol class="wc-senses">${senses}</ol>`;
    wordCard.hidden = false;
    wordCard.querySelector(".wc-close").addEventListener("click", () => { wordCard.hidden = true; });
  }
  nowText.addEventListener("click", (e) => {
    const tok = e.target.closest(".tok.word");
    if (tok) showWordCard(sentences[tok.dataset.s].tokens[tok.dataset.t]);
  });
  lines.addEventListener("click", (e) => {
    const line = e.target.closest(".line");
    if (line) playSentence(Number(line.dataset.i));
  });
  lines.addEventListener("wheel", () => { state.userScrolledAt = Date.now(); }, { passive: true });

  $("#timeline").addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    media.currentTime = ((e.clientX - rect.left) / rect.width) * (media.duration || meta.duration);
    state.userScrolledAt = 0;
  });

  // 悬停查词
  const tip = $("#tooltip");
  function showTip(e) {
    const tok = e.target.closest(".tok.word");
    if (!tok) return tip.classList.remove("show");
    const t = sentences[tok.dataset.s].tokens[tok.dataset.t];
    const entry = t.dict != null ? dictionary[t.dict] : null;
    const meanings = entry ? entry.senses.slice(0, 3).map((s) => s.zh || s.en.slice(0, 2).join("; ")) : [];
    const pos = entry?.senses[0]?.pos.join(" · ") || POS_ZH[t.pos] || t.pos;
    tip.innerHTML = `
      <div class="tt-word" lang="ja">${esc(t.surface)}</div>
      ${t.reading ? `<div class="tt-reading" lang="ja">${esc(t.reading)}</div>` : ""}
      ${t.base && t.base !== t.surface ? `<div class="tt-row"><span>原形</span><span lang="ja">${esc(t.base)}</span></div>` : ""}
      <div class="tt-row"><span>词性</span><span>${esc(pos)}</span></div>
      ${meanings.length ? `<ol class="tt-senses">${meanings.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>` : ""}`;
    const r = tok.getBoundingClientRect();
    tip.classList.add("show");
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  const hideTip = () => tip.classList.remove("show");
  app.addEventListener("mouseover", showTip);
  app.addEventListener("mouseleave", hideTip);

  function onKey(e) {
    if (e.target.matches("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const actions = {
      " ": togglePlay, ArrowLeft: prev, ArrowRight: next,
      r: replay, R: replay, l: toggleLoop, L: toggleLoop, p: toggleAutoPause, P: toggleAutoPause, f: cycleRuby, F: cycleRuby,
      t: cycleZh, T: cycleZh, Escape: () => { wordCard.hidden = true; },
    };
    const fn = actions[e.key];
    if (fn) { e.preventDefault(); fn(); }
  }
  document.addEventListener("keydown", onKey);

  syncToggles();
  setCurrent(-1);
  cleanup = () => {
    document.removeEventListener("keydown", onKey);
    app.removeEventListener("mouseover", showTip);
    app.removeEventListener("mouseleave", hideTip);
    app.classList.remove("ruby-hidden", "ruby-hover", "zh-blur", "zh-hidden");
    cancelAnimationFrame(raf);
    media.pause();
    media.removeAttribute("src");
    media.load();
  };
}

route();

// ---------- 设置 ----------
const SETTINGS_ICON = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';

async function renderSettings() {
  document.title = "设置 · にゃほんご PC 端";
  app.className = "page settings-page";
  app.innerHTML = '<div class="empty">读取设置中…</div>';
  let s;
  try { s = await api("/api/settings"); } catch (err) { app.innerHTML = `<div class="empty">读取设置失败：${esc(err.message)}</div>`; return; }

  const provider = s.providers.find((p) => p.url.replace(/\/+$/, "") === s.llm.base_url.replace(/\/+$/, ""));
  app.innerHTML = `
    <header class="page-head"><div><h1>设置</h1><p>改完自动保存，马上生效。</p></div></header>

    <section class="set-card">
      <h2>AI 服务</h2>
      <p class="set-hint">AI 用来校对字幕、加上整句中文翻译、给词典补中文释义。不填也能处理视频，只是字幕没有中文翻译，识别错的字也不会被纠正。用和手机 App 同一家就行。</p>
      <div class="field"><label>服务商</label>
        <div class="chips" id="providers">
          ${s.providers.map((p) => `<button type="button" class="chip${provider?.id === p.id ? " on" : ""}" data-url="${esc(p.url)}" data-site="${esc(p.site)}" data-model="${esc(p.model || "")}">${esc(p.name)}</button>`).join("")}
          <button type="button" class="chip${provider ? "" : " on"}" data-url="">其他</button>
        </div>
        <div class="set-hint" id="provider-hint">${provider ? `在 ${esc(provider.site)} 注册并创建 API Key，复制到下面。` : ""}</div>
        <input class="text-input" id="base-url" value="${esc(s.llm.base_url)}" placeholder="https://…/v1（兼容 OpenAI 格式的接口地址）" ${provider ? "hidden" : ""}>
      </div>
      <div class="field"><label>API Key</label>
        <input class="text-input" id="api-key" type="password" autocomplete="off"
          placeholder="${s.llm.has_key ? (s.llm.from_env ? "已从环境变量读取" : `已填写（末尾 ${esc(s.llm.key_tail)}），要换的话直接粘贴新的`) : "粘贴在服务商官网创建的 Key"}">
        <div class="set-hint">只保存在这台电脑的 config.toml 里。</div>
      </div>
      <div class="field"><label>模型</label>
        <div class="row">
          <input class="text-input" id="model" list="model-list" value="${esc(s.llm.model)}" placeholder="点「读取模型列表」再选，或者直接输入">
          <datalist id="model-list"></datalist>
          <button class="btn small" id="load-models" type="button">读取模型列表</button>
          <button class="btn small" id="test-llm" type="button">测试</button>
        </div>
        <div class="set-hint" id="llm-status">不知道选哪个：名字里带 DeepSeek 或 Qwen 的较新版本，中文好、价格便宜。</div>
      </div>
    </section>

    <section class="set-card">
      <h2>下载</h2>
      <div class="field"><label>代理</label>
        <input class="text-input" id="proxy" value="${esc(s.download.proxy)}" placeholder="例如 http://127.0.0.1:7890，不用代理就留空">
        <div class="set-hint">国内网络下载 YouTube、niconico 要用代理。只对这些网站生效：<span id="proxy-domains">${esc(s.download.proxy_domains.join("、"))}</span></div>
      </div>
      <div class="field"><label>需要登录才能看的视频</label>
        <select class="text-input" id="cookies">
          ${[["", "不读取（一般不需要）"], ["edge", "读取 Edge 的登录状态"], ["chrome", "读取 Chrome 的登录状态"], ["firefox", "读取 Firefox 的登录状态"]]
            .map(([v, t]) => `<option value="${v}"${s.download.cookies_from_browser === v ? " selected" : ""}>${t}</option>`).join("")}
        </select>
        <div class="set-hint">会员视频、年龄限制的视频要先在这个浏览器里登录网站。</div>
      </div>
      <div class="field"><label>最高画质</label>
        <select class="text-input" id="max-height">
          ${[480, 720, 1080].map((h) => `<option value="${h}"${s.download.max_height === h ? " selected" : ""}>${h}p${h === 720 ? "（推荐，手机上看够了）" : ""}</option>`).join("")}
        </select>
      </div>
    </section>

    <section class="set-card">
      <h2>语音识别</h2>
      <div class="field"><label>识别模型</label>
        <select class="text-input" id="whisper-model">
          ${s.whisper_models.map((m) => `<option value="${esc(m.id)}"${s.whisper.model === m.id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}
          ${s.whisper_models.some((m) => m.id === s.whisper.model) ? "" : `<option value="${esc(s.whisper.model)}" selected>${esc(s.whisper.model)}</option>`}
        </select>
        <div class="set-hint">第一次处理视频时下载模型。视频自带日语字幕时直接用字幕，不需要识别。</div>
      </div>
      <div class="field">
        <label class="switch"><input type="checkbox" id="hf-mirror"${s.whisper.hf_mirror ? " checked" : ""}><span class="track"></span>国内网络：模型从国内镜像（hf-mirror.com）下载</label>
      </div>
    </section>

    <section class="set-card" id="update-card">
      <h2>关于与更新</h2>
      <div class="row">
        <span>当前版本 <b>v${esc(updateInfo.current || "")}</b></span>
        <button class="btn small" id="check-update" type="button">检查更新</button>
      </div>
      <div id="update-result">${updateHtml(updateInfo)}</div>
    </section>

    <section class="set-card">
      <h2>文件</h2>
      <div class="row">
        <button class="btn small" data-open="library" type="button">打开学习库文件夹</button>
        <button class="btn small" data-open="config" type="button">打开设置文件所在文件夹</button>
      </div>
      <div class="set-hint">学习库：${esc(s.paths.library_abs)}</div>
    </section>`;

  // 改了就保存
  const save = async (patch, msg = "已保存") => {
    try { s = await api("/api/settings", { method: "PUT", body: JSON.stringify(patch) }); toast(msg); refreshSetupBanner(); }
    catch (err) { toast(`保存失败：${err.message}`); }
  };
  const llmBody = () => ({ base_url: $("#base-url").value.trim(), api_key: $("#api-key").value.trim(), model: $("#model").value.trim() });

  app.querySelectorAll("#providers .chip").forEach((b) => b.addEventListener("click", () => {
    app.querySelectorAll("#providers .chip").forEach((x) => x.classList.toggle("on", x === b));
    const custom = !b.dataset.url;
    $("#base-url").hidden = !custom;
    $("#provider-hint").textContent = custom ? "填写兼容 OpenAI 格式的接口地址，一般以 /v1 结尾。" : `在 ${b.dataset.site} 注册并创建 API Key，复制到下面。`;
    if (!custom) {
      // 有推荐模型的（DeepSeek、DeepInfra）顺便填上
      $("#base-url").value = b.dataset.url;
      if (b.dataset.model) $("#model").value = b.dataset.model;
      save({ llm: { base_url: b.dataset.url, ...(b.dataset.model ? { model: b.dataset.model } : {}) } });
    }
    else $("#base-url").focus();
  }));
  $("#base-url").addEventListener("change", () => save({ llm: { base_url: $("#base-url").value.trim() } }));
  $("#api-key").addEventListener("change", async () => {
    const key = $("#api-key").value.trim();
    if (!key) return;
    await save({ llm: { api_key: key } }, "API Key 已保存");
    $("#api-key").value = "";
    $("#api-key").placeholder = `已填写（末尾 ${key.slice(-4)}），要换的话直接粘贴新的`;
  });
  $("#model").addEventListener("change", () => save({ llm: { model: $("#model").value.trim() } }));
  const status = (t, ok) => { const el = $("#llm-status"); el.textContent = t; el.className = `set-hint ${ok === true ? "ok" : ok === false ? "err" : ""}`; };
  $("#load-models").addEventListener("click", async (e) => {
    e.target.disabled = true; status("正在读取…");
    try {
      const r = await api("/api/settings/models", { method: "POST", body: JSON.stringify(llmBody()) });
      $("#model-list").innerHTML = r.models.map((m) => `<option value="${esc(m)}">`).join("");
      status(`这家有 ${r.models.length} 个模型可选，点模型输入框选择。`, true);
      $("#model").focus();
    } catch (err) { status(err.message, false); }
    finally { e.target.disabled = false; }
  });
  $("#test-llm").addEventListener("click", async (e) => {
    e.target.disabled = true; status("正在测试…");
    try {
      const r = await api("/api/settings/test", { method: "POST", body: JSON.stringify(llmBody()) });
      status(`能用 · 回复用了 ${r.seconds} 秒`, true);
    } catch (err) { status(err.message, false); }
    finally { e.target.disabled = false; }
  });

  $("#proxy").addEventListener("change", () => save({ download: { proxy: $("#proxy").value.trim() } }));
  $("#cookies").addEventListener("change", () => save({ download: { cookies_from_browser: $("#cookies").value } }));
  $("#max-height").addEventListener("change", () => save({ download: { max_height: Number($("#max-height").value) } }));
  $("#whisper-model").addEventListener("change", () => save({ whisper: { model: $("#whisper-model").value } }));
  $("#hf-mirror").addEventListener("change", () => save({ whisper: { hf_mirror: $("#hf-mirror").checked } }));
  $("#check-update").addEventListener("click", async (e) => {
    e.target.disabled = true;
    $("#update-result").innerHTML = '<div class="set-hint">正在检查…</div>';
    await checkUpdate(true);
    $("#update-result").innerHTML = updateHtml(updateInfo, true);
    e.target.disabled = false;
  });
  app.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () =>
    api("/api/open-folder", { method: "POST", body: JSON.stringify({ which: b.dataset.open }) }).catch((err) => toast(err.message))));
}

// ---------- 检查更新 ----------
let updateInfo = { current: "" };

async function checkUpdate(force = false) {
  try { updateInfo = await api(`/api/update${force ? "?force=1" : ""}`); } catch (err) { updateInfo = { ...updateInfo, error: err.message }; }
  const pill = $("#side-update");
  pill.hidden = !updateInfo.newer;
  if (updateInfo.newer) pill.innerHTML = `有新版本<strong>v${esc(updateInfo.latest)}</strong>`;
}

// 更新说明是 Markdown，简单去掉符号显示成纯文字（和手机 App 的 plainNotes 一样）
const plainNotes = (md) => md.replace(/^#+\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();

function updateHtml(u, checked = false) {
  if (u.error) return `<div class="set-hint err">${esc(u.error)}。也可以直接去 <a href="${esc(u.url || "https://github.com/ssh1wa/nyahongo/releases")}" target="_blank">GitHub Releases</a> 看看。</div>`;
  if (!u.latest) return "";
  if (!u.newer) return checked ? '<div class="set-hint ok">已经是最新版本</div>' : "";
  return `<div class="update-box">
    <div><b>新版本 v${esc(u.latest)} 已发布</b></div>
    ${u.notes ? `<div class="update-notes">${esc(plainNotes(u.notes))}</div>` : ""}
    <div class="row">
      ${u.download ? `<a class="btn small primary" href="${esc(u.download)}" target="_blank">下载安装包</a>` : ""}
      <a class="btn small" href="${esc(u.url)}" target="_blank">查看更新说明</a>
    </div>
    <div class="set-hint">下载后先关掉这个窗口再安装，装到原来的位置；已填的 Key 和学习库会保留。</div>
  </div>`;
}
checkUpdate();
setInterval(checkUpdate, 6 * 3600 * 1000);

// 还没填 AI Key 时，学习库上面提示一下
async function refreshSetupBanner() {
  const box = $("#setup-banner");
  if (!box) return;
  try {
    const s = await api("/api/settings");
    box.innerHTML = s.llm.has_key && s.llm.model ? "" : `
      <div class="setup-banner">
        <div><strong>还没填 AI 的 API Key</strong><br><span>不填也能处理视频，只是字幕没有中文翻译。填一次就好。</span></div>
        <a class="btn small primary" href="#/settings">去设置</a>
      </div>`;
  } catch { box.innerHTML = ""; }
}

// ---------- 学习库页 ----------
function renderLibraryPage() {
  document.title = "学习库 · にゃほんご PC 端";
  app.className = "page";
  app.innerHTML = `
    <header class="page-head">
      <div><h1>学习库</h1><p id="lib-count"></p></div>
      <a class="btn primary" href="#/">导入新的</a>
    </header>
    <div id="library"></div>`;
  loadLibrary();
}

// ---------- 手机页 ----------
function renderPhone() {
  document.title = "手机 · にゃほんご PC 端";
  app.className = "page";
  const url = lanInfo?.urls?.[0]?.replace("http://", "");
  app.innerHTML = `
    <header class="page-head"><div><h1>连接手机</h1><p>手机和这台电脑连同一个 Wi-Fi，就能下载学习包、同步学习进度。</p></div></header>
    <section class="phone-hero">
      <div class="phone-addr">
        <span>手机连接地址</span>
        <strong id="phone-url">${url ? esc(url) : "读取中…"}</strong>
        <button class="btn small" id="copy-url" type="button">复制</button>
      </div>
      <ol class="steps">
        <li><b>装手机 App</b>在 <a href="https://github.com/ssh1wa/nyahongo/releases" target="_blank">GitHub Releases</a> 下载 nyahongo.apk 装到安卓手机上</li>
        <li><b>填地址</b>App 右上角「设置 → 同步与词典 → PC 端地址」填上面的地址，点「测试连接并保存」</li>
        <li><b>下载学习包</b>回到 App 的「精听」页，下拉刷新，点「下载」</li>
      </ol>
      <p class="set-hint">连不上的话：第一次打开 PC 端时 Windows 会问是否允许网络访问，要选「允许」。点错了在「Windows 安全中心 → 防火墙 → 允许应用通过防火墙」里把 Python 勾上。</p>
    </section>
    <div class="section-title"><h2>多设备同步</h2></div>
    <div class="set-card"><p class="set-hint" style="margin:0">手机、平板都填同一个地址，生词本和复习进度、阅读和翻译记录、语法进度、精听学到哪一句、猫に小判会通过这台电脑自动合并。同步数据保存在 PC 端文件夹的 sync 里，会保留最近 30 个旧版本。</p></div>`;
  $("#copy-url").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#phone-url").textContent); toast("已复制"); } catch { toast("复制失败，手动选中复制吧"); }
  });
  if (!url) api("/api/lan").then((lan) => { lanInfo = lan; $("#phone-url").textContent = lan.urls[0]?.replace("http://", "") ?? "没有找到局域网地址"; }).catch(() => {});
}

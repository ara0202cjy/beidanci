/* ===================== 云同步（多端口 / 多账号） =====================
 * 纯前端 + 免费云存储，多设备共享进度。
 * 每个账号可配置多个同步端口（target），改动能自动同步到全部端口，互为冗余。
 * 默认后端：GitHub Gist（secret gist，单文件 JSON，天然带版本历史）
 * 备选后端：任意支持 GET/PUT JSON 的接口
 *
 * 同步范围：学习进度 progress、错词记录 wrongBook、自建词库 selfBank（含删除墓碑）、
 *           学习/打卡记录 history（保留 recallDone / sentenceDone 打卡标志）、
 *           设置 settings（当前词库 curBank、每日新词量、发音口音与语速、复习方式等）。
 *
 * 合并策略（多设备并发写入）：
 *   progress  按 key 取 lastReview 较新者，同日取 stage 较高者
 *   wrongBook 按 key 取 wrongCount 较大 / lastWrong 较新者
 *   selfBank  按单词取并集，用 selfTomb（墓碑）让删除也能同步
 *   history   按日期合并，同日按 key 去重取并集；打卡标志任一端完成即保留
 *   settings  比较 settings._at（仅当设置内容真正变化才由 app.js 的 touchSettings 更新）
 *             ——不可用 state.savedAt，因为本地快照的 savedAt 恒为当前时间
 */
'use strict';

const Sync = (function () {
  const K_LEGACY = 'wb_sync';
  const FILE = 'beidanci.json';   // 云端仓库里的存档文件名
  let device = (window.store && store.get('wb_device', '')) || (Math.random().toString(36).slice(2) + Date.now().toString(36));
  if (window.store) store.set('wb_device', device);
  let targets = [];               // 当前生效的同步端口数组（未登录时用 wb_sync 单端口）
  let pushing = null, timer = null;
  let rateInfo = { remaining: null, reset: null };   // 最近一次 GitHub 响应里的限流信息
  let lastSyncAt = 0;                                 // 上次全量 sync 时间（启动去重）
  let pullTimer = null;                               // 定时拉取定时器
  let visBound = false;                               // 可见性监听器是否已绑定

  /* ---------- 账号感知 ---------- */
  function acctName() { return (window.WB && window.WB.currentAccount) || ''; }
  function norm(c) { return Object.assign({ backend: 'gist', token: '', gistId: '', apiUrl: '', auto: true, lastSync: '', lastPull: '' }, c || {}); }
  function loadTargets() {
    const n = acctName();
    if (n) {
      const v = (window.store && store.get('wb_acct_sync_' + n, null));
      if (Array.isArray(v)) targets = v.map(norm);
      else if (v && (v.token || v.apiUrl)) targets = [norm(v)];
      else targets = [];
    } else {
      const c = (window.store && store.get(K_LEGACY, {})) || {};
      targets = (c && (c.token || c.apiUrl)) ? [norm(c)] : [];
    }
  }
  function saveTargets() {
    if (!window.store) return;
    const n = acctName();
    if (n) store.set('wb_acct_sync_' + n, targets);
    else store.set(K_LEGACY, targets[0] || {});
  }
  function on() { return targets.some(t => t.token || t.apiUrl); }
  function setToast(m) { if (window.toast) toast(m); }
  // 是否「可重试的瞬时错误」：限流 / 超时 / 网络中断。这类不影响本地数据，稍后自动重试即可，
  // 不应弹成吓人的「同步失败」。
  function transientErr(e) {
    const m = (e && e.message) || '';
    return /rate limit|timeout|timed out|network|Failed to fetch|aborted|ECONN|socket|503|502/i.test(m) || (e && (e.status === 403 || e.status === 429));
  }
  function handleSyncError(e, verb) {
    if (transientErr(e)) {
      // 上传路径由 push() 内部的指数退避负责静默重试（不弹窗）；此处仅对 pull/setup 等给出轻提示
      if (verb !== '上传') setToast('同步暂未成功（GitHub 接口限流或网络波动），本地进度已保存，将自动重试');
    } else {
      setToast('同步失败（' + verb + '）：' + e.message);
    }
  }

  function reload() { loadTargets(); if (on()) startPeriodicPull(); else stopPeriodicPull(); }

  /* ---------- 本地快照（通过 window.WB 读写 app.js 的内部状态） ---------- */
  function A() { return window.WB; }
  function localState() {
    const a = A();
    return {
      v: 1,
      savedAt: Date.now(),
      device,
      progress: a.progress || {},
      wrongBook: a.wrongBook || {},
      selfBank: a.selfBank || [],
      selfTomb: store.get('wb_selftomb', []),
      history: a.history || {},
      settings: a.settings || {},
      learnState: a.learnState || null,
      reviewState: a.reviewState || null,
      pendingPlan: a.pendingPlan || [],
      planTarget: a.planTarget || 0,
    };
  }
  function applyState(s) {
    if (!s) return;
    const a = A();
    if (s.progress) a.progress = s.progress;
    if (s.wrongBook) a.wrongBook = s.wrongBook;
    if (s.selfBank) a.selfBank = s.selfBank;
    if (s.history) a.history = s.history;
    if (s.learnState !== undefined && s.learnState !== null) a.learnState = s.learnState;
    if (s.reviewState !== undefined && s.reviewState !== null) a.reviewState = s.reviewState;
    if (s.pendingPlan) a.pendingPlan = s.pendingPlan;
    if (typeof s.planTarget === 'number') a.planTarget = s.planTarget;
    if (s.settings) a.settings = Object.assign(a.settings || {}, s.settings);
    if (s.selfTomb) store.set('wb_selftomb', s.selfTomb);
    if (window.saveAll) saveAll();
  }

  /* ---------- 合并 ---------- */
  function merge(a, b) {
    a = a || {}; b = b || {};
    const out = { v: 1, savedAt: Date.now(), device };
    // progress
    out.progress = {};
    const pk = new Set([...Object.keys(a.progress || {}), ...Object.keys(b.progress || {})]);
    pk.forEach(k => {
      const x = (a.progress || {})[k], y = (b.progress || {})[k];
      if (!x) { out.progress[k] = y; return; }
      if (!y) { out.progress[k] = x; return; }
      const dx = x.lastReview || x.firstLearned || '';
      const dy = y.lastReview || y.firstLearned || '';
      if (dy > dx) out.progress[k] = y;
      else if (dx > dy) out.progress[k] = x;
      else out.progress[k] = ((y.stage || 0) > (x.stage || 0) ? y : x);
    });
    // wrongBook
    out.wrongBook = {};
    const wk = new Set([...Object.keys(a.wrongBook || {}), ...Object.keys(b.wrongBook || {})]);
    wk.forEach(k => {
      const x = (a.wrongBook || {})[k], y = (b.wrongBook || {})[k];
      if (!x) { out.wrongBook[k] = y; return; }
      if (!y) { out.wrongBook[k] = x; return; }
      out.wrongBook[k] = Object.assign({}, x, y);
      out.wrongBook[k].wrongCount = Math.max(x.wrongCount || 0, y.wrongCount || 0);
      out.wrongBook[k].lastWrong = [x.lastWrong || '', y.lastWrong || ''].sort().pop();
    });
    // selfBank（并集 - 墓碑）
    const tomb = [...new Set([...(a.selfTomb || []), ...(b.selfTomb || [])])].map(w => w.toLowerCase());
    const map = new Map();
    (a.selfBank || []).concat(b.selfBank || []).forEach(w => {
      const k = (w.word || '').toLowerCase();
      if (k && !tomb.includes(k) && !map.has(k)) map.set(k, w);
    });
    out.selfBank = [...map.values()];
    out.selfTomb = [...new Set(tomb)];
    // history（必须保留打卡标志 recallDone / sentenceDone ——「单词复习 + 情境复习」两轮都完成才算当日已打卡。
    // 旧写法只重建 { new, review }，会把打卡记录整端抹掉，导致同步后已打卡日变回未打卡）
    out.history = {};
    const hk = new Set([...Object.keys(a.history || {}), ...Object.keys(b.history || {})]);
    hk.forEach(d => {
      const x = (a.history || {})[d] || {}, y = (b.history || {})[d] || {};
      const uniq = arr => { const m = new Map(); (arr || []).forEach(i => { if (i && i.key) m.set(i.key, i); }); return [...m.values()]; };
      const o = { new: uniq((x.new || []).concat(y.new || [])), review: uniq((x.review || []).concat(y.review || [])) };
      if (x.recallDone || y.recallDone) o.recallDone = true;      // 任一端完成即视为完成
      if (x.sentenceDone || y.sentenceDone) o.sentenceDone = true;
      if (x.studyDone || y.studyDone) o.studyDone = true;        // 任一端完成「学习内容」即保留
      out.history[d] = o;
    });
    // settings：不能用 state.savedAt 比较 —— 本地快照的 savedAt 恒为 Date.now()，
    // 会永远判定本地更新，导致云端的当前词库 curBank / 口音等设置拉不回来。改用设置自身的 _at。
    const sa = (a.settings && a.settings._at) || 0;
    const sb = (b.settings && b.settings._at) || 0;
    out.settings = Object.assign({}, a.settings || {}, (sb > sa ? (b.settings || {}) : (a.settings || {})));
    // 进行中的学习/复习会话 / 待学批次：
    // 旧逻辑按 savedAt「后写覆盖整段」——空闲设备（savedAt=现在）会把活跃设备进行中的会话整体冲掉并写回云端，
    // 导致另一台进度“丢失”。改为「本地非空则保留本地，仅当本地为空才采纳远端」，避免空闲端抹掉活跃端。
    // （两端都非空时保留本地，符合“以当前正在操作的这台为准”的预期。）
    const pick = (av, bv, empty) => {
      const aE = av === undefined || av === null || av === empty;
      const bE = bv === undefined || bv === null || bv === empty;
      if (!aE) return av;
      if (!bE) return bv;
      return empty;
    };
    out.learnState = pick(a.learnState, b.learnState, null);
    out.reviewState = pick(a.reviewState, b.reviewState, null);
    out.pendingPlan = pick(a.pendingPlan, b.pendingPlan, []);
    out.planTarget = (a.planTarget && a.planTarget !== 0) ? a.planTarget : (b.planTarget || 0);
    return out;
  }

  /* ---------- Gist 后端 ---------- */
  function noteRate(r) {
    try {
      const rem = r.headers.get('X-RateLimit-Remaining');
      const res = r.headers.get('X-RateLimit-Reset');
      if (rem !== null && rem !== undefined) rateInfo.remaining = +rem;
      if (res !== null && res !== undefined) rateInfo.reset = +res;
    } catch (e) { }
  }
  const GH = 'https://api.github.com/gists';
  function ghHeaders(t) {
    return {
      Authorization: 'Bearer ' + t.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }
  async function gistCreate(t) {
    const r = await fetch(GH, {
      method: 'POST', headers: ghHeaders(t), signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ description: '背单词工作台 · 进度同步', public: false, files: { [FILE]: { content: JSON.stringify(localState()) } } }),
    });
    if (!r.ok) { const e = new Error('创建 Gist 失败 (' + r.status + ')'); e.status = r.status; throw e; }
    noteRate(r);
    const d = await r.json();
    t.gistId = d.id; saveTargets();
    return d.id;
  }
  async function gistPull(t) {
    if (!t.gistId) return null;
    const r = await fetch(GH + '/' + t.gistId, { headers: ghHeaders(t), signal: AbortSignal.timeout(30000) });
    noteRate(r);
    if (r.status === 404) { const e = new Error('云端存档不存在，请检查 Gist ID'); e.status = 404; throw e; }
    if (!r.ok) { const e = new Error('读取失败 (' + r.status + ')'); e.status = r.status; throw e; }
    const d = await r.json();
    const f = d.files && d.files[FILE];
    if (!f) return null;
    let txt = f.content;
    if (f.truncated) { const rr = await fetch(f.raw_url, { signal: AbortSignal.timeout(30000) }); txt = await rr.text(); }
    try { return JSON.parse(txt); } catch (e) { return null; }
  }
  async function gistPush(state, t) {
    let id = t.gistId;
    if (!id) id = await gistCreate(t);
    let r = await fetch(GH + '/' + id, {
      method: 'PATCH', headers: ghHeaders(t), signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(state) } } }),
    });
    noteRate(r);
    if (r.status === 404) {
      // gist 已被删/失权：自动重建后重试一次（自愈，避免硬失败）
      t.gistId = '';
      id = await gistCreate(t);
      r = await fetch(GH + '/' + id, {
        method: 'PATCH', headers: ghHeaders(t), signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(state) } } }),
      });
      noteRate(r);
    }
    if (!r.ok) {
      const e = new Error('写入失败 (' + r.status + ')'); e.status = r.status;
      if (r.status === 403) { const reset = r.headers.get('X-RateLimit-Reset'); if (reset) { const secs = (+reset) - Math.floor(Date.now() / 1000); if (secs > 0) e.retryAfter = secs; } }
      throw e;
    }
  }

  /* ---------- 通用 HTTP 后端 ---------- */
  async function httpPull(t) {
    const r = await fetch(t.apiUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { const e = new Error('读取失败 (' + r.status + ')'); e.status = r.status; throw e; }
    return await r.json();
  }
  async function httpPush(state, t) {
    let r = await fetch(t.apiUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000), body: JSON.stringify(state),
    });
    if (!r.ok && r.status !== 200) { // 部分服务只接受 POST
      r = await fetch(t.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    }
    if (!r.ok) { const e = new Error('写入失败 (' + r.status + ')'); e.status = r.status; throw e; }
  }

  function pullFn(t) { return t.backend === 'http' ? httpPull(t) : gistPull(t); }
  function pushFn(s, t) { return t.backend === 'http' ? httpPush(s, t) : gistPush(s, t); }

  /* ---------- 对外动作（遍历所有端口） ---------- */
  async function push() {
    if (!on()) return;
    // 限流额度见底：延后到 reset 再补推，避免无意义的 403 风暴
    if (rateInfo.remaining !== null && rateInfo.remaining <= 2 && rateInfo.reset) {
      const wait = Math.min(Math.max(0, (rateInfo.reset * 1000) - Date.now()) + 3000, 1800000);
      setTimeout(() => { rateInfo.remaining = null; push().then(() => scheduleRefresh()).catch(() => {}); }, wait);
      return;
    }
    const st = localState();
    for (const t of targets) {
      await pushOne(st, t, 0);
    }
    saveTargets();
  }
  // 单端口上传；瞬时错误（限流/网络抖动）指数退避静默重试（1m,2m,4m…最长30m），不弹窗、不阻塞调用方
  function pushOne(st, t, attempt) {
    return pushFn(st, t).then(() => { t.lastSync = new Date().toLocaleString('zh-CN'); })
      .catch(e => {
        if (transientErr(e) && attempt < 5) {
          const wait = Math.min(60000 * Math.pow(2, attempt), 1800000);
          return new Promise(r => setTimeout(r, wait)).then(() => pushOne(st, t, attempt + 1));
        }
        handleSyncError(e, '上传');
      });
  }
  async function pull() {
    if (!on()) return;
    let merged = localState();
    for (const t of targets) {
      try {
        const remote = await pullFn(t);
        if (remote) { merged = merge(merged, remote); t.lastPull = new Date().toLocaleString('zh-CN'); }
      } catch (e) { handleSyncError(e, '拉取'); }
    }
    applyState(merged);
    saveTargets();
  }
  async function sync() {
    if (!on()) return;
    const now = Date.now();
    if (now - lastSyncAt < 8000) return;   // 启动去重：8s 内不重复全量同步（seedAccounts 与 loadBanks 两次调用合并为一次）
    lastSyncAt = now;
    await pull(); await push();
  }
  function startPeriodicPull() {
    if (pullTimer || !on()) return;
    pullTimer = setInterval(() => {
      if (on() && document.visibilityState !== 'hidden') {
        pull().then(() => scheduleRefresh()).catch(e => handleSyncError(e, '拉取'));
      }
    }, 5 * 60 * 1000);
    if (!visBound) {
      visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (on() && document.visibilityState === 'visible') {
          pull().then(() => scheduleRefresh()).catch(e => handleSyncError(e, '拉取'));
        }
      });
    }
  }
  function stopPeriodicPull() { if (pullTimer) { clearInterval(pullTimer); pullTimer = null; } }
  async function setup() {
    try {
      for (const t of targets) if (t.backend === 'gist' && t.token && !t.gistId) await gistCreate(t);
      await sync();
      setToast('已同步到云端');
    } catch (e) { handleSyncError(e, '同步'); }
    scheduleRefresh();
    startPeriodicPull();
  }

  function schedulePush() {
    if (!on() || !targets.some(t => t.auto !== false)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pushing = push().then(() => { pushing = null; scheduleRefresh(); }).catch(e => { pushing = null; handleSyncError(e, '上传'); });
    }, 2500);
  }
  function scheduleRefresh() { if (window.WB && window.WB.refresh) window.WB.refresh(); }

  /* ---------- 配对：把首个端口配置塞进链接，另一台打开即配置好 ---------- */
  function pairLink() {
    const t = targets[0] || {};
    const data = { b: t.backend, t: t.token, g: t.gistId, u: t.apiUrl };
    const s = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/=+$/, '');
    return location.origin + location.pathname + '#sync=' + s;
  }
  function tryImportFromHash() {
    const m = location.hash.match(/sync=([A-Za-z0-9+/]+)/);
    if (!m) return false;
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(m[1] + '=='.slice(0, (4 - m[1].length % 4) % 4)))));
      const t = norm({ backend: d.b || 'gist', token: d.t || '', gistId: d.g || '', apiUrl: d.u || '' });
      // 作为新端口加入当前账号（不覆盖已有端口）
      targets = targets.concat([t]);
      saveTargets();
      history.replaceState(null, '', location.pathname);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- UI ---------- */
  function escv(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function render(host) {
    if (!host) return;
    const on_ = on();
    const n = acctName();
    const t0 = targets[0] || norm({});
    const extra = targets.slice(1).map((t, i) => `
      <div class="card sub" style="margin-top:10px">
        <div class="sub-tip">端口 ${i + 2}：${t.backend === 'http' ? '自定义接口' : 'GitHub Gist'} ${escv(t.gistId || t.apiUrl || '（未配置）')}</div>
        <div class="row"><button class="btn ghost sm" data-del="${i + 1}">删除此端口</button></div>
      </div>`).join('');
    host.innerHTML = `
      <div class="card"><h2>☁️ 云同步 <span class="tag ${on_ ? 'green' : ''}">${on_ ? '已开启' : '未配置'}</span></h2>
        <div class="sub-tip">${n ? '当前账号 <b>' + escv(n) + '</b> 的同步端口（可配置多个，自动同步到全部）：' : '开启后多台设备共享同一份数据：打开页面自动拉取，学习后自动上传。'}${targets[0] && targets[0].lastSync ? ' 上次同步：' + escv(targets[0].lastSync) : ''}</div>
        <div class="sub-tip" style="margin-top:6px">同步内容：学习进度 · 错词记录 · 自建词库 · 打卡与学习记录 · 设置（当前词库 / 每日新词量 / 发音口音等）</div>
        <div class="seg" style="margin-top:12px">
          <div class="${t0.backend === 'gist' ? 'on' : ''}" id="bkGist">GitHub Gist</div>
          <div class="${t0.backend === 'http' ? 'on' : ''}" id="bkHttp">自定义接口</div>
        </div>
        ${t0.backend === 'gist' ? `
          <input class="field" id="syToken" type="password" placeholder="GitHub Token（勾选 gist 权限）" value="${escv(t0.token)}">
          <input class="field" id="syGist" placeholder="Gist ID（新设备填已有 ID；留空则自动新建）" value="${escv(t0.gistId)}">
        ` : `
          <input class="field" id="syUrl" placeholder="接口地址（GET 读取 / PUT 写入 JSON）" value="${escv(t0.apiUrl)}">
        `}
        <label class="sub-tip" style="display:flex;align-items:center;gap:6px;margin:6px 0 10px">
          <input type="checkbox" id="syAuto" ${t0.auto !== false ? 'checked' : ''} style="width:18px;height:18px"> 自动同步（学习/复习后自动上传到所有端口）
        </label>
        <div class="row">
          <button class="btn ghost sm" id="syPull">⬇ 从云端拉取</button>
          <button class="btn ghost sm" id="syPush">⬆ 上传到云端</button>
        </div>
        <button class="btn ${on_ ? 'ghost' : 'primary'} sm" id="syStart" style="margin-top:10px">${on_ ? '🔄 立即双向同步（全部端口）' : '✅ 保存并开启同步'}</button>
        ${extra}
        <button class="btn ghost sm" id="syAdd" style="margin-top:10px">➕ 添加更多同步端口</button>
        ${on_ ? `<button class="btn ghost sm" id="syPair" style="margin-top:10px">🔗 复制配对链接（给另一台自己的手机）</button>
                  <button class="btn ghost sm" id="syShare" style="margin-top:10px">📤 复制分享链接（给别人，不含我的云配置）</button>
                  <button class="btn ghost sm" id="syOff" style="margin-top:10px;color:var(--red)">关闭云同步</button>` : ''}
        <div class="sub-tip" style="margin-top:10px">每个端口独立存储，互为冗余；Token 仅存本机。Secret Gist 不公开，只有拿到 ID 的人能访问。</div>
      </div>`;
    const bkGist = host.querySelector('#bkGist'), bkHttp = host.querySelector('#bkHttp');
    bkGist.onclick = () => { if (!targets.length) targets.push(norm({})); targets[0].backend = 'gist'; saveTargets(); render(host); };
    bkHttp.onclick = () => { if (!targets.length) targets.push(norm({})); targets[0].backend = 'http'; saveTargets(); render(host); };
    const g = id => host.querySelector(id);
    if (g('#syAuto')) g('#syAuto').onchange = e => { if (!targets.length) targets.push(norm({})); targets[0].auto = e.target.checked; saveTargets(); };
    g('#syStart').onclick = async () => {
      if (!targets.length) targets.push(norm({}));
      const t0 = targets[0];
      t0.token = g('#syToken') ? g('#syToken').value.trim() : t0.token;
      t0.gistId = g('#syGist') ? g('#syGist').value.trim() : t0.gistId;
      t0.apiUrl = g('#syUrl') ? g('#syUrl').value.trim() : t0.apiUrl;
      saveTargets();
      if (!on()) { setToast('请填写 Token 或接口地址'); return; }
      setToast('同步中…');
      await setup();
      render(host);
    };
    g('#syPull').onclick = async () => { try { await pull(); setToast('已拉取'); scheduleRefresh(); } catch (e) { setToast('拉取失败：' + e.message); } };
    g('#syPush').onclick = async () => { try { await push(); setToast('已上传'); } catch (e) { setToast('上传失败：' + e.message); } };
    g('#syAdd').onclick = () => { targets.push(norm({})); saveTargets(); render(host); };
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const i = +b.dataset.del; targets.splice(i, 1); saveTargets(); render(host);
    });
    if (g('#syPair')) g('#syPair').onclick = async () => {
      const link = pairLink();
      try { await navigator.clipboard.writeText(link); setToast('配对链接已复制'); }
      catch (e) { prompt('复制这段链接，在另一台手机浏览器打开：', link); }
    };
    if (g('#syShare')) g('#syShare').onclick = () => {
      const link = location.origin + location.pathname;   // 去掉任何 #sync= 参数，确保不带我的云配置
      try { navigator.clipboard.writeText(link); setToast('分享链接已复制（不含云配置，发给别人用）'); }
      catch (e) { prompt('复制这段链接发给别人，对方数据只会存在他自己的手机上：', link); }
    };
    if (g('#syOff')) g('#syOff').onclick = () => {
      targets = []; saveTargets(); stopPeriodicPull(); render(host); setToast('已关闭云同步');
    };
  }

  return {
    render, setup, pull, push, sync, schedulePush, on, reload,
    merge,   // 暴露合并逻辑，供冒烟测试直接校验多端合并规则
    get targets() { return targets; },
    tryImportFromHash,
    noteDelete(word) { // 自建词库删除时记墓碑，让删除也能跨设备同步
      const t = (window.store ? store.get('wb_selftomb', []) : []);
      if (!t.some(w => w.toLowerCase() === word.toLowerCase())) { t.push(word); store.set('wb_selftomb', t); }
      schedulePush();
    },
  };
})();

// 顶层 const 不会自动挂到 window，必须显式挂载，
// 否则 app.js 里所有 window.Sync 判定都为假，云同步卡片/自动同步/配对链接会全部失效。
window.Sync = Sync;

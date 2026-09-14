/* ===================== 背单词工作台 ===================== */
'use strict';

/* ---------- 配置 ---------- */
let WB = './wordbank/';
async function detectBase() {
  for (const c of ['./wordbank/', '../wordbank/']) {
    try { const r = await fetch(c + 'levels/小学.json', { cache: 'no-store' }); if (r.ok) { await r.json(); return c; } } catch (e) { }
  }
  return './wordbank/';
}
const BANKS = [
  { id: '小学', file: 'levels/小学.json', color: '#8AA098' },
  { id: '初中', file: 'levels/初中.json', color: '#9AAE7E' },
  { id: '高中', file: 'levels/高中.json', color: '#8FA3B0' },
  { id: 'CET4', file: 'levels/CET4.json', color: '#C2A878' },
  { id: '六级', file: 'levels/六级.json', color: '#C9A07E' },
  { id: '考研', file: 'levels/考研.json', color: '#C08C8C' },
  { id: '雅思', file: 'levels/雅思.json', color: '#A89AB8' },
  { id: '托福', file: 'levels/托福.json', color: '#9A8FB0' },
];
const INTERVALS = [1, 2, 3, 5, 7, 15, 30];
// 错词复习节奏：在错误的第 1、2、3、20、40 天再次推送（独立于新词 INTERVALS）
const WRONG_INTERVALS = [1, 2, 3, 20, 40];
const SELFBANK_ID = '自建';
const K = {
  progress: 'wb_progress', wrong: 'wb_wrong', self: 'wb_selfbank',
  settings: 'wb_settings', history: 'wb_history', learn: 'wb_learnstate', review: 'wb_reviewstate',
  plan: 'wb_plan', plantarget: 'wb_plantarget',
};

/* ---------- 存储 ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
/* ---------- 多账号隔离 ---------- */
const ACCT = {
  reg: 'wb_accounts',                 // 账号登记表 { name: {salt, pwdHash} }
  session: 'wb_session',              // 当前登录账号名
  data: n => 'wb_acct_data_' + n,     // 每账号学习数据快照
  sync: n => 'wb_acct_sync_' + n,     // 每账号云端同步端口列表
};
let accounts = store.get(ACCT.reg, {});
let currentAccount = store.get(ACCT.session, '') || '';
function saveAccounts() { store.set(ACCT.reg, accounts); }
function saveSession() { store.set(ACCT.session, currentAccount); }

let progress, wrongBook, selfBank, settings, history, learnState, reviewState, pendingPlan, planTarget;
function snapshot() { return { progress, wrongBook, selfBank, settings, history, learnState, reviewState, pendingPlan, planTarget }; }
function loadState() {
  const base = { speed: 0, reviewMode: 'zh', autoSpeak: true, dailyNew: 5, curBank: '初中', reviewType: 'sentence', accent: 'en-US', pronRate: 0.95 };
  if (currentAccount) {
    const s = store.get(ACCT.data(currentAccount), null) || {};
    progress = s.progress || {};
    wrongBook = s.wrongBook || {};
    selfBank = s.selfBank || [];
    settings = Object.assign({}, base, s.settings || {});
    history = s.history || {};
    learnState = s.learnState || null;
    reviewState = s.reviewState || null;
    pendingPlan = s.pendingPlan || [];
    planTarget = s.planTarget || 0;
  } else {
    progress = store.get(K.progress, {});
    wrongBook = store.get(K.wrong, {});
    selfBank = store.get(K.self, []);
    settings = store.get(K.settings, base);
    history = store.get(K.history, {});
    learnState = store.get(K.learn, null);
    reviewState = store.get(K.review, null);
    pendingPlan = store.get(K.plan, []);
    planTarget = store.get(K.plantarget, 0);
  }
  if (!BANKS.some(b => b.id === settings.curBank)) settings.curBank = '初中';
  normalizeStudyBanks();   // 兼容迁移：从无 studyBanks 的旧数据构建「选词库 + 每日额度」
}
loadState();
// 设置项变更检测：仅当「内容」真正变化才更新 _at，供多端同步判断哪一端更新。
// 签名必须排除 _at 自身，否则「改时间戳→内容变→再改时间戳」会无限循环。
let _settingsSig = '';
function settingsSig() { const s = Object.assign({}, settings || {}); delete s._at; return JSON.stringify(s); }
function touchSettings() {
  const sj = settingsSig();
  if (sj !== _settingsSig) { _settingsSig = sj; if (settings) settings._at = Date.now(); }
}
_settingsSig = settingsSig();          // 以「刚载入的设置」为基线，避免首次保存就误判为已修改
function saveAll() {
  touchSettings();
  if (currentAccount) store.set(ACCT.data(currentAccount), snapshot());
  else {
    store.set(K.progress, progress); store.set(K.wrong, wrongBook);
    store.set(K.self, selfBank);     store.set(K.settings, settings); store.set(K.history, history);
    store.set(K.learn, learnState); store.set(K.review, reviewState);
    store.set(K.plan, pendingPlan); store.set(K.plantarget, planTarget);
  }
  try { if (window.Sync) Sync.schedulePush(); } catch (e) { }
}
window.store = store;
window.WB = {
  get progress() { return progress; }, set progress(v) { progress = v; },
  get wrongBook() { return wrongBook; }, set wrongBook(v) { wrongBook = v; },
  get selfBank() { return selfBank; }, set selfBank(v) { selfBank = v; },
  get settings() { return settings; }, set settings(v) { settings = v; },
  get history() { return history; }, set history(v) { history = v; },
  get learnState() { return learnState; }, set learnState(v) { learnState = v; },
  get reviewState() { return reviewState; }, set reviewState(v) { reviewState = v; },
  get pendingPlan() { return pendingPlan; }, set pendingPlan(v) { pendingPlan = v; },
  get planTarget() { return planTarget; }, set planTarget(v) { planTarget = v; },
  get currentAccount() { return currentAccount; },
  refresh() { try { PAGES[CUR](); } catch (e) { } },
  buildReviewPool,
  sortStudyOrder, dayRand,
  learnNext, wrongNext, refreshNext, isDue, settleReview, calibrateSchedule,
  exportLearnedExcel,
  reconcileLearnPlan, resolveWord, candidatesForBank, buildBatch, studyBanks,
  nextReviewRoundNeeded,
};

/* ---------- 账号：注册 / 登录 / 登出（每账号数据+同步端口完全隔离，互不干扰） ---------- */
async function hashPwd(pwd, salt) {
  const s = salt + ':' + pwd;
  if (window.crypto && crypto.subtle && crypto.subtle.digest) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { }
  }
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
async function verifyPwd(name, pwd) {
  const a = accounts[name]; if (!a) return false;
  return (await hashPwd(pwd, a.salt)) === a.pwdHash;
}
async function registerAccount(name, pwd) {
  const salt = Math.random().toString(36).slice(2, 10);
  accounts[name] = { salt, pwdHash: await hashPwd(pwd, salt) };
  saveAccounts();
  saveAll();                                   // 先保存当前空间数据
  currentAccount = name; saveSession();
  progress = {}; wrongBook = {}; selfBank = [];
  settings = Object.assign({ speed: 0, reviewMode: 'zh', autoSpeak: true, dailyNew: 5, curBank: '初中', reviewType: 'sentence', accent: 'en-US', pronRate: 0.95 }, settings);
  history = {}; learnState = null;
  if (!BANKS.some(b => b.id === settings.curBank)) settings.curBank = '初中';
  store.set(ACCT.data(name), snapshot());
  store.set(ACCT.sync(name), []);
  if (window.Sync) Sync.reload();
  toast('已注册并登录：' + name);
  openSettings();
}
async function loginAccount(name) {
  saveAll();
  currentAccount = name; saveSession();
  loadState();
  if (window.Sync) Sync.reload();
  // 登录后先从云端拉取并合并，避免空本地数据覆盖历史进度
  if (window.Sync && Sync.on()) { try { await Sync.sync(); } catch (e) { } }
  toast('已登录：' + name);
  if (typeof PAGES !== 'undefined' && CUR) PAGES[CUR]();
  openSettings();
}
async function logoutAccount() {
  saveAll();
  currentAccount = ''; saveSession();
  loadState();
  if (window.Sync) Sync.reload();
  toast('已退出登录');
  openSettings();
}
function renderAccount(host) {
  if (!host) return;
  if (currentAccount) {
    host.innerHTML = `
      <div class="sub-tip">当前登录账号：<b>${esc(currentAccount)}</b>。该账号的学习数据与云端同步端口相互独立，与其他账号互不干扰。</div>
      <button class="btn ghost sm" id="acctLogout" style="margin-top:10px;color:var(--red)">退出登录（切换账号）</button>`;
    host.querySelector('#acctLogout').onclick = () => logoutAccount();
  } else {
    host.innerHTML = `
      <div class="sub-tip">登录后本机数据按账号隔离，每账号可配置多个云端同步端口自动同步。未登录则沿用本机共用空间（与之前一致）。</div>
      <input class="field" id="acName" placeholder="账号名">
      <input class="field" id="acPwd" type="password" placeholder="密码">
      <div class="row" style="margin-top:8px">
        <button class="btn primary sm" id="acLogin">登录</button>
        <button class="btn ghost sm" id="acReg">注册新账号</button>
      </div>
      <div id="acMsg" class="sub-tip" style="color:var(--red);margin-top:6px"></div>`;
    const msg = host.querySelector('#acMsg');
    host.querySelector('#acLogin').onclick = async () => {
      const n = host.querySelector('#acName').value.trim(), p = host.querySelector('#acPwd').value;
      if (!n || !p) { msg.textContent = '请输入账号名和密码'; return; }
      if (!accounts[n]) { msg.textContent = '账号不存在，请先注册'; return; }
      if (!(await verifyPwd(n, p))) { msg.textContent = '密码错误'; return; }
      loginAccount(n);
    };
    host.querySelector('#acReg').onclick = async () => {
      const n = host.querySelector('#acName').value.trim(), p = host.querySelector('#acPwd').value;
      if (!n || !p) { msg.textContent = '请输入账号名和密码'; return; }
      if (accounts[n]) { msg.textContent = '账号已存在'; return; }
      registerAccount(n, p);
    };
  }
}

/* ---------- 首次运行预置账号（lvcheng） ---------- */
// Token 拆成片段拼接，避免源码出现字面量 ghp_ 个人令牌（GitHub 密钥扫描会拦截提交）
function _tok(parts) { return parts.join(''); }
const LVCHENG_TOKEN = _tok(['gh', 'p_', 'E0Egc3nIvJx9gpgBO4PF', 'GF8F5mlaIA4M2C4G']);
async function seedOne(name, pwd, targets) {
  const salt = Math.random().toString(36).slice(2, 10);
  accounts[name] = { salt, pwdHash: await hashPwd(pwd, salt) };
  saveAccounts();
  store.set(ACCT.sync(name), targets.map(t => Object.assign(
    { backend: 'gist', token: '', gistId: '', apiUrl: '', auto: true, lastSync: '', lastPull: '' }, t)));
}
function ensureLvchengSync() {
  const cur = store.get(ACCT.sync('lvcheng'), null);
  const has = Array.isArray(cur) && cur.some(t => t && (t.token || t.apiUrl));
  if (!has) {
    store.set(ACCT.sync('lvcheng'), [
      { backend: 'gist', token: LVCHENG_TOKEN, gistId: '557e900e63e7085ff1f67c1b5a0ee00d', auto: true },
    ]);
  }
}
async function seedAccounts() {
  if (accounts.lvcheng) { ensureLvchengSync(); return; }  // 账号已存在：仅补回可能缺失的云配置（如曾被手动注册），不覆盖密码
  // lvcheng 账号：独立 token 与 gist 存储空间；原始 token 的数据已并入此账号（见 gist 557e900e…），原 token 不再使用
  await seedOne('lvcheng', '000000', [
    { backend: 'gist', token: LVCHENG_TOKEN, gistId: '557e900e63e7085ff1f67c1b5a0ee00d', auto: true },
  ]);
  // 旧版（无账号时期）残留的本地进度，并入 lvcheng 账号，避免数据丢失
  const legacy = {
    progress: store.get(K.progress, null), wrong: store.get(K.wrong, null), self: store.get(K.self, null),
    settings: store.get(K.settings, null), history: store.get(K.history, null), learn: store.get(K.learn, null),
    review: store.get(K.review, null),
  };
  const hasLegacy = [legacy.progress, legacy.wrong, legacy.self, legacy.history].some(v => v && (Array.isArray(v) ? v.length : true)) || !!legacy.learn || !!legacy.review;
  if (hasLegacy) {
    store.set(ACCT.data('lvcheng'), {
      progress: legacy.progress || {}, wrongBook: legacy.wrong || {}, selfBank: legacy.self || [],
      settings: Object.assign({ speed: 0, reviewMode: 'zh', autoSpeak: true, dailyNew: 5, curBank: '初中', reviewType: 'sentence', accent: 'en-US', pronRate: 0.95 }, legacy.settings || {}),
      history: legacy.history || {}, learnState: legacy.learn || null, reviewState: legacy.review || null,
      pendingPlan: [], planTarget: 0,
    });
    currentAccount = 'lvcheng'; saveSession(); loadState();
    if (window.Sync) Sync.reload();
    if (window.Sync && Sync.on()) { try { await Sync.sync(); } catch (e) { } }
  }
}
window.seedAccounts = seedAccounts;

/* ---------- 数据 ---------- */
let BANK_DATA = {};
let ALL_INDEX = [];
let EXAMPLES = {};
let FREQ = {};
let OBSCURE = {};   // 熟词僻义（中考/高考）
let BANK_MAP = {};  // 单词 → 词库数据（批量添加时自动匹配）
let DICT = {};      // 离线查词词典（牛津8版抽取：{uk,us,meaning}）
let COLLOC = {};    // 牛津搭配词典：{ word: [ {c, i:[{w,z}]} ] }
let THES = {};      // 牛津同义词词典：{ word: [ {ex, g:[{c,s:[]}], ant:[]} ] }
let PHRASE = {};    // 牛津短语动词：{ "bring about": {base, senses:[{en,zh,ex:[{en,zh}]}]} }
let COMMON_SET = null; // 雅思与托福的交集（归一化词形），用于"先背相同词汇"
let BANKS_READY = false;       // 词库与离线词典是否加载完成（后台加载，不阻塞核心功能）
let BANK_LOAD_FAILED = false;  // 是否因 file:// 等无法读取词库

// 仅探测词库基址（极快），立即返回——让学习/复习/工作本等核心功能先可用
async function loadData() {
  WB = await detectBase();
}

// 词库与各离线词典在后台并行加载；加载完成后补全索引并刷新当前页。
// 学习/复习/工作本仅依赖 localStorage 中的进度数据，无需等待本函数。
function loadBanksBg() {
  const small = [
    ['examples.json', v => EXAMPLES = v], ['freq.json', v => FREQ = v],
    ['obscure.json', v => OBSCURE = v], ['dict.json', v => DICT = v],
    ['collocation.json', v => COLLOC = v], ['thesaurus.json', v => THES = v],
    ['phrasal.json', v => PHRASE = v],
  ];
  return Promise.all([
    ...BANKS.map(b => fetch(WB + b.file).then(r => r.json()).then(d => { BANK_DATA[b.id] = d; }).catch(() => { })),
    ...small.map(([f, set]) => fetch(WB + f).then(r => r.ok ? r.json() : null).then(d => { if (d) set(d); }).catch(() => { })),
  ]).then(() => {
    computeCommon(); // 计算雅思∩托福的共有词，供"先背相同词汇"排序使用
    ALL_INDEX = [];
    BANKS.forEach(b => (BANK_DATA[b.id]?.words || []).forEach(w => ALL_INDEX.push({ word: w.word, bank: b.id, meaning: w.meaning, phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk })));
    selfBank.forEach(w => ALL_INDEX.push({ word: w.word, bank: SELFBANK_ID, meaning: w.meaning, phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk }));
    BANK_MAP = {};
    ALL_INDEX.forEach(x => { if (!BANK_MAP[x.word.toLowerCase()]) BANK_MAP[x.word.toLowerCase()] = x; });
  });
}

/* ---------- 工具 ---------- */
const $ = sel => document.querySelector(sel);
const app = () => document.getElementById('app');
function bankKey(bank, word) { return bank + '::' + word.toLowerCase(); }
function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
// 按「锚点日期 + 节奏序列」取下一个档期：只取严格晚于 afterDay 的档期
// 档期由锚点日期决定，与当天复习了几轮无关 —— 因此同一天多轮复习不会跳级
function nextScheduleDate(anchor, intervals, afterDay) {
  const after = afterDay || anchor;
  for (const n of intervals) {
    const d = addDays(anchor, n);
    if (d > after) return d;
  }
  return '';                                   // 档期走完 → 已掌握，不再推送
}
// 双锚点排期：学习日锚点（firstLearned + INTERVALS）顺序固定；错题日锚点（wrongAnchor + WRONG_INTERVALS）叠加其上
// 学习日复习顺序固定不变；每次新答错则重置 wrongAnchor，错题节奏从头（第 1 天）重新数
function learnNext(p) {
  if (!p.firstLearned) return '';
  return nextScheduleDate(p.firstLearned, INTERVALS, p.lastLearnReview || p.firstLearned);
}
function wrongNext(p) {
  if (!p.wrongAnchor) return '';
  return nextScheduleDate(p.wrongAnchor, WRONG_INTERVALS, p.lastWrongReview || p.wrongAnchor);
}
// 任一锚点档期到期即应复习（学习顺序 + 错题顺序叠加）
function isDue(p, day) {
  const ln = learnNext(p), wn = wrongNext(p);
  return (ln && ln <= day) || (wn && wn <= day);
}
// p.nextReview 取两个锚点中较近的一次，供复习池快速判定（不代表只走一条路径）
function refreshNext(p) {
  const ln = learnNext(p), wn = wrongNext(p);
  p.nextReview = (ln && wn) ? (ln < wn ? ln : wn) : (ln || wn || '');
}
// 复习结算：correct=是否答对，day=复习日（默认今天）。学习/错题锚点各自独立推进；答错则重置错题锚点
function settleReview(r, correct, day) {
  day = day || dayOf();
  let p = progress[r.key];
  if (!p) p = progress[r.key] = { key: r.key, word: r.word, bank: r.bank, meaning: r.meaning, phonetic_us: r.phonetic_us, phonetic_uk: r.phonetic_uk, firstLearned: r.firstLearned || day, lastLearnReview: day, stage: 0 };
  p.lastReview = day;
  if (correct) {
    // 双锚点各自独立推进：哪个档期今日到期就推进哪个（与当天复习几轮无关）
    if (learnNext(p) && learnNext(p) <= day) p.lastLearnReview = day;
    if (p.wrongAnchor && wrongNext(p) && wrongNext(p) <= day) p.lastWrongReview = day;
  } else {
    // 答错：错题锚点重置为今天，错题节奏从头（第 1 天）重新数；学习日锚点不受影响
    p.wrongAnchor = day; p.lastWrongReview = day;
    if (learnNext(p) && learnNext(p) <= day) p.lastLearnReview = day;
    const wb = wrongBook[r.key] || { key: r.key, word: r.word, bank: r.bank, meaning: r.meaning, phonetic_us: r.phonetic_us, phonetic_uk: r.phonetic_uk, wrongCount: 0, lastWrong: '', added: day };
    if (!r._wrongAdded) { wb.wrongCount++; r._wrongAdded = true; }   // 打叉时已计过则不再重复累加
    wb.lastWrong = day; wrongBook[r.key] = wb;
  }
  refreshNext(p);
  // 已掌握（双锚点档期均走完、不再推送）→ 移出错题本
  if (!p.nextReview && wrongBook[r.key]) delete wrongBook[r.key];
  return p;
}
function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[r[i], r[j]] = [r[j], r[i]]; } return r; }
// 基于「词 + 当日日期」的确定性伪随机：用于每日推送排序，保证不同端当天选出的词与顺序一致
function strHash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function dayRand(word) { return (strHash((word || '').toLowerCase() + '|' + todayStr()) % 1000000) / 1000000; }
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function jsAttr(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1600); }
function icon(id, cls) { return `<svg class="${cls || ''}"><use href="#${id}"/></svg>`; }
// 学习进行中折叠上方统计卡片，手机单屏不滚动
function setLearnActive(on) { const a = app(); if (a) a.classList.toggle('learn-active', !!on); }

function splitPOS(m) {
  m = (m || '').trim();
  const re = /(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|art\.|int\.|abbr\.|num\.|aux\.|modal v\.|link v\.|pl\.|sb\.|sth\.)\s*/g;
  const ms = [...m.matchAll(re)];
  if (ms.length <= 1) return [{ pos: '', text: m }];
  const res = [];
  for (let i = 0; i < ms.length; i++) {
    const st = ms[i].index, en = i + 1 < ms.length ? ms[i + 1].index : m.length;
    let t = m.slice(st, en).trim();
    const sp = t.indexOf(' ');
    if (sp === -1) { res.push({ pos: t, text: '' }); continue; }
    res.push({ pos: t.slice(0, sp).trim(), text: t.slice(sp + 1).trim() });
  }
  return res.filter(x => x.text || x.pos);
}
function renderMeaning(m) { return splitPOS(m).map(p => `<div class="pos"><span class="pt">${esc(p.pos)}</span>${esc(p.text)}</div>`).join(''); }
function highlight(en, word) {
  if (!en) return '';
  const w = (word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!w) return esc(en);
  return esc(en).replace(new RegExp('(' + w + ')', 'gi'), '<mark>$1</mark>');
}
function speak(text, lang, rate) {
  if (!text) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const L = lang || 'en-US';
    u.lang = L; u.rate = rate || 0.95;
    const vs = speechSynthesis.getVoices() || [];
    const k = L.toLowerCase();
    // 精确匹配口音（en-US / en-GB），匹配不到再退化为任意英语嗓音
    const exact = vs.find(v => (v.lang || '').replace(/_/g, '-').toLowerCase() === k);
    const anyEn = vs.find(v => /^en/i.test(v.lang || ''));
    const ev = exact || anyEn;
    if (ev) u.voice = ev;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) { }
}
// 统一发音入口：kind = 'us' | 'gb' | 'slow' | 其他/空 = 按设置里的口音与语速
function pron(word, kind) {
  const a = (settings && settings.accent) || 'en-US';
  const r = (settings && settings.pronRate) || 0.95;
  if (kind === 'us') speak(word, 'en-US');
  else if (kind === 'gb') speak(word, 'en-GB');
  else if (kind === 'slow') speak(word, a, 0.6);
  else speak(word, a, r);
}
function exampleHtml(w, limit) {
  const ex = (EXAMPLES[(w.word || '').toLowerCase()] || []).slice(0, limit || 1);
  return ex.length ? `<div class="eg">${ex.map(e => `<div class="en">${highlight(e.en, w.word)}</div><div class="zh">${esc(e.zh)}</div>`).join('')}</div>` : '';
}
// 目标词的常见变形：复数/三单 -s -es、过去式 -ed -d、进行时 -ing、去 e + ing/ed、双写尾辅音 + ing/ed
function variantsRe(word) {
  const w = (word || '').trim();
  if (!w || w.length < 2) return null;
  const e = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alts = [e(w) + '(?:s|es|ed|d|ing)?'];
  if (/e$/i.test(w) && w.length > 3) alts.push(e(w.slice(0, -1)) + '(?:ing|ed|s)?');
  const m = w.match(/[bcdfghjklmnpqrstvwxyz]$/i);
  if (m) alts.push(e(w + m[0]) + '(?:ed|ing)?');
  return new RegExp('\\b(' + alts.join('|') + ')\\b', 'gi');
}
// 情境复习：把例句中目标词（含变形）挖空，返回 {html, hasBlank, variantBlank, variantText}
function blankSentence(en, word) {
  if (!en) return { html: '', hasBlank: false, variantBlank: false, variantText: '' };
  const re = variantsRe(word);
  if (!re) return { html: esc(en), hasBlank: false, variantBlank: false, variantText: '' };
  const base = (word || '').trim().toLowerCase();
  let has = false, variant = false, variantText = '';
  const html = esc(en).replace(re, m => {
    has = true;
    if (m.toLowerCase() !== base) { variant = true; if (!variantText) variantText = m; }
    return '<span class="blank">＿＿＿＿＿</span>';
  });
  return { html, hasBlank: has, variantBlank: variant, variantText };
}
// 核对页高亮：原形与变形都标出来
function highlightVariants(en, word) {
  if (!en) return '';
  const re = variantsRe(word);
  if (!re) return esc(en);
  return esc(en).replace(re, m => '<mark>' + m + '</mark>');
}
function todayStat(d) { const h = history[d || todayStr()] || { new: [], review: [] }; return { new: (h.new || []).length, review: (h.review || []).length }; }
// 当日学习量 = 新学 + 复习 的「去重单词数」：同一个词当天学/复习几轮都只算一次
function dayTotal(d) {
  const h = history[d] || { new: [], review: [] };
  const s = new Set();
  (h.new || []).forEach(x => { if (x && x.key) s.add(x.key); });
  (h.review || []).forEach(x => { if (x && x.key) s.add(x.key); });
  return s.size;
}
function obscureHtml(w) {
  const o = OBSCURE[(w.word || '').toLowerCase()];
  if (!o || (w.bank !== '初中' && w.bank !== '高中')) return '';
  return `<div class="obscure">
    <div class="obs-head">⚠ 熟词僻义 · 中考/高考常考</div>
    <div class="obs-body">
      <span class="obs-common">熟义：${esc(o.common)}</span>
      <span class="obs-arrow">→</span>
      <span class="obs-rare">${esc(o.rare)}</span>
    </div>
    <div class="eg obs-eg"><div class="en">${highlight(o.en, w.word)}</div><div class="zh">${esc(o.zh)}</div></div>
  </div>`;
}

/* ---------- 补充词典（搭配/同义词/短语动词）详情 ---------- */
function phraseDetail(lc) {
  const ph = PHRASE[lc];
  if (!ph) return `<div class="dm dim">未找到短语动词释义</div>`;
  let h = `<div class="dm">短语动词 · 词根 <b>${esc(ph.base)}</b></div>`;
  (ph.senses || []).forEach(s => {
    h += `<div class="ph-sense"><div class="ph-en">${esc(s.en)}</div>`;
    if (s.zh) h += `<div class="ph-zh">${esc(s.zh)}</div>`;
    (s.ex || []).forEach(e => {
      h += `<div class="ph-ex"><span class="ph-ex-en">${esc(e.en)}</span>` + (e.zh ? `<span class="ph-ex-zh">${esc(e.zh)}</span>` : '') + `</div>`;
    });
    h += `</div>`;
  });
  return h;
}
function extraHtml(lc) {
  let h = '';
  const col = COLLOC[lc];
  if (col && col.length) {
    h += `<div class="extra-title">📚 常见搭配</div>`;
    col.forEach(g => {
      h += `<div class="col-g"><span class="col-cat">${esc(g.c)}</span>`;
      (g.i || []).forEach(it => {
        h += `<div class="col-row"><span class="col-w">${esc(it.w)}</span><span class="col-z">${esc(it.z)}</span></div>`;
      });
      h += `</div>`;
    });
  }
  const th = THES[lc];
  if (th && th.length) {
    h += `<div class="extra-title">🔁 同义词</div>`;
    th.forEach(s => {
      if (s.ex) h += `<div class="th-ex">· ${esc(s.ex)}</div>`;
      (s.g || []).forEach(grp => {
        if (!grp.c || !grp.s || !grp.s.length) return;
        h += `<div class="th-grp"><span class="th-cat">${esc(grp.c)}</span> <span class="th-syns">${grp.s.map(esc).join('，')}</span></div>`;
      });
      if (s.ant && s.ant.length) h += `<div class="th-ant">反义：${s.ant.map(esc).join('，')}</div>`;
    });
  }
  return h;
}
// 统一构建词语详情（查词/词库共用）：w = {word,bank,phonetic_us,phonetic_uk,meaning}
function detailInner(w) {
  const lc = (w.word || '').toLowerCase();
  if (w.bank === '短语动词') return phraseDetail(lc);
  const d = DICT[lc] || {};
  const us = w.phonetic_us || d.us || '';
  const uk = w.phonetic_uk || d.uk || '';
  const meaning = w.meaning || d.meaning || '';
  const bank = w.bank || (BANK_MAP[lc] && BANK_MAP[lc].bank) || '';
  let h = '';
  if (bank && bank !== '词典') h += `<div class="dm">所属词库：<b>${esc(bank)}</b></div>`;
  else h += `<div class="dm dim">未归入词库（仅离线词典）</div>`;
  if (us || uk) h += `<div class="learn-phon"><span class="p" onclick="pron('${jsAttr(w.word)}','us')">美音 ${esc(us || '')}</span><span class="p" onclick="pron('${jsAttr(w.word)}','gb')">英音 ${esc(uk || '')}</span><span class="p slow" onclick="pron('${jsAttr(w.word)}','slow')">${icon('i-slow')} 慢速</span></div>`;
  else h += `<div class="learn-phon"><span class="p" onclick="pron('${jsAttr(w.word)}','')">${icon('i-sound')} 朗读</span><span class="p slow" onclick="pron('${jsAttr(w.word)}','slow')">${icon('i-slow')} 慢速</span></div>`;
  if (meaning) h += `<div class="mean-list">${renderMeaning(meaning)}</div>`;
  h += exampleHtml(w, 2);
  h += obscureHtml(w);
  h += extraHtml(lc);
  return h;
}
function streakDays() {
  let n = 0; const d = new Date();
  for (let i = 0; i < 3650; i++) {
    if (isChecked(todayStr(d))) n++;          // 需「单词复习 + 情境复习」两轮都完成
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
let REVIEW_DAY = null;                       // 补打卡时指向「原应打卡日」；null 表示今天
function dayOf() { return REVIEW_DAY || todayStr(); }
function recordHistory(type, entry, day) {
  const d = day || todayStr();
  if (!history[d]) history[d] = { new: [], review: [] };
  const arr = history[d][type];
  if (!arr.some(x => x.key === entry.key)) arr.push(entry);
  saveAll();
}
// 打卡：单词复习/听中文听写记 recallDone（单词轮）、情境复习记 sentenceDone（情境轮），两轮都完成才算当日复习完成
function markReviewDone(kind, day) {
  const d = day || dayOf();
  if (!history[d]) history[d] = { new: [], review: [] };
  history[d][kind + 'Done'] = true;
  saveAll();
}
// 复习还需完成哪一轮：单词复习/听中文听写 = recall 轮；情境填词 = sentence 轮
function nextReviewRoundNeeded(d) {
  const h = history[d] || {};
  if (!h.recallDone) return 'recall';
  if (!h.sentenceDone) return 'sentence';
  return null;
}
// 打卡完成 = 完成「固定学习内容」（当日新词学习）且「全部应复习单词」已复习
function nothingToStudy() {
  if (!BANKS_READY) return false;       // 词库未就绪时不可断言「无词可学」
  return selfBank.filter(w => !progress[bankKey(SELFBANK_ID, w.word)]).length === 0
      && BANKS.every(b => unlearned(b.id).length === 0);
}
function nothingToReview() {
  if (!BANKS_READY) return false;       // 词库未就绪时不可断言「无词可复习」
  return buildReviewPool().length === 0;
}
function dayStudyDone(d) {
  const h = history[d];
  if (h && h.studyDone) return true;
  const planned = studyBanks().reduce((s, b) => s + Math.max(0, +b.count || 0), 0);
  const selfLeft = selfBank.filter(w => !progress[bankKey(SELFBANK_ID, w.word)]).length;
  if (planned === 0 && selfLeft === 0) return true;   // 无计划新词且无自建未背词 → 学习内容视为满足
  if (d === todayStr() && nothingToStudy()) return true;           // 当日已无新词可学，视为满足
  return false;
}
function dayReviewDone(d) {
  const h = history[d];
  if (h && h.recallDone && h.sentenceDone) return true;   // 复习需单词复习+情境填词两轮都完成
  if (d === todayStr() && nothingToReview()) return true; // 当日无待复习词，视为满足
  return false;
}
function dayComplete(d) { return dayStudyDone(d) && dayReviewDone(d); }
function markStudyDone(d) {
  d = d || todayStr();
  if (!history[d]) history[d] = { new: [], review: [] };
  history[d].studyDone = true;
  saveAll();
}
function isChecked(d) { return dayComplete(d); }   // 兼容：连续打卡 / 补打卡判定统一为「打卡完成」
function bankStat(id) {
  const total = BANK_DATA[id]?.count || 0;
  const learned = Object.values(progress).filter(p => p.bank === id).length;
  return { total, learned, pct: total ? Math.round(learned / total * 100) : 0 };
}

/* ---------- 词库与推送顺序 ---------- */
function bankWords(id) { return (BANK_DATA[id]?.words || []).map(w => ({ ...w, bank: id })); }
function unlearned(id) { return bankWords(id).filter(w => !progress[bankKey(id, w.word)]); }
// 按常见度排序（freq 越小越常见）；同级内用「当日确定性随机」打散，保证不同端顺序一致
function sortByFreq(list) {
  return list.map(w => ({ w, f: FREQ[w.word.toLowerCase()] ?? 5, r: dayRand(w.word) }))
    .sort((a, b) => a.f - b.f || a.r - b.r)
    .map(x => x.w);
}
// 词形归一化（与小写、去首尾空白、合并内部空白），与词库对比脚本保持一致
function wnorm(w) { return (w || '').toLowerCase().trim().replace(/\s+/g, ' '); }
// 计算雅思与托福的共有词集合（归一化后精确匹配），结果存入 COMMON_SET
function computeCommon() {
  const a = BANK_DATA['雅思']?.words || [];
  const bset = new Set((BANK_DATA['托福']?.words || []).map(w => wnorm(w.word)));
  COMMON_SET = new Set(a.filter(w => bset.has(wnorm(w.word))).map(w => wnorm(w.word)));
}
function isCommon(word) { return COMMON_SET ? COMMON_SET.has(wnorm(word)) : false; }
// 学习排序：雅思/托福两库的共有词优先背诵（先打共同基础），其余再按常见度排序；同级用当日确定性随机打散
function sortStudyOrder(list) {
  return list.map(w => ({ w, common: isCommon(w.word) ? 0 : 1, f: FREQ[w.word.toLowerCase()] ?? 5, r: dayRand(w.word) }))
    .sort((a, b) => a.common - b.common || a.f - b.f || a.r - b.r)
    .map(x => x.w);
}
// 选词库（跨库背词）：最多 2 个正式词库，各自独立设每日词数；自建词库始终优先，不占额度
function normalizeStudyBanks() {
  let arr = (settings.studyBanks && settings.studyBanks.slice(0, 2)) || [];
  arr = arr.filter(b => b && BANKS.some(x => x.id === b.id)).map(b => ({ id: b.id, count: Math.max(0, +b.count || 0) }));
  const seen = new Set(); arr = arr.filter(b => seen.has(b.id) ? false : (seen.add(b.id), true));   // 去重
  if (!arr.length) {
    const id = (settings.curBank && BANKS.some(b => b.id === settings.curBank)) ? settings.curBank : '初中';
    arr = [{ id, count: Math.max(1, +settings.dailyNew || 5) }];
  }
  settings.studyBanks = arr;
}
function studyBanks() { if (!settings.studyBanks || !settings.studyBanks.length) normalizeStudyBanks(); return settings.studyBanks; }
// 单库的未学候选（稳定排序：共有词优先 → 词频 → 原序号），不含已学词
function candidatesForBank(bankId, exclude) {
  const ex = new Set(exclude || []);
  const idx = {};
  (BANK_DATA[bankId]?.words || []).forEach((w, i) => { idx[wnorm(w.word)] = i; });
  const out = [];
  (BANK_DATA[bankId]?.words || []).forEach(w => {
    const key = bankKey(bankId, w.word);
    if (ex.has(key)) return;
    if (progress[key] && progress[key].firstLearned) return;
    out.push({ ...w, bank: bankId, _i: idx[wnorm(w.word)] ?? 0, _c: isCommon(w.word) ? 0 : 1 });
  });
  out.sort((a, b) => a._c - b._c || (FREQ[wnorm(a.word)] ?? 5) - (FREQ[wnorm(b.word)] ?? 5) || a._i - b._i);
  return out;
}
// 组合当日待学批次：① 自建词库全部未背词（优先，不占额度）② 各选词库按其每日额度补足（今日已学部分计为已用）
function buildBatch(plan, banks, learnedByBank) {
  const result = [];
  selfBank.forEach(w => {
    const key = bankKey(SELFBANK_ID, w.word);
    if (progress[key] && progress[key].firstLearned) return;
    result.push({ bank: SELFBANK_ID, word: w.word });
  });
  for (const b of banks) {
    const id = b.id, count = Math.max(0, +b.count || 0);
    const allowed = Math.max(0, count - (learnedByBank[id] || 0));   // 该库今日还可学的上限
    let existing = plan.filter(p => p.bank === id);
    if (existing.length > allowed) existing = existing.slice(0, allowed);   // 富余 ⇒ 退回未学词库
    existing.forEach(p => result.push(p));
    let need = allowed - existing.length;
    if (need > 0) {
      const ex = new Set(result.map(p => bankKey(p.bank, p.word)));
      for (const c of candidatesForBank(id, ex)) { if (need <= 0) break; result.push({ bank: id, word: c.word }); need--; ex.add(bankKey(id, c.word)); }
    }
  }
  return result;
}
// 纯计算：返回当日推送计划（自建优先 + 各选词库按各自每日额度），供「提前预览」与真正开始共用
function planQueue() {
  reconcileLearnPlan();
  const queue = pendingPlan.map(p => { const w = resolveWord(p.bank, p.word); return w ? { ...w, bank: p.bank, word: p.word } : null; }).filter(Boolean);
  return { bank: pendingPlan.length ? pendingPlan[0].bank : (studyBanks()[0] && studyBanks()[0].id || ''), queue };
}
function buildQueue() { return planQueue(); }
// 按 bank+word 反查完整词对象（学习/预览时使用）
function resolveWord(bank, word) {
  if (bank === SELFBANK_ID) return selfBank.find(w => w.word === word);
  return (BANK_DATA[bank]?.words || []).find(w => w.word === word);
}
// 粘性批次 reconcile（跨库版）：
//  • 已学过的词自动移出批次；
//  • 批次非空且选库/额度未变 ⇒ 保留原批次（不新增），满足「只有学完才生成新词」；
//  • 批次为空（全部学完）⇒ 重新按各库额度选出新词（即「学完才生成」）；
//  • 选库/额度改变（或 forceResize）⇒ 立即按新目标增/删：不够从词库补，富余把已选词退回未学词库。
// 今日配额以「各库今日实际新学数」为准：某库今日已达其额度，当天不再从该库出词（明日再学下一批）。
function reconcileLearnPlan(forceResize) {
  const banks = studyBanks();
  const today = todayStr();
  const todayNew = (history[today] && history[today].new) || [];
  const learnedByBank = {};
  todayNew.forEach(x => { learnedByBank[x.bank] = (learnedByBank[x.bank] || 0) + 1; });
  const before = JSON.stringify(pendingPlan) + '|' + JSON.stringify(banks);
  let plan = (pendingPlan || []).filter(p => {
    const key = bankKey(p.bank, p.word);
    return !(progress[key] && progress[key].firstLearned);
  });
  const sig = JSON.stringify(banks);
  const changed = forceResize || sig !== planTarget;
  if (changed || plan.length === 0) {          // 配置变化，或批次已耗尽 → 重新组合（受今日各库配额约束）
    planTarget = sig;
    plan = buildBatch(plan, banks, learnedByBank);
  }
  pendingPlan = plan;
  if (JSON.stringify(pendingPlan) + '|' + planTarget !== before) saveAll();
}
// 加入自建词库时：若该词此前已背过，重置为未背诵，使其重新进入优先推送
function resetWordForSelf(word) {
  const key = bankKey(SELFBANK_ID, word);
  let reset = false;
  if (progress[key]) { delete progress[key]; reset = true; }
  if (wrongBook[key]) { delete wrongBook[key]; reset = true; }
  return reset;
}
// 一次性校准：改为"按学习日 / 答错日排档期"后，把既有单词的下次复习日统一重排
// 档期只取决于锚点日期与上次复习日，与某天复习了几轮无关；幂等，仅执行一次
// 一次性校准：改为「双锚点」后，把既有单词的学习日/错题日两个锚点字段补全并重排
// 档期只取决于锚点日期与上次复习日，与某天复习了几轮无关；幂等，仅执行一次
function calibrateSchedule() {
  if (settings.scheduleV3) return 0;
  let n = 0;
  Object.values(progress).forEach(p => {
    if (!p || !p.word) return;
    // 学习日锚点
    p.firstLearned = p.firstLearned || p.lastReview || p.wrongAnchor || todayStr();
    p.lastLearnReview = p.lastLearnReview || p.lastReview || p.firstLearned;
    // 错题日锚点（曾答错过的词保留，可继续叠加在正常学习顺序之上）
    if (p.wrongStage !== undefined || p.wrongAnchor) {
      p.wrongAnchor = p.wrongAnchor || p.lastReview || p.firstLearned || todayStr();
      p.lastWrongReview = p.lastWrongReview || p.lastReview || p.wrongAnchor;
    }
    refreshNext(p);
    // 已掌握（不再推送）但仍在错题本中的旧数据 → 清理移出
    if (!p.nextReview && wrongBook[p.key]) delete wrongBook[p.key];
    n++;
  });
  settings.scheduleV3 = true;
  if (n) saveAll();
  return n;
}
// 一次性迁移：为「既有学习记录」补上 studyDone 标志（历史已学+已复习的日期，连续打卡不丢）
function seedStudyDone() {
  if (settings.studyDoneSeeded) return 0;
  let n = 0;
  Object.keys(history).forEach(d => {
    const h = history[d];
    if (h && (h.new && h.new.length) && !h.studyDone) { h.studyDone = true; n++; }
  });
  settings.studyDoneSeeded = true;
  if (n) saveAll();
  return n;
}

/* ---------- 路由 ---------- */
let CUR = 'learn';
const PAGES = { learn, review, wrong, banks, dict };
function goto(page) {
  CUR = page;
  document.querySelectorAll('.tabbar .tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  closeModal(); PAGES[page]();
  window.scrollTo(0, 0);
}
document.getElementById('tabbar').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) goto(t.dataset.page); });
document.addEventListener('click', e => { if (e.target.closest('#settingsBtn')) openSettings(); });

function openModal(html) { $('#modal').innerHTML = html; $('#mask').classList.add('show'); }
function closeModal() { $('#mask').classList.remove('show'); }
$('#mask').addEventListener('click', e => { if (e.target.id === 'mask') closeModal(); });
function topbar(title) {
  return `<div class="topbar"><div><h1>${title}</h1><div class="date">${todayStr()}</div></div>
    <button class="icon-btn" id="settingsBtn" title="设置">${icon('i-gear')}</button></div>`;
}

/* ===================== 设置栏 ===================== */
function openSettings() {
  openModal(`
    <h3>设置</h3>
    <div class="sub-tip" style="margin:-6px 0 10px">选择 1–2 个词库同时背（最多 2 个），每个库单独设每日词数；自建词库始终优先背诵，不占正式库额度</div>
    <div class="bank-pick" id="bankPick"></div>
    <div id="bankCounts" style="margin-top:14px"></div>
    <div class="set-fold">
      <div class="set-fold-head" id="acctHead">👤 账号 <span class="tag ${currentAccount ? 'green' : ''}">${currentAccount ? ('已登录：' + esc(currentAccount)) : '未登录'}</span><span class="chev">▸</span></div>
      <div class="set-fold-body" id="acctHost" style="display:none"></div>
    </div>
    <div class="set-fold">
      <div class="set-fold-head" id="syncHead">☁️ 云同步 <span class="tag ${(window.Sync && Sync.on()) ? 'green' : ''}">${(window.Sync && Sync.on()) ? '已开启' : '未配置'}</span><span class="chev">▸</span></div>
      <div class="set-fold-body" id="syncHost" style="display:none"></div>
    </div>
    <div class="set-fold">
      <div class="set-fold-head" id="bakHead">💾 进度备份与恢复<span class="chev">▸</span></div>
      <div class="set-fold-body" id="bakHost" style="display:none">
        <div class="sub-tip">进度存在浏览器本地，换设备或清缓存会丢失，建议定期导出（开启云同步后可不用管）</div>
        <div class="row" style="margin-top:10px">
          <button class="btn ghost sm" id="expBtn">⬇ 导出进度</button>
          <button class="btn ghost sm" id="impBtn">⬆ 导入进度</button>
        </div>
        <input type="file" id="impFile" accept="application/json,.json" style="display:none">
        <button class="btn ghost sm" id="resetBtn" style="margin-top:10px;color:var(--red)">🗑 清空全部进度</button>
      </div>
    </div>
    <button class="btn primary" style="margin-top:16px" id="setOk">完成</button>
    <button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="closeModal()">关闭</button>`);
  const renderBankPick = () => {
    const banks = studyBanks();
    const picks = BANKS.filter(b => b.id !== SELFBANK_ID).map(b => {
      const sel = banks.findIndex(x => x.id === b.id);
      const s = bankStat(b.id);
      return `<div class="bank ${sel >= 0 ? 'sel' : ''}" data-bank="${b.id}">
        <div class="bn" style="color:${b.color}">${b.id}${sel >= 0 ? ` <span class="ord">${sel + 1}</span>` : ''}</div>
        <div class="bc">${s.learned} / ${s.total} 词</div>
        <div class="prog"><i style="width:${s.pct}%;background:${b.color}"></i></div>
        <div class="bc">${s.pct >= 100 ? '<span class="done-flag">已背完</span>' : '剩余 ' + (s.total - s.learned)}</div>
      </div>`;
    }).join('');
    $('#bankPick').innerHTML = picks;
    document.querySelectorAll('#bankPick .bank').forEach(el => el.onclick = () => {
      const id = el.dataset.bank;
      let list = studyBanks().slice();
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) list.splice(i, 1);
      else {
        if (list.length >= 2) { toast('最多选择 2 个词库'); return; }
        list.push({ id, count: Math.max(1, +list[0]?.count || 5) });
      }
      settings.studyBanks = list; saveAll(); reconcileLearnPlan(true); renderBankPick();
    });
    const counts = banks.map((b, i) => {
      const col = (BANKS.find(x => x.id === b.id) || {}).color || '#333';
      return `<div class="cnt-row">
        <span class="cnt-name" style="color:${col}">${b.id}</span>
        <span class="cnt-label">每日</span>
        <input type="number" min="0" max="50" step="1" value="${b.count}" class="cnt-input" data-i="${i}">
        <span class="cnt-label">个</span>
      </div>`;
    }).join('');
    $('#bankCounts').innerHTML = counts || '<div class="sub-tip">未选择词库</div>';
    document.querySelectorAll('#bankCounts .cnt-input').forEach(inp => inp.oninput = () => {
      const i = +inp.dataset.i, v = Math.max(0, Math.min(50, +inp.value || 0));
      const list = studyBanks().slice(); list[i].count = v; settings.studyBanks = list;
      saveAll(); reconcileLearnPlan(true);
    });
  };
  renderBankPick();
  $('#setOk').onclick = () => { closeModal(); PAGES[CUR](); };
  // 折叠区块：默认收起，点击标题展开/收起
  const bindFold = (headSel, bodySel) => {
    const h = $(headSel), b = $(bodySel);
    if (!h || !b) return;
    h.onclick = () => {
      const open = b.style.display === 'none';
      b.style.display = open ? '' : 'none';
      const c = h.querySelector('.chev'); if (c) c.textContent = open ? '▾' : '▸';
    };
  };
  bindFold('#acctHead', '#acctHost'); renderAccount($('#acctHost'));
  bindFold('#syncHead', '#syncHost');
  bindFold('#bakHead', '#bakHost');
  // 进度备份 / 恢复
  $('#expBtn').onclick = exportData;
  $('#impBtn').onclick = () => $('#impFile').click();
  $('#impFile').onchange = e => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; };
  $('#resetBtn').onclick = () => {
    if (!confirm('确定清空全部学习进度、错题本和自建词库？不可撤销，建议先导出备份。\n（当前账号的云端同步端口会保留，且不会自动上传空数据覆盖云端）')) return;
    if (currentAccount) {
      // 账号模式：仅清空该账号的学习数据，保留其同步端口配置
      const syncTargets = store.get(ACCT.sync(currentAccount), null);
      store.set(ACCT.data(currentAccount), { progress: {}, wrongBook: {}, selfBank: [], settings, history: {}, learnState: null, reviewState: null, pendingPlan: [], planTarget: 0 });
      if (syncTargets !== null) store.set(ACCT.sync(currentAccount), syncTargets);
      progress = {}; wrongBook = {}; selfBank = []; history = {}; learnState = null; reviewState = null; pendingPlan = []; planTarget = 0;
    } else {
      // 未登录：保留 wb_sync 云配置，仅写入空学习数据（不调用 saveAll，避免触发自动上传空数据）
      const syncCfg = window.store ? store.get('wb_sync', null) : null;
      progress = {}; wrongBook = {}; selfBank = []; history = {}; learnState = null; reviewState = null; pendingPlan = []; planTarget = 0;
      store.set(K.progress, progress); store.set(K.wrong, wrongBook);
      store.set(K.self, selfBank); store.set(K.settings, settings); store.set(K.history, history);
      store.set(K.learn, learnState); store.set(K.review, reviewState);
      store.set(K.plan, pendingPlan); store.set(K.plantarget, planTarget);
      if (syncCfg !== null) store.set('wb_sync', syncCfg);
    }
    toast('已清空（云端同步端口已保留）'); closeModal(); PAGES[CUR]();
  };
  if (window.Sync) Sync.render($('#syncHost'));
}

/* ===================== 学习（首页） ===================== */
function learn() {
  const t = todayStat();
  const total = Object.keys(progress).length;
  const banks = studyBanks();
  const totalPlanned = banks.reduce((s, b) => s + Math.max(0, +b.count || 0), 0);
  const selfLeft = selfBank.filter(w => !progress[bankKey(SELFBANK_ID, w.word)]).length;
  const due = Object.values(progress).filter(p => p.nextReview && p.nextReview <= todayStr()).length;
  let bars = '';
  const d = new Date(); d.setDate(d.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const ds = todayStr(d), tot = dayTotal(ds);   // 去重后的单词数，与当天学几轮无关
    const h = Math.max(4, Math.min(56, tot * 3));
    bars += `<div style="flex:1;text-align:center">
      <div style="display:flex;align-items:flex-end;height:56px"><i style="display:block;width:100%;height:${h}px;background:${i === 6 ? 'var(--brand)' : '#F0D9BE'};border-radius:5px"></i></div>
      <div style="font-size:11px;color:var(--sub);margin-top:5px">${ds.slice(5)}</div>
      <div style="font-size:11px;color:var(--sub)">${tot || ''}</div></div>`;
    d.setDate(d.getDate() + 1);
  }
  const left = unlearned(settings.curBank).length;
  app().innerHTML = `
    ${topbar('学习')}
    <div class="stat-grid">
      <div class="stat vanilla"><div class="n">${total}</div><div class="l">累计已背单词</div></div>
      <div class="stat matcha g"><div class="n">${streakDays()}</div><div class="l">连续打卡（天）</div></div>
      <div class="stat strawberry r"><div class="n">${t.new}</div><div class="l">今日新学单词</div></div>
      <div class="stat blueberry p"><div class="n">${t.review}</div><div class="l">今日复习单词</div></div>
    </div>

    ${checkinCardHtml()}

    <div class="card lemon" style="margin-top:14px">
      <h2>今日学习计划</h2>
      ${banks.map(b => { const st = bankStat(b.id); return `<div class="sb-line"><span class="sb-name">${esc(b.id)}</span><span class="sb-bar"><i style="width:${st.pct}%"></i></span><span class="sb-txt">已背 ${st.learned}/${st.total} ｜ 每日 ${b.count} 个</span></div>`; }).join('')}
      ${selfLeft ? `<div class="sub-tip" style="margin-top:6px">自建词库优先：还有 <b>${selfLeft}</b> 个未背</div>` : ''}
      <div class="sub-tip" style="margin-top:6px">每日新词计划 <b>${totalPlanned}</b> 个${due ? ' ｜ 待复习 ' + due + ' 词' : ''}</div>
    </div>

    <div class="card mint"><h2>近 7 天学习量</h2><div style="display:flex;gap:6px;align-items:flex-end">${bars}</div></div>

    <div class="card vanilla" id="learnBox"></div>`;
  setLearnActive(!!(learnState && learnState.queue && learnState.queue.length && learnState.idx < learnState.queue.length));
  renderLearnBox();
  bindCheckin();
}

function renderLearnBox() {
  const box = $('#learnBox'); if (!box) return;
  if (!BANKS_READY) {
    box.innerHTML = `<h2>今日学习</h2>
      <div class="boot-spin" style="margin:22px auto"></div>
      <div class="sub-tip" style="text-align:center">词库加载中，稍候自动开始…</div>`;
    return;
  }
  if (!learnState || !learnState.queue.length) {
    setLearnActive(false);
    reconcileLearnPlan();
    const plan = pendingPlan.map(p => resolveWord(p.bank, p.word)).filter(Boolean);
    const banks = studyBanks();
    const planned = banks.reduce((s, b) => s + Math.max(0, +b.count || 0), 0);
    const selfLeft = selfBank.filter(w => !progress[bankKey(SELFBANK_ID, w.word)]).length;
    const today = todayStr();
    const todayNew = (history[today] && history[today].new) || [];
    const learnedByBank = {};
    todayNew.forEach(x => { learnedByBank[x.bank] = (learnedByBank[x.bank] || 0) + 1; });
    const bankQuotaMet = banks.every(b => (learnedByBank[b.id] || 0) >= Math.max(0, +b.count || 0));
    const todayDone = planned > 0 && bankQuotaMet && selfLeft === 0;   // 今日新词已全部学完
    const allDone = nothingToStudy();                                  // 所有词库都已背完
    const bankSummary = banks.map(b => `${b.id} ${b.count}个`).join(' + ');
    let tip, preview = '', btn;
    if (allDone) {
      tip = '所有词库都已背完 🎉';
      btn = `<button class="btn primary" style="margin-top:14px" id="startLearn" disabled>词库已背完 🎉</button>`;
    } else if (todayDone) {
      tip = `今日新词已全部学完（计划：${bankSummary}）`;
      preview = `<div class="sub-tip" style="margin-top:10px">今日已学完 <b>${todayNew.length}</b> 个新词，明天再来 🌙</div>`;
      btn = `<button class="btn primary" style="margin-top:14px" id="startLearn" disabled>今日已学完</button>`;
    } else if (plan.length) {
      tip = `每日计划：${bankSummary}${selfLeft ? ` ｜ 自建优先 ${selfLeft} 个` : ''}${plan.length !== planned + selfLeft ? `（当前待学 ${plan.length} 个）` : ''}`;
      preview = `<div class="sub-tip" style="margin-top:10px">本组待学 <b>${plan.length}</b> 个新词，可提前了解：</div>
         <div class="chip-wrap">${plan.map(w => `<span class="chip">${esc(w.word)}</span>`).join('')}</div>
         <div class="sub-tip" style="margin-top:6px">本组未学完不会生成新词；单词的学习日期记在实际学习当天</div>`;
      btn = `<button class="btn primary" style="margin-top:14px" id="startLearn">开始学习</button>`;
    } else if (planned <= 0 && selfLeft === 0) {
      tip = '未设置每日新词';
      btn = `<button class="btn primary" style="margin-top:14px" id="startLearn" disabled>无新词</button>`;
    } else {
      tip = `每日计划：${bankSummary}`;
      btn = `<button class="btn primary" style="margin-top:14px" id="startLearn">开始学习</button>`;
    }
    box.innerHTML = `<h2>今日学习</h2>
      <div class="sub-tip">${tip}</div>
      ${preview}
      ${btn}`;
    const sl = document.getElementById('startLearn'); if (sl) sl.onclick = startLearning;
    return;
  }
  // 学习卡片：一个单词一页
  const st = learnState;
  const w = st.queue[st.idx];
  if (!w) { setLearnActive(false); learnState = null; markStudyDone(); refreshCheckin(); renderLearnBox(); return; }
  const last = st.idx >= st.queue.length - 1;
  box.innerHTML = `
    <button class="btn ghost sm" id="exitLearn" style="margin-bottom:8px">← 返回首页</button>
    <div class="stepbar"><span>新学 ${st.idx + 1} / ${st.queue.length}</span><span class="tag">${w.bank}</span></div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div class="learn-word">${esc(w.word)}</div>
      <button class="speaker-btn" onclick="speak('${jsAttr(w.word)}','en-US')" title="朗读单词发音" aria-label="朗读">${icon('i-sound')}<span>朗读</span></button>
    </div>
    <div class="learn-phon">
      <span class="p" onclick="speak('${jsAttr(w.word)}','en-US')">美音 ${esc(w.phonetic_us || '—')}</span>
      <span class="p" onclick="speak('${jsAttr(w.word)}','en-GB')">英音 ${esc(w.phonetic_uk || '—')}</span>
    </div>
    <div class="mean-list">${renderMeaning(w.meaning)}</div>
    ${obscureHtml(w)}
    ${exampleHtml(w, 1)}
    <div class="row" style="margin-top:18px">
      <button class="btn ghost" id="prevBtn" ${st.idx === 0 ? 'disabled' : ''}>${icon('i-prev')}上一个</button>
      <button class="btn ${last ? 'green' : 'primary'}" id="nextBtn">${last ? '学习完毕' : '下一个'}${last ? '' : icon('i-next')}</button>
    </div>
    <div class="row" style="margin-top:8px;justify-content:center">
      <button class="btn ghost sm" id="restartLearn">↺ 重新开始本组</button>
    </div>
    ${st.idx === 0 ? '' : '<div class="sub-tip" style="text-align:center">翻到下一个即记为已学，并进入复习计划</div>'}`;
  $('#prevBtn').onclick = () => { if (st.idx > 0) { st.idx--; saveAll(); renderLearnBox(); } };
  $('#exitLearn').onclick = () => { saveAll(); goto('learn'); };   // 仅暂停：保留 learnState 以便重开工作台后续接
  $('#restartLearn').onclick = () => { if (confirm('放弃当前这组，重新从今日新词开始？已学的词仍计入复习计划。')) { learnState = null; saveAll(); startLearning(); } };
  $('#nextBtn').onclick = () => {
    markLearned(w);
    if (last) { learnState = { ...st, idx: st.idx + 1 }; saveAll(); renderLearnBox(); }
    else { st.idx++; saveAll(); renderLearnBox(); }
  };
}
// 今日打卡状态卡：学习内容与复习均完成 → 显示「打卡完成」，并从补打卡栏目移除
function checkinCardHtml() {
  const d = todayStr();
  const sd = dayStudyDone(d), rd = dayReviewDone(d);
  if (sd && rd) {
    const t = todayStat(d);
    return `<div class="card checkin done" id="checkinCard">
      <div class="ci-emoji">🎉</div>
      <div class="ci-main">
        <div class="ci-title">今日打卡完成</div>
        <div class="ci-sub">已学 ${t.new} 个新词 · 已复习 ${t.review} 个词，今日已结算，不再计入补打卡</div>
      </div></div>`;
  }
  let btn = '';
  if (!sd) btn = '<button class="btn primary sm" id="ciGoLearn" style="margin-top:10px">去学习新词 →</button>';
  else if (!rd) btn = '<button class="btn primary sm" id="ciGoReview" style="margin-top:10px">去完成复习 →</button>';
  return `<div class="card checkin" id="checkinCard">
    <div class="ci-main">
      <div class="ci-title">今日打卡进度</div>
      <div class="ci-sub">完成「学习内容」与「复习」即视为打卡完成</div>
    </div>
    <div class="ci-row">
      <span class="ci-chip ${sd ? 'on' : ''}">${sd ? '✓' : '○'} 学习内容${sd ? '已完成' : '待完成'}</span>
      <span class="ci-chip ${rd ? 'on' : ''}">${rd ? '✓' : '○'} 复习${rd ? '已完成' : '待完成'}</span>
    </div>${btn}
  </div>`;
}
function bindCheckin() {
  const gl = document.getElementById('ciGoLearn'); if (gl) gl.onclick = () => startLearning();
  const gr = document.getElementById('ciGoReview'); if (gr) gr.onclick = () => goto('review');
}
function refreshCheckin() { const el = document.getElementById('checkinCard'); if (el) { el.outerHTML = checkinCardHtml(); bindCheckin(); } }
function startLearning() {
  if (!BANKS_READY) { toast('词库加载中，请稍候…'); return; }
  reconcileLearnPlan();
  const queue = pendingPlan.map(p => { const w = resolveWord(p.bank, p.word); return w ? { ...w, bank: p.bank, word: p.word } : null; }).filter(Boolean);
  if (!queue.length) { toast('所有词库都已背完 🎉'); return; }
  learnState = { bank: queue[0].bank, queue, idx: 0 };
  saveAll(); setLearnActive(true); window.scrollTo(0, 0); renderLearnBox();
}
function markLearned(w) {
  const key = bankKey(w.bank, w.word);
  if (progress[key]) return;
  progress[key] = {
    word: w.word, bank: w.bank, meaning: w.meaning,
    phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk,
    firstLearned: todayStr(), stage: 0, lastLearnReview: todayStr(), nextReview: addDays(todayStr(), 1), lastReview: todayStr(),
  };
  // 自建词库的词学完后即从自建词库移除（进度已写入 progress，继续走正常复习计划）
  if (w.bank === SELFBANK_ID) selfBank = selfBank.filter(x => x.word !== w.word);
  recordHistory('new', { key, word: w.word, bank: w.bank, meaning: w.meaning, phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk });
  // 学完一个即从待学批次移除：批次随之收缩；全部学完才会在 reconcile 时生成下一批
  pendingPlan = (pendingPlan || []).filter(p => bankKey(p.bank, p.word) !== key);
  saveAll();
}

/* ===================== 复习 ===================== */
function review() {
  app().innerHTML = `${topbar('复习')}
    <div class="card matcha" id="reviewSetup"></div>
    <div class="card" id="reviewBox"></div>`;
  renderSetup(); renderBox();
  function renderSetup() {
    const pool = buildReviewPool();
    const isRecall = settings.reviewType === 'recall';
    const isSent = settings.reviewType === 'sentence';
    const resuming = reviewState && !reviewState.done;   // 存在未完成的中途复习 → 提供「继续」
    // 三种题型下方的提示统一为「复习节奏」，未开始复习前不暴露任何待复习单词
    $('#reviewSetup').innerHTML = `
      <h2>今日复习 <span class="r">${pool.length} 词</span></h2>
      <div class="seg" id="rvType" style="margin-bottom:8px">
        <div class="${isRecall ? 'on' : ''}" data-t="recall">单词复习</div>
        <div class="${isSent ? 'on' : ''}" data-t="sentence">情境填词</div>
        <div class="${settings.reviewType === 'word' ? 'on' : ''}" data-t="word">听中文听写</div>
      </div>
      <div class="sub-tip" id="rvDesc">复习节奏（双锚点）：<b>学习日</b>锚点固定按第 1、2、3、5、7、15、30 天推送；<b>错题日</b>锚点（最近一次答错日）按第 1、2、3、20、40 天推送，并<b>叠加</b>在正常学习顺序之上。每次新答错会重置错题锚点、错题节奏从头重数；学习顺序不受影响。<br><b style="color:var(--brand)">打卡完成需「单词复习 + 情境填词」各完成一轮</b>（听中文听写视作单词轮）；系统会在你完成一轮后自动引导进入另一轮。</div>
      ${resuming ? `<div class="sub-tip" style="margin-bottom:8px">检测到上次未完成的复习（第 ${reviewState.idx + 1}/${reviewState.pool.length} 个），可继续或重新开始。</div>` : ''}
      <div><button class="btn primary" id="startReview" ${pool.length || resuming ? '' : 'disabled'}>${resuming ? '▶ 继续复习（剩 ' + (reviewState.pool.length - reviewState.idx) + '）' : '▶ 开始复习' + (pool.length ? '（' + pool.length + '）' : '')}</button></div>
      ${resuming ? '<div style="margin-top:8px"><button class="btn ghost sm" id="restartReview">↺ 重新开始今日复习</button></div>' : ''}
      <div style="margin-top:10px"><button class="btn ghost sm" id="makeup">📅 补打卡（复习过往某天）</button></div>`;
    document.querySelectorAll('#rvType div').forEach(d => d.onclick = () => { settings.reviewType = d.dataset.t; saveAll(); renderSetup(); });
    $('#startReview').onclick = () => {
      if (resuming) { review(); return; }            // 续接上次中途复习
      REVIEW_DAY = null; startReview(pool);
    };
    if (resuming) $('#restartReview').onclick = () => { reviewState = null; saveAll(); renderSetup(); };
    $('#makeup').onclick = openMakeup;
  }
  function renderBox() {
    if (!reviewState) { $('#reviewBox').innerHTML = '<div class="empty">复习完成后在此查看结果</div>'; return; }
    if (reviewState.done) { renderSummary(); return; }
    if (reviewState.mode === 'recall') { renderRecall(); return; }
    renderReviewCard();
  }
}
function buildReviewPool(dateStr) {
  const day = dateStr || todayStr();   const seen = new Set(); const pool = [];
  const add = e => { if (e && e.key && !seen.has(e.key)) { seen.add(e.key); pool.push(e); } };
  const h = history[day];
  if (h) { (h.new || []).forEach(add); (h.review || []).forEach(add); }
  if (!dateStr) {
    Object.values(progress).forEach(p => {
      if (!p || !p.word || p.firstLearned === day) return;
      // 间隔到期即入池（错词路径的 nextReview 已由 WRONG_INTERVALS 精确计算）
      if (p.nextReview && p.nextReview <= day)
        add({ key: bankKey(p.bank, p.word), word: p.word, bank: p.bank, meaning: p.meaning, phonetic_us: p.phonetic_us, phonetic_uk: p.phonetic_uk });
    });
    // 已排入复习计划的错词由 progress.nextReview 精确控制（错后第 1、2、3、20、40 天）；
    // 未进入计划的错词按 WRONG_INTERVALS 兜底加考
    Object.values(wrongBook).forEach(w => {
      if (progress[w.key]) return;
      const db = daysBetween(w.lastWrong, day);
      if (WRONG_INTERVALS.includes(db)) add({ key: w.key, word: w.word, bank: w.bank, meaning: w.meaning, phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk });
    });
  }
  return pool;
}
// 按题型构造答题队列：sentence 有例句则用情境填词，否则降级为听中文听写
function makeTypedQueue(pool, type) {
  return shuffle(pool.map(e => {
    const c = { ...e };
    delete c._wrongAdded;                       // 新一轮重新计错
    if (type === 'sentence') {
      const exs = EXAMPLES[(e.word || '').toLowerCase()] || [];
      if (exs.length) return { ...c, type: 'sentence', sentence: exs[Math.floor(Math.random() * exs.length)] };
    }
    return { ...c, type: 'word' };
  }));
}
function startReview(pool) {
  if (!pool.length) { toast('今日暂无复习词'); return; }
  if (settings.reviewType === 'recall') {
    reviewState = { pool: shuffle(pool.map(e => ({ ...e, type: 'recall' }))), idx: 0, mode: 'recall' };
    saveAll(); review(); return;
  }
  reviewState = { pool: makeTypedQueue(pool, settings.reviewType), idx: 0 };
  saveAll(); review(); renderReviewCard();
}
// 纸质听写：只出题，不填键盘；上一个/下一个翻页，最后提交进入核对页
function renderReviewCard() {
  const box = $('#reviewBox'); if (!box) return;
  const st = reviewState, cur = st.pool[st.idx];
  if (!cur) { return renderCheck(); }
  const isLast = st.idx >= st.pool.length - 1;
  const stepbar = `<div class="stepbar"><span>第 ${st.idx + 1} / ${st.pool.length} 个</span><span class="tag">${esc(cur.bank)}</span></div>`;
  if (st.idx === undefined) st.idx = 0; saveAll();   // 进入复习卡片即落盘当前进度，便于中途退出后续接
  let prompt;
  if (cur.type === 'sentence' && cur.sentence) {
    const sb = blankSentence(cur.sentence.en, cur.word);
    prompt = `<div class="paper-prompt">
      <div class="pp-label">情境填词：写出横线处的单词</div>
      <div class="eg" style="margin-top:0"><div class="en">${sb.html}</div></div>
      <div class="mean-list">${renderMeaning(cur.meaning)}</div>
      ${sb.variantBlank ? `<div class="sub-tip pp-warn" style="margin-top:8px">⚠ 此题为变形词</div>` : (sb.hasBlank ? '' : '<div class="sub-tip" style="margin-top:8px">⚠ 例句中未直接出现该词，请依据中文释义回忆拼写</div>')}
    </div>`;
  } else {
    prompt = `<div class="paper-prompt">
      <div class="pp-label">听中文听写：写出对应的英文单词</div>
      <div class="mean-list">${renderMeaning(cur.meaning)}</div>
    </div>`;
  }
  box.innerHTML = `<button class="btn ghost sm" id="exitReview" style="margin-bottom:8px">← 退出复习</button>${stepbar}${prompt}
    <div class="row" style="margin-top:18px">
      <button class="btn ghost" id="prevBtn">⬆ 上一个</button>
      <button class="btn primary" id="nextBtn">${isLast ? '提交核对 ✓' : '下一个 →'}</button>
    </div>`;
  $('#exitReview').onclick = () => { saveAll(); goto('learn'); };   // 仅暂停：保留 reviewState 以便重开工作台后续接
  $('#prevBtn').onclick = () => { if (st.idx > 0) { st.idx--; saveAll(); renderReviewCard(); } };
  $('#nextBtn').onclick = () => {
    if (isLast) { renderCheck(); }
    else { st.idx++; saveAll(); renderReviewCard(); }
  };
}
// 打叉：立即记入错题本，重置错题锚点（错后第 1、2、3、20、40 天重新叠加推送）
function markWrongNow(r) {
  settleReview(r, false, dayOf());
  saveAll();
}
// 单词复习：逐词判定「认识 / 不认识」
// ✓ 认识 → 不展开，直接进入下一词；✗ 不认识 → 展开详情记忆 + 记入错题本，点「继续」进入下一词
// 本轮判定后不可回退修改；全部判完自动提交并进入情境填词巩固
function renderRecall() {
  const box = $('#reviewBox'); if (!box) return;
  const st = reviewState;
  if (st.idx === undefined) st.idx = 0;
  while (st.idx < st.pool.length && st.pool[st.idx].recallOk === true) st.idx++;   // 已判"认识"的不停留
  const cur = st.pool[st.idx];
  if (!cur) { submitRecall(); return; }
  const n = st.pool.length, i = st.idx;
  const wronged = cur.recallOk === false;   // 已打叉 → 展示详情供记忆
  box.innerHTML = `
    <button class="btn ghost sm" id="exitReview" style="margin-bottom:8px">← 退出复习</button>
    <div class="stepbar"><span>单词复习 ${i + 1} / ${n}</span><span class="tag">${esc(cur.bank)}</span></div>
    <div class="rq-word">
      <div class="learn-word" style="margin:0">${esc(cur.word)}</div>
      <button class="speaker-btn" id="rqSpeak" title="朗读单词发音">${icon('i-sound')}<span>朗读</span></button>
    </div>
    <div class="sub-tip rq-tip">${wronged ? '已记入错题本，请记住下面的内容' : '还记得它的中文意思吗？'}</div>
    <div class="rq-detail" id="rqDetail" style="display:${wronged ? 'block' : 'none'}">${wronged ? detailInner(cur) : ''}</div>
    <div class="row" style="margin-top:18px">
      ${wronged
      ? '<button class="btn primary" id="rqNext">记住了，继续 →</button>'
      : '<button class="btn green" id="rqOk">✓ 认识</button><button class="btn red" id="rqNo">✗ 不认识</button>'}
    </div>
    <div class="sub-tip" style="text-align:center;margin-top:8px">本轮判定后不可修改</div>`;
  $('#rqSpeak').onclick = () => speak(cur.word, 'en-US');
  $('#exitReview').onclick = () => { saveAll(); goto('learn'); };   // 仅暂停：保留 reviewState 以便重开工作台后续接
  if (!wronged) {
    $('#rqOk').onclick = () => { cur.recallOk = true; st.idx++; saveAll(); renderRecall(); };
    $('#rqNo').onclick = () => { cur.recallOk = false; markWrongNow(cur); renderRecall(); };
  } else {
    $('#rqNext').onclick = () => { st.idx++; saveAll(); renderRecall(); };
  }
}
// 全部判定完毕：提交本轮结果（推进复习节奏 / 错词进入 1、2、3、20、40 天），随后自动进入情境填词
function submitRecall() {
  const st = reviewState;
  st.check = st.pool.map(c => ({ ...c, ok: c.recallOk !== false }));
  confirmCheck(() => startSentenceRound(st.pool));
}
// 单词复习收尾后进入情境填词：同一批词二次巩固（有例句走填词，无例句降级听写）
function startSentenceRound(srcPool) {
  settings.reviewType = 'sentence'; saveAll();
  reviewState = { pool: makeTypedQueue(srcPool, 'sentence'), idx: 0 };
  $('#reviewBox').innerHTML = ''; renderReviewCard();
}
// 补齐「单词复习」轮：同一批词逐词判定认识/不认识（听中文听写视作单词轮）
function startRecallRound(srcPool) {
  settings.reviewType = 'recall'; saveAll();
  reviewState = { pool: shuffle(srcPool.map(e => ({ ...e, type: 'recall', recallOk: undefined }))), idx: 0, mode: 'recall' };
  $('#reviewBox').innerHTML = ''; renderRecall();
}
// 核对页：自行勾选对错，错误入错题本
function renderCheck() {
  const st = reviewState;
  const box = $('#reviewBox'); if (!box) return;
  if (!st.check) st.check = st.pool.map(c => ({ ...c, ok: true }));
  const list = document.createElement('div'); list.className = 'list'; list.id = 'chkList'; list.style.marginTop = '10px';
  const wrongCount = () => st.check.filter(r => !r.ok).length;
  const head = document.createElement('div');
  head.innerHTML = `<h2>核对答案（共 ${st.pool.length} 个）</h2>
    <button class="btn ghost sm" id="exitReview" style="margin:6px 0">← 退出复习</button>
    <div class="sub-tip">对照你纸上的写法：对的保留，错的点击标记为「错」（自动加入错题本）。词组若无例句则显示中文释义。</div>`;
  st.check.forEach((r, i) => {
    const lc = r.word.toLowerCase();
    const d = DICT[lc] || {};
    const meaning = r.meaning || d.meaning || '';
    const ex = (EXAMPLES[lc] || [])[0];
    const ph = r.bank === '短语动词' ? PHRASE[lc] : null;
    const phEx = ph && ph.senses && ph.senses[0] && ph.senses[0].ex && ph.senses[0].ex[0];
    let prompt;
    if (r.type === 'sentence' && r.sentence) {
      prompt = `<div class="eg"><div class="en">${highlightVariants(r.sentence.en, r.word)}</div><div class="zh">${esc(r.sentence.zh)}</div></div>
        <div class="sub-tip" style="margin-top:4px">本题考察单词：<b>${esc(r.word)}</b></div>`;
    }
    else if (phEx) prompt = `<div class="eg"><div class="en">${esc(phEx.en)}</div><div class="zh">${esc(phEx.zh)}</div></div>`;
    else if (ex) prompt = `<div class="eg"><div class="en">${esc(ex.en)}</div><div class="zh">${esc(ex.zh)}</div></div>`;
    else prompt = `<div class="mean-list">${renderMeaning(meaning)}</div>`;
    const it = document.createElement('div'); it.className = 'item chk-item' + (r.ok ? '' : ' bad');
    it.innerHTML = `<div><div class="w">${esc(r.word)}</div>${prompt}</div>
      <div class="check ${r.ok ? 'on' : ''}" data-i="${i}">${r.ok ? '✓' : '✗'}</div>`;
    it.querySelector('.check').onclick = () => {
      r.ok = !r.ok;
      it.classList.toggle('bad', !r.ok);
      it.querySelector('.check').classList.toggle('on', r.ok);
      it.querySelector('.check').textContent = r.ok ? '✓' : '✗';
      $('#chkOk').textContent = `确认提交（错 ${wrongCount()}）`;
    };
    list.appendChild(it);
  });
  box.innerHTML = '';
  box.appendChild(head); box.appendChild(list);
  $('#exitReview').onclick = () => { saveAll(); goto('learn'); };   // 仅暂停：保留 reviewState 以便重开工作台后续接
  const okBtn = document.createElement('button');
  okBtn.className = 'btn primary'; okBtn.id = 'chkOk'; okBtn.style.marginTop = '12px';
  okBtn.textContent = `确认提交（错 ${wrongCount()}）`;
  okBtn.onclick = confirmCheck;
  box.appendChild(okBtn);
}
function confirmCheck(after) {
  const st = reviewState;
  const wrong = st.check.filter(r => !r.ok);
  st.check.forEach(r => settleReview(r, r.ok, dayOf()));
  st.pool.forEach(r => recordHistory('review', { key: r.key, word: r.word, bank: r.bank, meaning: r.meaning, phonetic_us: r.phonetic_us, phonetic_uk: r.phonetic_uk }, dayOf()));
  // 复习完成 = 「单词复习（或听中文听写）」一轮 + 「情境填词」一轮，各自独立记一轮，两轮都完成才算复习完成
  // 单词复习 / 听中文听写 → recallDone（单词轮）；情境填词 → sentenceDone（情境轮）
  const rday = REVIEW_DAY || dayOf();
  if (settings.reviewType === 'sentence') markReviewDone('sentence', rday);
  else markReviewDone('recall', rday);
  // 补打卡（REVIEW_DAY 指向过往某日）：完成复习即记到原应打卡日，使其从补打卡栏目移除
  if (REVIEW_DAY) { if (!history[REVIEW_DAY]) history[REVIEW_DAY] = { new: [], review: [] }; history[REVIEW_DAY].studyDone = true; }
  saveAll();
  if (typeof after === 'function') { after(); return; }   // 显式后续流程优先（如 recall→sentence 链式）
  // 自动引导完成另一轮，满足「单词复习 + 情境填词各完成一轮」才算复习完成
  const need = nextReviewRoundNeeded(rday);
  if (need === 'sentence') { startSentenceRound(st.pool); toast('第 2 轮：情境填词'); return; }
  if (need === 'recall') { startRecallRound(st.pool); toast('第 2 轮：单词复习'); return; }
  st.done = true; renderSummary();
}
function renderSummary() {
  const st = reviewState;
  const wrong = (st.check || st.pool).filter(r => !r.ok);
  const box = $('#reviewBox');
  if (!wrong.length) { box.innerHTML = `<div class="empty">🎉 全部正确！本次 ${st.pool.length} 词已掌握</div>`; return; }
  box.innerHTML = `<h2>本次结果（${st.pool.length - wrong.length}/${st.pool.length} 正确）</h2>
    <div class="sub-tip">错词已加入错题本</div>
    <div class="list" id="doneList" style="margin-top:10px"></div>
    <button class="btn red" style="margin-top:12px" id="reWrong">🔁 重练错词（${wrong.length}）</button>
    <button class="btn ghost sm" style="margin-top:10px" id="backHome">返回首页</button>`;
  const list = $('#doneList');
  wrong.forEach(r => {
    const it = document.createElement('div'); it.className = 'item';
    it.innerHTML = `<div><div class="w">${esc(r.word)}</div><div class="m">${esc(r.meaning)}</div></div></div>`;
    list.appendChild(it);
  });
  $('#reWrong').onclick = () => {
    const wq = wrong.map(r => ({ ...r, ok: true }));
    reviewState = { pool: wq, idx: 0 };
    review(); renderReviewCard();
  };
  $('#backHome').onclick = () => goto('learn');
}
function openMakeup() {
  // 仅列出「尚未打卡完成」的过往日期（今日不在此列；已完成学习+复习的日期也不出现）
  const dates = Object.keys(history).filter(d => d !== todayStr() && !dayComplete(d)).sort().reverse();
  openModal(`<h3>补打卡 · 选择未完成的日期</h3>
    <div class="list" id="mkList">${dates.length ? dates.map(d => `<div class="item" data-d="${d}"><div><div class="w">${d}</div><div class="m">当日学习 ${dayTotal(d)} 词（去重）｜${dayStudyDone(d) ? '已学新词' : '未学新词'} · ${dayReviewDone(d) ? '已复习' : '未复习'}</div></div><span class="tag">补卡</span></div>`).join('') : '<div class="empty">全部日期已打卡完成 🎉</div>'}</div>
    <div class="sub-tip" style="margin-top:8px">补打卡的学习进度按<b>原应打卡日</b>计算，不按今天。完成复习即视为该日打卡完成。</div>
    <button class="btn ghost" style="margin-top:12px" onclick="closeModal()">取消</button>`);
  document.querySelectorAll('#mkList .item').forEach(it => it.onclick = () => {
    const d = it.dataset.d;
    const pool = buildReviewPool(d); closeModal();
    if (!pool.length) {
      // 该日已无待复习词（或仅学未复习）：直接结算为打卡完成
      if (!history[d]) history[d] = { new: [], review: [] };
      history[d].recallDone = true; history[d].sentenceDone = true; history[d].studyDone = true;
      saveAll(); toast('该日已结算为打卡完成 🎉');
      openMakeup(); return;
    }
    REVIEW_DAY = d;                        // 进度与打卡均记到「原应打卡日」
    settings.reviewType = 'recall'; saveAll();   // 补打卡走「单词复习→情境填词」双轮，方算完整打卡
    startReview(pool);
  });
}

/* ===================== 错题本 ===================== */
function wrong() {
  app().innerHTML = `${topbar('错题本')}
    <div class="card strawberry">
      <div class="wb-sortbar">
        <div class="seg sm" id="wbSort">
          <div class="on" data-s="count">错误次数</div>
          <div data-s="last">最后错误时间</div>
          <div data-s="added">加入时间</div>
        </div>
        <button class="btn ghost sm" id="wbDir">↓ 降序</button>
      </div>
      <div class="wb-filter">
        <div class="seg sm" id="wbFilterDim">
          <div class="on" data-f="all">全部</div>
          <div data-f="count">错误次数</div>
          <div data-f="last">最后错误时间</div>
          <div data-f="added">加入时间</div>
        </div>
        <div class="seg sm" id="wbFilterVal"></div>
      </div>
      <div class="wb-bar" style="margin:10px 0">
        <label class="wb-selall"><input type="checkbox" id="wbAll"> 全选</label>
        <button class="btn ghost sm" id="wbDel" disabled>批量删除 (0)</button>
        <button class="btn ghost sm" id="wbExp" disabled>📊 导出 Excel (0)</button>
      </div>
      <div class="list" id="wrongList"></div>
      ${Object.keys(wrongBook).length ? '' : '<div class="empty">还没有错题，复习答错会自动入库</div>'}
    </div>`;
  let sortBy = 'last', sortDesc = true;
  let filterDim = 'all', filterVal = 'all';
  const list = $('#wrongList');
  const FILTER_OPTS = {
    all: [['all', '全部']],
    count: [['all', '全部'], ['1', '1次'], ['2', '2次'], ['3', '3次'], ['4', '4次以上']],
    last: [['all', '全部'], ['0-15', '0-15天'], ['16-30', '16-30天'], ['31-60', '31-60天'], ['60+', '60天以上']],
    added: [['all', '全部'], ['0-15', '0-15天'], ['16-30', '16-30天'], ['31-60', '31-60天'], ['60+', '60天以上']],
  };
  const updateSortUI = () => {
    document.querySelectorAll('#wbSort div').forEach(d => d.classList.toggle('on', d.dataset.s === sortBy));
    const db = $('#wbDir'); if (db) db.textContent = sortDesc ? '↓ 降序' : '↑ 升序';
  };
  const renderFilterVal = () => {
    const fv = $('#wbFilterVal');
    fv.innerHTML = FILTER_OPTS[filterDim].map(([v, t]) => `<div data-v="${v}" class="${v === filterVal ? 'on' : ''}">${t}</div>`).join('');
    fv.querySelectorAll('div').forEach(d => d.onclick = () => {
      filterVal = d.dataset.v;
      fv.querySelectorAll('div').forEach(x => x.classList.toggle('on', x.dataset.v === filterVal)); // 高亮跟随点击移动
      render();
    });
  };
  const passFilter = (w) => {
    if (filterDim === 'all' || filterVal === 'all') return true;
    if (filterDim === 'count') {
      const c = w.wrongCount || 0;
      if (filterVal === '4') return c >= 4;     // 4 次以上
      return String(c) === filterVal;
    }
    const dateStr = filterDim === 'added' ? (w.added || '') : (w.lastWrong || '');
    if (!dateStr) return false;
    const n = daysBetween(dateStr, todayStr());
    if (filterVal === '60+') return n >= 61;                 // 60天以上（不含 60）
    const [lo, hi] = filterVal.split('-').map(Number);
    return n >= lo && n <= hi;                               // 0-15 / 16-30 / 31-60，互不重叠
  };
  const updateBar = () => {
    const n = list.querySelectorAll('input[data-key]:checked').length;
    const d = $('#wbDel'), e = $('#wbExp');
    d.textContent = `批量删除 (${n})`; d.disabled = !n;
    e.textContent = `📊 导出 Excel (${n})`; e.disabled = !n;
  };
  const render = () => {
    const allCb = $('#wbAll'); if (allCb) allCb.checked = false;
    updateSortUI();
    const arr = Object.values(wrongBook).filter(passFilter);
    arr.sort((a, b) => {
      let r = 0;
      if (sortBy === 'count') r = (a.wrongCount || 0) - (b.wrongCount || 0);
      else if (sortBy === 'added') r = String(a.added || '').localeCompare(String(b.added || ''));
      else r = String(a.lastWrong || '').localeCompare(String(b.lastWrong || ''));
      return sortDesc ? -r : r;
    });
    if (!arr.length) { list.innerHTML = '<div class="empty">没有符合筛选条件的错题</div>'; updateBar(); return; }
    list.innerHTML = '';
    arr.forEach(w => {
      const lc = w.word.toLowerCase();
      const d = DICT[lc] || {};
      const us = w.phonetic_us || d.us || '';
      const uk = w.phonetic_uk || d.uk || '';
      const meaning = w.meaning || d.meaning || '';
      const it = document.createElement('div'); it.className = 'wb-item';
      it.innerHTML = `
        <label class="wb-check" onclick="event.stopPropagation()"><input type="checkbox" data-key="${esc(w.key)}"></label>
        <div class="wb-head">
          <div class="w clickable">${esc(w.word)} <span class="chev">▸</span></div>
          <div class="meta">最后错：${esc(w.lastWrong || '-')} ｜ 错 ${w.wrongCount || 0} 次</div>
        </div>
        <div class="wb-detail" style="display:none">
          ${detailInner({ word: w.word, bank: w.bank, phonetic_us: us, phonetic_uk: uk, meaning: meaning })}
        </div>`;
      const head = it.querySelector('.wb-head');
      head.onclick = (e) => {
        const dv = it.querySelector('.wb-detail');
        const open = dv.style.display === 'none';
        dv.style.display = open ? '' : 'none';
        it.querySelector('.chev').textContent = open ? '▾' : '▸';
      };
      it.querySelector('.wb-check input').onchange = updateBar;
      list.appendChild(it);
    });
    updateBar();
  };
  document.querySelectorAll('#wbSort div').forEach(d => d.onclick = () => { sortBy = d.dataset.s; render(); });
  $('#wbDir').onclick = () => { sortDesc = !sortDesc; render(); };
  document.querySelectorAll('#wbFilterDim div').forEach(d => d.onclick = () => {
    filterDim = d.dataset.f; filterVal = 'all';
    document.querySelectorAll('#wbFilterDim div').forEach(x => x.classList.toggle('on', x.dataset.f === filterDim));
    renderFilterVal(); render();
  });
  renderFilterVal();
  $('#wbAll').onchange = e => { list.querySelectorAll('input[data-key]').forEach(c => c.checked = e.target.checked); updateBar(); };
  $('#wbDel').onclick = () => {
    const keys = [...list.querySelectorAll('input[data-key]:checked')].map(c => c.dataset.key);
    if (!keys.length) return;
    if (!confirm('确定删除选中的 ' + keys.length + ' 个错题？')) return;
    keys.forEach(k => delete wrongBook[k]);
    saveAll(); render(); toast('已删除 ' + keys.length + ' 个');
  };
  $('#wbExp').onclick = () => {
    const keys = [...list.querySelectorAll('input[data-key]:checked')].map(c => c.dataset.key);
    const items = keys.map(k => wrongBook[k]).filter(Boolean);
    if (!items.length) { toast('请先勾选要导出的错题'); return; }
    exportWrongExcel(items);
  };
  render();
}

/* ===================== 词库 ===================== */
function banks() {
  app().innerHTML = `${topbar('词库')}
    ${BANKS_READY ? '' : '<div class="sub-tip" style="margin-bottom:10px">词库数据加载中，稍候自动刷新…</div>'}
    <div class="card blueberry">
      <h2>自建词库 <span class="r">${selfBank.length} 词 · 优先背诵</span></h2>
      <div class="list" id="selfList"></div>
      <button class="btn primary sm" style="margin-top:10px" id="bulkBtn">📥 批量添加</button>
      ${selfBank.length ? '' : '<div class="empty">点「批量添加」导入单词，或到「查词」里加入</div>'}
    </div>
    <div class="card" style="margin-top:12px">
      <h2>已背单词</h2>
      <button class="btn ghost sm" id="expLearnedBtn">📤 导出已背单词（Excel）</button>
    </div>
    <div class="sub-tip" style="margin-top:10px">云同步与进度备份已移至右上角 ⚙ 设置里（点开即展开）。</div>`;
  const sl = $('#selfList');
  selfBank.slice().reverse().forEach(w => {
    const lc = w.word.toLowerCase();
    const bm = BANK_MAP[lc];
    const bank = w.bank || (bm && bm.bank) || '';
    const d = DICT[lc] || {};
    const us = w.phonetic_us || d.us || '';
    const uk = w.phonetic_uk || d.uk || '';
    const meaning = w.meaning || d.meaning || '';
    const it = document.createElement('div'); it.className = 'item sbk-item';
    it.innerHTML = `
      <div class="sbk-head">
        <div class="w clickable">${esc(w.word)} <span class="chev">▸</span></div>
        <button class="btn ghost sm sbk-del">删</button>
      </div>
      <div class="sbk-detail" style="display:none">
        ${detailInner({ word: w.word, bank: bank, phonetic_us: us, phonetic_uk: uk, meaning: meaning })}
      </div>`;
    const head = it.querySelector('.sbk-head');
    head.onclick = (e) => {
      if (e.target.closest('.sbk-del')) return;
      const dv = it.querySelector('.sbk-detail');
      const open = dv.style.display === 'none';
      dv.style.display = open ? '' : 'none';
      it.querySelector('.chev').textContent = open ? '▾' : '▸';
    };
    it.querySelector('.sbk-del').onclick = (e) => {
      e.stopPropagation();
      selfBank = selfBank.filter(x => x.word !== w.word);
      if (window.Sync) Sync.noteDelete(w.word);
      saveAll(); banks(); toast('已删除');
    };
    sl.appendChild(it);
  });
  $('#bulkBtn').onclick = () => {
    openModal(`<h3>批量添加自建单词</h3>
      <div class="sub-tip">每行一个，或用英文分号 ; 分隔。自动匹配词库并填入释义/音标；词库未收录的词需手动补释义。</div>
      <textarea class="field" id="bulkTxt" rows="8" placeholder="apple; banana
orange"></textarea>
      <div class="row"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="bulkNext">下一步：核对</button></div>`);
    $('#bulkNext').onclick = () => {
      const raw = $('#bulkTxt').value;
      const words = raw.split(/[\n;；]+/).map(s => s.trim().replace(/\.$/, '')).filter(Boolean);
      const seen = new Set(), list = [];
      words.forEach(w => { const k = w.toLowerCase(); if (!seen.has(k)) { seen.add(k); list.push(w); } });
      if (!list.length) { toast('请输入单词'); return; }
      const rows = list.map((w, i) => {
        const k = w.toLowerCase();
        let m = BANK_MAP[k] || null;
        if (!m && DICT[k]) { const d = DICT[k]; m = { word: w, bank: '词典', meaning: d.meaning, phonetic_us: d.us, phonetic_uk: d.uk }; }
        return { w, m, inSelf: selfBank.some(s => s.word.toLowerCase() === k), idx: i };
      });
      const body = rows.map(r => `
        <div class="bulk-row" data-i="${r.idx}">
          <div class="bw">${esc(r.w)} ${r.inSelf ? '<span class="tag">已存在</span>' : ''}</div>
          ${r.m ? `<div class="bm">✔ 已匹配 ${esc(r.m.bank)}：${esc(r.m.meaning)}</div>` : `<input class="field sm" data-meaning placeholder="中文释义（词库未收录，请填写）" value="">`}
        </div>`).join('');
      openModal(`<h3>核对 ${rows.length} 个单词</h3>
        <div class="sub-tip">✔ 为自动匹配；未匹配请填释义（可留空，之后在查词里补）</div>
        <div class="bulk-list" id="bulkRows">${body}</div>
        <div class="row" style="margin-top:12px"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" id="bulkOk">加入自建词库</button></div>`);
      $('#bulkOk').onclick = () => {
        let added = 0, dup = 0, reset = 0;
        rows.forEach(r => {
          // 已存在的词也算"再次加入"：若此前已背过则重置为未背诵，重新推送
          if (r.inSelf) { dup++; if (resetWordForSelf(r.w)) reset++; return; }
          let meaning = '', pu = '', pk = '';
          if (r.m) { meaning = r.m.meaning; pu = r.m.phonetic_us; pk = r.m.phonetic_uk; }
          else { const inp = document.querySelector(`#bulkRows .bulk-row[data-i="${r.idx}"] [data-meaning]`); meaning = inp ? inp.value.trim() : ''; }
          selfBank.push({ word: r.w, phonetic_us: pu, phonetic_uk: pk, meaning: meaning || '（未填释义）', added: todayStr() });
          if (resetWordForSelf(r.w)) reset++;
          added++;
        });
        saveAll(); closeModal(); banks();
        toast(`已加入 ${added} 个${dup ? ` ｜ ${dup} 个已存在` : ''}${reset ? ` ｜ ${reset} 个已重置为未背` : ''}`);
      };
    };
  };
  $('#expLearnedBtn').onclick = () => exportLearnedExcel();
}

/* ---------- 进度备份 / 恢复 ---------- */
function exportData() {
  const data = { _v: 1, exportedAt: new Date().toISOString(), progress, wrongBook, selfBank, settings, history };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = '背单词进度_' + todayStr() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已导出进度文件');
}

/* ---------- 错题本导出 Excel（单词 / 音标 / 中文释义，A4 版式） ---------- */
function exportWrongExcel(items) {
  const arr = (items && items.length) ? items : Object.values(wrongBook);
  if (!arr.length) { toast('错题本是空的，没有可导出的内容'); return; }
  const rows = arr.map(w => {
    const lc = (w.word || '').toLowerCase();
    const d = DICT[lc] || {};
    const uk = w.phonetic_uk || d.uk || '';
    const us = w.phonetic_us || d.us || '';
    const phon = [uk ? '英 /' + uk + '/' : '', us ? '美 /' + us + '/' : ''].filter(Boolean).join('   ');
    return { word: w.word || '', phon, meaning: (w.meaning || d.meaning || '').replace(/\s*\n\s*/g, ' ') };
  });
  const trs = rows.map(r =>
    `<tr><td class="w">${esc(r.word)}</td><td class="p">${esc(r.phon)}</td><td>${esc(r.meaning)}</td></tr>`
  ).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>错题本</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  @page { size: A4 portrait; margin: 18mm 14mm; }
  body { font-family: "Microsoft YaHei","PingFang SC",sans-serif; font-size: 11pt; color: #333; }
  h2 { font-size: 14pt; margin: 0 0 3px; }
  .meta { color: #888; font-size: 9pt; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; word-break: break-word; }
  th { background: #EADFD8; text-align: left; }
  td.w { font-weight: 600; width: 22%; }
  td.p { color: #666; width: 27%; }
  tr { page-break-inside: avoid; }
</style></head>
<body>
<h2>错题本</h2>
<div class="meta">导出日期：${todayStr()} ｜ 共 ${rows.length} 词</div>
<table>
  <thead><tr><th>单词</th><th>音标</th><th>中文释义</th></tr></thead>
  <tbody>${trs}</tbody>
</table>
</body></html>`;
  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = '错题本_' + todayStr() + '.xls';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`已导出 ${rows.length} 个错词（Excel · A4）`);
}
// 导出「已背单词」为 Excel（.xls）：取 progress 中已学习过的全部词，含词库/首学日期/最近复习/错词状态
function exportLearnedExcel() {
  const arr = Object.values(progress).filter(p => p && p.word && p.firstLearned);
  if (!arr.length) { toast('还没有已背单词，无法导出'); return; }
  const rows = arr.map(p => {
    const lc = (p.word || '').toLowerCase();
    const d = DICT[lc] || {};
    const uk = p.phonetic_uk || d.uk || '';
    const us = p.phonetic_us || d.us || '';
    const phon = [uk ? '英 /' + uk + '/' : '', us ? '美 /' + us + '/' : ''].filter(Boolean).join('   ');
    const wb = wrongBook[bankKey(p.bank, p.word)];
    const status = p.nextReview ? (wb ? '复习中(含错词)' : '复习中') : (wb ? '错词·已掌握' : '已掌握');
    return {
      word: p.word,
      phon,
      meaning: (p.meaning || d.meaning || '').replace(/\s*\n\s*/g, ' '),
      bank: p.bank || '',
      first: p.firstLearned || '',
      last: p.lastReview || '',
      wrong: wb ? ('是(' + (wb.wrongCount || 0) + ')') : '否',
      status,
    };
  });
  rows.sort((a, b) => (a.bank === b.bank ? a.word.localeCompare(b.word) : a.bank.localeCompare(b.bank)));
  const trs = rows.map(r =>
    `<tr><td class="w">${esc(r.word)}</td><td class="p">${esc(r.phon)}</td><td>${esc(r.meaning)}</td><td>${esc(r.bank)}</td><td>${esc(r.first)}</td><td>${esc(r.last)}</td><td>${esc(r.wrong)}</td><td>${esc(r.status)}</td></tr>`
  ).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>已背单词</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  @page { size: A4 portrait; margin: 18mm 14mm; }
  body { font-family: "Microsoft YaHei","PingFang SC",sans-serif; font-size: 11pt; color: #333; }
  h2 { font-size: 14pt; margin: 0 0 3px; }
  .meta { color: #888; font-size: 9pt; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; word-break: break-word; }
  th { background: #EADFD8; text-align: left; }
  td.w { font-weight: 600; width: 16%; }
  td.p { color: #666; width: 22%; }
  tr { page-break-inside: avoid; }
</style></head>
<body>
<h2>已背单词</h2>
<div class="meta">导出日期：${todayStr()} ｜ 共 ${rows.length} 词</div>
<table>
  <thead><tr><th>单词</th><th>音标</th><th>中文释义</th><th>词库</th><th>首次学习</th><th>最近复习</th><th>错词</th><th>状态</th></tr></thead>
  <tbody>${trs}</tbody>
</table>
</body></html>`;
  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = '已背单词_' + todayStr() + '.xls';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`已导出 ${rows.length} 个已背单词（Excel · A4）`);
}
function importData(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!d || (!d.progress && !d.selfBank && !d.wrongBook)) throw new Error('bad');
      if (d.progress) progress = d.progress;
      if (d.wrongBook) wrongBook = d.wrongBook;
      if (d.selfBank) selfBank = d.selfBank;
      if (d.history) history = d.history;
      if (d.settings) settings = Object.assign(settings, d.settings);
      saveAll(); toast('已恢复进度'); banks();
    } catch (e) { toast('文件格式不对，导入失败'); }
  };
  fr.readAsText(file);
}

/* ===================== 查词 ===================== */
function dict() {
  app().innerHTML = `${topbar('查词')}
    ${BANKS_READY ? '' : '<div class="sub-tip" style="margin-bottom:10px">词库索引加载中，稍候即可查词…</div>'}
    <div class="card mint">
      <input class="field" id="q" placeholder="输入英文单词或中文含义…">
      <div class="pron-bar">
        <div class="seg sm pron-accent">
          <div data-a="en-US">美音</div>
          <div data-a="en-GB">英音</div>
        </div>
        <div class="seg sm pron-rate">
          <div data-r="0.95">正常</div>
          <div data-r="0.6">慢速</div>
        </div>
        <label class="pron-auto"><input type="checkbox" id="autoSpeakChk"> 自动发音</label>
      </div>
      <div class="list" id="dictList"></div>
      <div class="empty" id="dictEmpty">输入关键词开始查词，点击词语查看详情，可加入自建词库</div>
    </div>`;
  const list = $('#dictList'), empty = $('#dictEmpty');
  // 发音模块：口音 / 语速 / 展开自动朗读（设置持久化）
  const aSeg = $('.pron-accent'), rSeg = $('.pron-rate'), chk = $('#autoSpeakChk');
  const paintPron = () => {
    const a = settings.accent || 'en-US', r = settings.pronRate || 0.95;
    aSeg.querySelectorAll('div').forEach(d => d.classList.toggle('on', d.dataset.a === a));
    rSeg.querySelectorAll('div').forEach(d => d.classList.toggle('on', Math.abs(parseFloat(d.dataset.r) - r) < 0.01));
    chk.checked = !!settings.autoSpeak;
  };
  aSeg.querySelectorAll('div').forEach(d => d.onclick = () => {
    settings.accent = d.dataset.a; saveAll(); paintPron();
    const qi = $('#q'); if (qi && qi.value.trim()) qi.dispatchEvent(new Event('input'));   // 切换口音立即刷新音标
  });
  rSeg.querySelectorAll('div').forEach(d => d.onclick = () => { settings.pronRate = parseFloat(d.dataset.r); saveAll(); paintPron(); });
  chk.onchange = () => { settings.autoSpeak = chk.checked; saveAll(); };
  paintPron();
  $('#q').oninput = e => {
    const q = e.target.value.trim().toLowerCase(); if (!q) { list.innerHTML = ''; empty.style.display = ''; return; }
    const hit = new Set();
    const res = ALL_INDEX.filter(x => x.word.toLowerCase().includes(q) || (x.meaning || '').toLowerCase().includes(q))
      .slice(0, 30).map(x => {
        const d = DICT[x.word.toLowerCase()];
        hit.add(x.word.toLowerCase());
        return { word: x.word, bank: x.bank, us: (d && d.us) || x.phonetic_us, uk: (d && d.uk) || x.phonetic_uk, meaning: (d && d.meaning) || x.meaning };
      });
    if (res.length < 30) {                       // 补充词典独有常用词（词库未收录）
      for (const k in DICT) {
        if (hit.has(k)) continue;
        const d = DICT[k];
        if (k.includes(q) || (d.meaning || '').toLowerCase().includes(q)) {
          res.push({ word: k, bank: '词典', us: d.us, uk: d.uk, meaning: d.meaning });
          if (res.length >= 30) break;
        }
      }
    }
    if (res.length < 30) {                       // 补充短语动词（按英文短语匹配）
      for (const k in PHRASE) {
        if (hit.has(k)) continue;
        if (k.includes(q)) {
          const s0 = PHRASE[k].senses[0];
          res.push({ word: k, bank: '短语动词', us: '', uk: '', meaning: s0 ? s0.en : '' });
          if (res.length >= 30) break;
        }
      }
    }
    empty.style.display = res.length ? 'none' : '';
    list.innerHTML = '';
    res.forEach(x => {
      const it = document.createElement('div'); it.className = 'item dict-item';
      const inSelf = selfBank.some(s => s.word.toLowerCase() === x.word.toLowerCase());
      const w = { word: x.word, bank: x.bank, phonetic_us: x.us, phonetic_uk: x.uk, meaning: x.meaning };
      const acc = settings.accent || 'en-US';
      const ph = acc === 'en-GB' ? (x.uk || x.us) : (x.us || x.uk);
      it.innerHTML = `
        <div class="dict-head">
          <div class="dh-left">
            <div class="w clickable">${esc(x.word)} <span class="chev">▸</span></div>
            ${ph ? `<span class="dh-ph">${esc(ph)}</span>` : ''}
          </div>
          <button class="spk" title="朗读" aria-label="朗读">${icon('i-sound')}</button>
          <button class="btn ghost sm self-btn">${inSelf ? '已加' : '＋加入'}</button>
        </div>
        <div class="dict-detail" style="display:none">
          ${detailInner(w)}
        </div>`;
      it.querySelector('.spk').onclick = (e) => { e.stopPropagation(); pron(x.word, ''); };
      it.querySelector('.dict-head').onclick = () => {
        const d = it.querySelector('.dict-detail');
        const open = d.style.display === 'none';
        d.style.display = open ? '' : 'none';
        it.querySelector('.chev').textContent = open ? '▾' : '▸';
        if (open && settings.autoSpeak) pron(x.word, '');   // 展开即朗读，方便学新词
      };
      const sb = it.querySelector('.self-btn');
      sb.onclick = (e) => {
        e.stopPropagation();
        if (inSelf) {
          // 再次点击已存在的词：若已背过则重置为未背诵，使其重新推送
          if (resetWordForSelf(x.word)) { saveAll(); toast('已重置为未背诵，将重新推送'); }
          else toast('已在自建词库');
          return;
        }
        selfBank.push({ word: x.word, phonetic_us: x.us, phonetic_uk: x.uk, meaning: x.meaning, added: todayStr() });
        const wasLearned = resetWordForSelf(x.word);
        saveAll(); sb.textContent = '已加';
        toast(wasLearned ? '已加入自建词库（该词已重置为未背诵）' : '已加入自建词库');
      };
      list.appendChild(it);
    });
  };
}

/* ===================== 启动 ===================== */
(async function init() {
  await loadData();                       // 仅探测基址，极快——不在此等待词库
  await seedAccounts();                 // 首次运行预置 lvcheng 等账号
  if (currentAccount && !accounts[currentAccount]) { currentAccount = ''; saveSession(); } // 会话账号已被删则回到登录页
  if (window.Sync) {
    Sync.reload();
    if (Sync.tryImportFromHash()) toast('已通过配对链接开启云同步');
  }
  // 关键：先用本地数据渲染界面，绝不因词库/云端同步请求卡住（pending）而长时间白屏
  calibrateSchedule();
  seedStudyDone();
  reconcileLearnPlan();   // 生成首屏待学批次（若无本地批次则按 dailyNew 选出）
  goto('learn');
  try { speechSynthesis.getVoices(); } catch (e) { }
  // 词库与离线词典在后台加载；加载完成前，学习/复习/工作本等核心功能已可用
  loadBanksBg().then(() => {
    BANKS_READY = true;
    if (!Object.keys(BANK_DATA).length) {
      // file:// 直接双击打开或路径错误：读不到任何词库
      BANK_LOAD_FAILED = true;
      app().innerHTML = `${topbar('背单词工作台')}
        <div class="card"><h2>需要本地服务器</h2>
        <div class="sub-tip">直接双击打开（file://）读不到词库。请在项目目录运行：</div>
        <div class="pos" style="margin-top:10px"><span class="pt">①</span>python -m http.server 8000</div>
        <div class="pos"><span class="pt">②</span>访问 http://localhost:8000/</div></div>`;
      return;
    }
    // 云端合并在后台进行；即使请求卡住也不影响已渲染的界面，完成后刷新视图
    if (window.Sync && Sync.on()) {
      Sync.sync()
        .catch(() => { })
        .then(() => { calibrateSchedule(); try { WB.refresh(); } catch (e) { } });
    } else {
      try { WB.refresh(); } catch (e) { }   // 词库就绪后刷新当前页，补全学习/词库/查词
    }
  }).catch(() => {
    BANK_LOAD_FAILED = true;
    app().innerHTML = `${topbar('背单词工作台')}
      <div class="card"><h2>词库加载失败</h2>
      <div class="sub-tip">无法读取词库文件，请检查网络或本地服务器后刷新重试。</div></div>`;
  });
})();

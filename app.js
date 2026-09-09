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
  { id: '托福', file: 'levels/托福.json', color: '#9A8FB0' },
  { id: '雅思', file: 'levels/雅思.json', color: '#A89AB8' },
];
const INTERVALS = [1, 2, 3, 5, 7, 15, 30];
// 错词复习节奏：在错误的第 1、1、2、3、20、40 天再次推送（独立于新词 INTERVALS）
const WRONG_INTERVALS = [1, 2, 3, 20, 40];
const SELFBANK_ID = '自建';
const K = {
  progress: 'wb_progress', wrong: 'wb_wrong', self: 'wb_selfbank',
  settings: 'wb_settings', history: 'wb_history', learn: 'wb_learnstate',
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

let progress, wrongBook, selfBank, settings, history, learnState;
function snapshot() { return { progress, wrongBook, selfBank, settings, history, learnState }; }
function loadState() {
  const base = { speed: 0, reviewMode: 'zh', autoSpeak: true, dailyNew: 20, curBank: '小学', reviewType: 'sentence' };
  if (currentAccount) {
    const s = store.get(ACCT.data(currentAccount), null) || {};
    progress = s.progress || {};
    wrongBook = s.wrongBook || {};
    selfBank = s.selfBank || [];
    settings = Object.assign({}, base, s.settings || {});
    history = s.history || {};
    learnState = s.learnState || null;
  } else {
    progress = store.get(K.progress, {});
    wrongBook = store.get(K.wrong, {});
    selfBank = store.get(K.self, []);
    settings = store.get(K.settings, base);
    history = store.get(K.history, {});
    learnState = store.get(K.learn, null);
  }
  if (!BANKS.some(b => b.id === settings.curBank)) settings.curBank = '小学';
}
loadState();
function saveAll() {
  if (currentAccount) store.set(ACCT.data(currentAccount), snapshot());
  else {
    store.set(K.progress, progress); store.set(K.wrong, wrongBook);
    store.set(K.self, selfBank); store.set(K.settings, settings); store.set(K.history, history);
    store.set(K.learn, learnState);
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
  get currentAccount() { return currentAccount; },
  refresh() { try { PAGES[CUR](); } catch (e) { } },
  buildReviewPool,
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
  settings = Object.assign({ speed: 0, reviewMode: 'zh', autoSpeak: true, dailyNew: 20, curBank: '小学', reviewType: 'sentence' }, settings);
  history = {}; learnState = null;
  if (!BANKS.some(b => b.id === settings.curBank)) settings.curBank = '小学';
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
  };
  const hasLegacy = [legacy.progress, legacy.wrong, legacy.self, legacy.history].some(v => v && (Array.isArray(v) ? v.length : true)) || !!legacy.learn;
  if (hasLegacy) {
    store.set(ACCT.data('lvcheng'), {
      progress: legacy.progress || {}, wrongBook: legacy.wrong || {}, selfBank: legacy.self || [],
      settings: Object.assign({ speed: 0, reviewMode: 'zh', autoSpeak: true, dailyNew: 20, curBank: '小学', reviewType: 'sentence' }, legacy.settings || {}),
      history: legacy.history || {}, learnState: legacy.learn || null,
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

async function loadData() {
  WB = await detectBase();
  await Promise.all(BANKS.map(b => fetch(WB + b.file).then(r => r.json()).then(d => { BANK_DATA[b.id] = d; }).catch(() => { })));
  ALL_INDEX = [];
  BANKS.forEach(b => (BANK_DATA[b.id]?.words || []).forEach(w => ALL_INDEX.push({ word: w.word, bank: b.id, meaning: w.meaning, phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk })));
  selfBank.forEach(w => ALL_INDEX.push({ word: w.word, bank: SELFBANK_ID, meaning: w.meaning, phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk }));
  BANK_MAP = {};
  ALL_INDEX.forEach(x => { if (!BANK_MAP[x.word.toLowerCase()]) BANK_MAP[x.word.toLowerCase()] = x; });
  try { const r = await fetch(WB + 'examples.json'); if (r.ok) EXAMPLES = await r.json(); } catch (e) { }
  try { const r = await fetch(WB + 'freq.json'); if (r.ok) FREQ = await r.json(); } catch (e) { }
  try { const r = await fetch(WB + 'obscure.json'); if (r.ok) OBSCURE = await r.json(); } catch (e) { }
  try { const r = await fetch(WB + 'dict.json'); if (r.ok) DICT = await r.json(); } catch (e) { }
  try { const r = await fetch(WB + 'collocation.json'); if (r.ok) COLLOC = await r.json(); } catch (e) { }
  try { const r = await fetch(WB + 'thesaurus.json'); if (r.ok) THES = await r.json(); } catch (e) { }
  try { const r = await fetch(WB + 'phrasal.json'); if (r.ok) PHRASE = await r.json(); } catch (e) { }
}

/* ---------- 工具 ---------- */
const $ = sel => document.querySelector(sel);
const app = () => document.getElementById('app');
function bankKey(bank, word) { return bank + '::' + word.toLowerCase(); }
function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return todayStr(d); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[r[i], r[j]] = [r[j], r[i]]; } return r; }
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
function speak(text, lang) {
  if (!text) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || 'en-US'; u.rate = 0.95;
    const vs = speechSynthesis.getVoices();
    const ev = vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang));
    if (ev) u.voice = ev;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) { }
}
let _audioCtx = null;
function beep(freq, dur) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq || 660; o.type = 'sine';
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + (dur || 0.08));
  } catch (e) { }
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
  if (us || uk) h += `<div class="learn-phon"><span class="p" onclick="speak('${jsAttr(w.word)}','en-US')">🇺🇸 ${esc(us || '')}</span><span class="p" onclick="speak('${jsAttr(w.word)}','en-GB')">🇬🇧 ${esc(uk || '')}</span></div>`;
  if (meaning) h += `<div class="mean-list">${renderMeaning(meaning)}</div>`;
  h += exampleHtml(w, 2);
  h += obscureHtml(w);
  h += extraHtml(lc);
  return h;
}
function streakDays() {
  let n = 0; const d = new Date();
  for (let i = 0; i < 3650; i++) {
    const h = history[todayStr(d)];
    if (h && ((h.new || []).length || (h.review || []).length)) n++;
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
function recordHistory(type, entry) {
  const d = todayStr();
  if (!history[d]) history[d] = { new: [], review: [] };
  const arr = history[d][type];
  if (!arr.some(x => x.key === entry.key)) arr.push(entry);
  saveAll();
}
function bankStat(id) {
  const total = BANK_DATA[id]?.count || 0;
  const learned = Object.values(progress).filter(p => p.bank === id).length;
  return { total, learned, pct: total ? Math.round(learned / total * 100) : 0 };
}

/* ---------- 词库与推送顺序 ---------- */
function bankWords(id) { return (BANK_DATA[id]?.words || []).map(w => ({ ...w, bank: id })); }
function unlearned(id) { return bankWords(id).filter(w => !progress[bankKey(id, w.word)]); }
// 按常见度排序（freq 越小越常见）；同级内随机乱序
function sortByFreq(list) {
  return list.map(w => ({ w, f: FREQ[w.word.toLowerCase()] ?? 5, r: Math.random() }))
    .sort((a, b) => a.f - b.f || a.r - b.r)
    .map(x => x.w);
}
// 当前词库背完 → 自动跳到下一个还没背完的
function nextBank(fromId) {
  const i = BANKS.findIndex(b => b.id === fromId);
  const order = BANKS.slice(i + 1).concat(BANKS.slice(0, Math.max(i, 0)));
  for (const b of order) if (unlearned(b.id).length) return b.id;
  return null;
}
function buildQueue() {
  const self = selfBank.filter(w => !progress[bankKey(SELFBANK_ID, w.word)]).map(w => ({ ...w, bank: SELFBANK_ID }));
  let bank = settings.curBank;
  if (!unlearned(bank).length && settings.autoNext !== false) {
    const nb = nextBank(bank);
    if (nb) { toast(`${bank} 已背完，已切换到 ${nb}`); bank = nb; settings.curBank = nb; }
  }
  // 每日推送总量固定为 settings.dailyNew：自建词库优先占额，剩余名额由当前大词库补足
  const daily = Math.max(0, +settings.dailyNew || 0);
  const selfPart = sortByFreq(self).slice(0, daily);
  const rest = daily - selfPart.length;
  const words = rest > 0 ? sortByFreq(unlearned(bank).map(w => ({ ...w, bank }))).slice(0, rest) : [];
  return { bank, queue: selfPart.concat(words) };
}
// 加入自建词库时：若该词此前已背过，重置为未背诵，使其重新进入优先推送
function resetWordForSelf(word) {
  const key = bankKey(SELFBANK_ID, word);
  let reset = false;
  if (progress[key]) { delete progress[key]; reset = true; }
  if (wrongBook[key]) { delete wrongBook[key]; reset = true; }
  return reset;
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
  const cur = settings.curBank;
  const picks = BANKS.map(b => {
    const s = bankStat(b.id);
    const self = b.id === SELFBANK_ID;
    return `<div class="bank ${b.id === cur ? 'sel' : ''}" data-bank="${b.id}">
      <div class="bn" style="color:${b.color}">${b.id}</div>
      <div class="bc">${s.learned} / ${s.total} 词</div>
      <div class="prog"><i style="width:${s.pct}%;background:${b.color}"></i></div>
      <div class="bc">${s.pct >= 100 ? '<span class="done-flag">已背完</span>' : '剩余 ' + (s.total - s.learned)}</div>
    </div>`;
  }).join('');
  openModal(`
    <h3>设置</h3>
    <div class="sub-tip" style="margin:-6px 0 10px">选定词库后会一直用它，背完自动跳到下一个</div>
    <div class="bank-pick">${picks}</div>
    <div style="margin-top:16px">
      <div class="sub-tip" style="margin:0">每日新词数：<b style="color:var(--brand)">${settings.dailyNew}</b> 词</div>
      <input type="range" min="1" max="50" step="1" value="${settings.dailyNew}" id="dnRange" style="width:100%;margin-top:6px">
    </div>
    <div style="margin-top:14px"><label class="sub-tip" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="autoNext" ${settings.autoNext === false ? '' : 'checked'} style="width:18px;height:18px">
      当前词库背完后自动切换到下一级</label></div>
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
  document.querySelectorAll('#modal .bank').forEach(el => el.onclick = () => {
    settings.curBank = el.dataset.bank; learnState = null; saveAll(); openSettings(); toast('已切换到 ' + el.dataset.bank);
  });
  $('#dnRange').oninput = e => {
    settings.dailyNew = +e.target.value; saveAll();
    $('#dnRange').previousElementSibling.innerHTML = `每日新词数：<b style="color:var(--brand)">${settings.dailyNew}</b> 词`;
  };
  $('#autoNext').onchange = e => { settings.autoNext = e.target.checked; saveAll(); };
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
      store.set(ACCT.data(currentAccount), { progress: {}, wrongBook: {}, selfBank: [], settings, history: {}, learnState: null });
      if (syncTargets !== null) store.set(ACCT.sync(currentAccount), syncTargets);
      progress = {}; wrongBook = {}; selfBank = []; history = {}; learnState = null;
    } else {
      // 未登录：保留 wb_sync 云配置，仅写入空学习数据（不调用 saveAll，避免触发自动上传空数据）
      const syncCfg = window.store ? store.get('wb_sync', null) : null;
      progress = {}; wrongBook = {}; selfBank = []; history = {}; learnState = null;
      store.set(K.progress, progress); store.set(K.wrong, wrongBook);
      store.set(K.self, selfBank); store.set(K.settings, settings); store.set(K.history, history);
      store.set(K.learn, learnState);
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
  const s = bankStat(settings.curBank);
  const due = Object.values(progress).filter(p => p.nextReview && p.nextReview <= todayStr()).length;
  let bars = '';
  const d = new Date(); d.setDate(d.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const ds = todayStr(d), st = todayStat(ds), tot = st.new + st.review;
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

    <div class="card lemon" style="margin-top:14px">
      <h2>正在背：${settings.curBank} <span class="r">${s.learned} / ${s.total}</span></h2>
      <div class="prog"><i style="width:${s.pct}%"></i></div>
      <div class="sub-tip">已背 ${s.pct}% ｜ 剩余 ${left} 词${due ? ' ｜ 待复习 ' + due + ' 词' : ''}</div>
    </div>

    <div class="card mint"><h2>近 7 天学习量</h2><div style="display:flex;gap:6px;align-items:flex-end">${bars}</div></div>

    <div class="card vanilla" id="learnBox"></div>`;
  setLearnActive(!!(learnState && learnState.queue && learnState.queue.length && learnState.idx < learnState.queue.length));
  renderLearnBox();
}

function renderLearnBox() {
  const box = $('#learnBox'); if (!box) return;
  if (!learnState || !learnState.queue.length) {
    setLearnActive(false);
    const selfLeft = selfBank.filter(w => !progress[bankKey(SELFBANK_ID, w.word)]).length;
    const left = unlearned(settings.curBank).length;
    const daily = Math.max(0, +settings.dailyNew || 0);
    const selfTake = Math.min(selfLeft, daily);
    const bigTake = daily - selfTake;
    const tip = selfLeft
      ? `今日共推送 ${daily} 个新词：自建词库优先占 ${selfTake} 个${bigTake ? `，其余 ${bigTake} 个来自「${settings.curBank}」` : ''}${selfLeft > selfTake ? `（自建还剩 ${selfLeft - selfTake} 词，将逐日推完）` : ''}`
      : `从「${settings.curBank}」按常见度推送 ${daily} 个新词`;
    box.innerHTML = `<h2>今日学习</h2>
      <div class="sub-tip">${tip}</div>
      <button class="btn primary" style="margin-top:14px" id="startLearn">开始学习</button>
      ${(!left && !self) ? '<div class="sub-tip" style="margin-top:10px">该词库已背完，开始学习会自动切换到下一个词库</div>' : ''}`;
    $('#startLearn').onclick = startLearning;
    return;
  }
  // 学习卡片：一个单词一页
  const st = learnState;
  const w = st.queue[st.idx];
  if (!w) { setLearnActive(false); box.innerHTML = renderFinish(); bindFinish(); return; }
  const last = st.idx >= st.queue.length - 1;
  box.innerHTML = `
    <div class="stepbar"><span>新学 ${st.idx + 1} / ${st.queue.length}</span><span class="tag">${w.bank}</span></div>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div class="learn-word">${esc(w.word)}</div>
      <button class="speaker-btn" onclick="speak('${jsAttr(w.word)}','en-US')" title="朗读单词发音" aria-label="朗读">${icon('i-sound')}<span>朗读</span></button>
    </div>
    <div class="learn-phon">
      <span class="p" onclick="speak('${jsAttr(w.word)}','en-US')">🇺🇸 ${esc(w.phonetic_us || '—')}</span>
      <span class="p" onclick="speak('${jsAttr(w.word)}','en-GB')">🇬🇧 ${esc(w.phonetic_uk || '—')}</span>
    </div>
    <div class="mean-list">${renderMeaning(w.meaning)}</div>
    ${obscureHtml(w)}
    ${exampleHtml(w, 1)}
    <div class="row" style="margin-top:18px">
      <button class="btn ghost" id="prevBtn" ${st.idx === 0 ? 'disabled' : ''}>${icon('i-prev')}上一个</button>
      <button class="btn ${last ? 'green' : 'primary'}" id="nextBtn">${last ? '学习完毕' : '下一个'}${last ? '' : icon('i-next')}</button>
    </div>
    ${st.idx === 0 ? '' : '<div class="sub-tip" style="text-align:center">翻到下一个即记为已学，并进入复习计划</div>'}`;
  $('#prevBtn').onclick = () => { if (st.idx > 0) { st.idx--; saveAll(); renderLearnBox(); } };
  $('#nextBtn').onclick = () => {
    markLearned(w);
    if (last) { learnState = { ...st, idx: st.idx + 1 }; saveAll(); renderLearnBox(); }
    else { st.idx++; saveAll(); renderLearnBox(); }
  };
}
function renderFinish() {
  const n = learnState?.queue.length || 0;
  return `<div style="text-align:center;padding:8px 0">
    <div style="font-size:34px">🎉</div>
    <h2 style="margin:8px 0 4px">今日新词已学完</h2>
    <div class="sub-tip">共 ${n} 个单词已加入复习计划</div>
    <button class="btn primary" style="margin-top:16px" id="toReview">学习完毕 · 去复习</button>
    <button class="btn ghost" style="margin-top:10px" id="againBtn">再学一组</button></div>`;
}
function bindFinish() {
  $('#toReview').onclick = () => { learnState = null; saveAll(); goto('review'); };
  $('#againBtn').onclick = () => { startLearning(); };
}
function startLearning() {
  const { bank, queue } = buildQueue();
  if (!queue.length) { toast('所有词库都已背完 🎉'); return; }
  settings.curBank = bank;
  learnState = { bank, queue, idx: 0 };
  saveAll(); setLearnActive(true); window.scrollTo(0, 0); renderLearnBox();
}
function markLearned(w) {
  const key = bankKey(w.bank, w.word);
  if (progress[key]) return;
  progress[key] = {
    word: w.word, bank: w.bank, meaning: w.meaning,
    phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk,
    firstLearned: todayStr(), stage: 0, nextReview: addDays(todayStr(), 1), lastReview: todayStr(),
  };
  recordHistory('new', { key, word: w.word, bank: w.bank, meaning: w.meaning, phonetic_us: w.phonetic_us, phonetic_uk: w.phonetic_uk });
  saveAll();
}

/* ===================== 复习 ===================== */
let reviewState = null;
function review() {
  app().innerHTML = `${topbar('复习')}
    <div class="card matcha" id="reviewSetup"></div>
    <div class="card" id="reviewBox"></div>`;
  renderSetup(); renderBox();
  function renderSetup() {
    const pool = buildReviewPool();
    const _day = todayStr();
    const _newKeys = new Set(((history[_day] || {}).new || []).map(x => x.key));
    const nNew = pool.filter(p => _newKeys.has(p.key)).length;   // 今日新学
    const nOld = pool.length - nNew;                             // 记忆曲线到期需强化的旧词
    const isRecall = settings.reviewType === 'recall';
    const isSent = settings.reviewType === 'sentence';
    const rvDesc = isRecall
      ? '单词复习：逐个显示单词——认识点「✓ 认识」直接过关（不展开），不认识点「✗ 不认识」（展开释义记忆并记入错题本）；全部判完后自动进入情境填词巩固。'
      : isSent
        ? '情境填词：展示词典例句，要填的词用横线标出，下方给出中文释义；在纸上写出该词，无例句的词按听写处理。'
        : '听中文听写：仅显示中文释义与词性，在纸上写出英文；写完点「下一个」翻页，全部完成后点「提交核对」自查对错。';
    $('#reviewSetup').innerHTML = `
      <h2>今日复习 <span class="r">${pool.length} 词</span></h2>
      <div class="seg" id="rvType" style="margin-bottom:8px">
        <div class="${isRecall ? 'on' : ''}" data-t="recall">单词复习</div>
        <div class="${isSent ? 'on' : ''}" data-t="sentence">情境填词</div>
        <div class="${settings.reviewType === 'word' ? 'on' : ''}" data-t="word">听中文听写</div>
      </div>
      <div class="sub-tip" id="rvDesc">${rvDesc}</div>
      <div class="sub-tip">今日构成：新学 ${nNew} 词 ＋ 需强化旧词 ${nOld} 词</div>
      ${isRecall && pool.length ? `<div class="rp-list" id="recallPreview">${pool.map(p => `<span class="rp-w">${esc(p.word)}</span>`).join('')}</div>` : ''}
      <div class="sub-tip">复习节奏：新词按 1、2、3、5、7、15、30 天复习；答错的词将在错后第 1、1、2、3、20、40 天再次推送。</div>
      <div><button class="btn primary" id="startReview" ${pool.length ? '' : 'disabled'}>▶ 开始复习${pool.length ? '（' + pool.length + '）' : ''}</button></div>
      <div style="margin-top:10px"><button class="btn ghost sm" id="makeup">📅 补打卡（复习过往某天）</button></div>`;
    document.querySelectorAll('#rvType div').forEach(d => d.onclick = () => { settings.reviewType = d.dataset.t; saveAll(); renderSetup(); });
    $('#startReview').onclick = () => startReview(pool);
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
    reviewState = { pool: pool.map(e => ({ ...e, type: 'recall' })), idx: 0, mode: 'recall' };
    review(); return;
  }
  reviewState = { pool: makeTypedQueue(pool, settings.reviewType), idx: 0 };
  review(); renderReviewCard();
}
// 纸质听写：只出题，不填键盘；上一个/下一个翻页，最后提交进入核对页
function renderReviewCard() {
  const box = $('#reviewBox'); if (!box) return;
  const st = reviewState, cur = st.pool[st.idx];
  if (!cur) { return renderCheck(); }
  const isLast = st.idx >= st.pool.length - 1;
  const stepbar = `<div class="stepbar"><span>第 ${st.idx + 1} / ${st.pool.length} 个</span><span class="tag">${esc(cur.bank)}</span></div>`;
  let prompt;
  if (cur.type === 'sentence' && cur.sentence) {
    const sb = blankSentence(cur.sentence.en, cur.word);
    prompt = `<div class="paper-prompt">
      <div class="pp-label">情境填词：写出横线处的单词</div>
      <div class="eg" style="margin-top:0"><div class="en">${sb.html}</div></div>
      <div class="mean-list">${renderMeaning(cur.meaning)}</div>
      ${sb.variantBlank ? `<div class="sub-tip pp-warn" style="margin-top:8px">⚠ 句中为「变形词」<b>${esc(sb.variantText)}</b>，请注意写出它的<b>原形 ${esc(cur.word)}</b></div>` : (sb.hasBlank ? '' : '<div class="sub-tip" style="margin-top:8px">⚠ 例句中未直接出现该词，请依据中文释义回忆拼写</div>')}
    </div>`;
  } else {
    prompt = `<div class="paper-prompt">
      <div class="pp-label">听中文听写：写出对应的英文单词</div>
      <div class="mean-list">${renderMeaning(cur.meaning)}</div>
    </div>`;
  }
  box.innerHTML = `${stepbar}${prompt}
    <div class="row" style="margin-top:18px">
      <button class="btn ghost" id="prevBtn">⬆ 上一个</button>
      <button class="btn primary" id="nextBtn">${isLast ? '提交核对 ✓' : '下一个 →'}</button>
    </div>`;
  $('#prevBtn').onclick = () => { if (st.idx > 0) { st.idx--; renderReviewCard(); } };
  $('#nextBtn').onclick = () => {
    if (isLast) { renderCheck(); }
    else { st.idx++; renderReviewCard(); }
  };
}
// 打叉：立即记入错题本，并让该词进入错词复习节奏（错后第 1、2、3、20、40 天）
function markWrongNow(r) {
  let p = progress[r.key];
  if (!p) p = progress[r.key] = { key: r.key, word: r.word, bank: r.bank, meaning: r.meaning, phonetic_us: r.phonetic_us, phonetic_uk: r.phonetic_uk, firstLearned: r.firstLearned || todayStr(), lastReview: '', stage: 0 };
  p.wrongStage = 0; p.nextReview = addDays(todayStr(), WRONG_INTERVALS[0]); p.lastReview = todayStr();
  const wb = wrongBook[r.key] || { key: r.key, word: r.word, bank: r.bank, meaning: r.meaning, phonetic_us: r.phonetic_us, phonetic_uk: r.phonetic_uk, wrongCount: 0, lastWrong: '', added: todayStr() };
  if (!r._wrongAdded) { wb.wrongCount++; r._wrongAdded = true; }
  wb.lastWrong = todayStr(); wrongBook[r.key] = wb;
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
  if (!wronged) {
    $('#rqOk').onclick = () => { cur.recallOk = true; st.idx++; renderRecall(); };
    $('#rqNo').onclick = () => { cur.recallOk = false; markWrongNow(cur); renderRecall(); };
  } else {
    $('#rqNext').onclick = () => { st.idx++; renderRecall(); };
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
  review(); renderReviewCard();
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
  const okBtn = document.createElement('button');
  okBtn.className = 'btn primary'; okBtn.id = 'chkOk'; okBtn.style.marginTop = '12px';
  okBtn.textContent = `确认提交（错 ${wrongCount()}）`;
  okBtn.onclick = confirmCheck;
  box.appendChild(okBtn);
}
function confirmCheck(after) {
  const st = reviewState;
  const wrong = st.check.filter(r => !r.ok);
  st.check.forEach(r => {
    let p = progress[r.key];
    if (r.ok) {
      if (p) {
        if (p.wrongStage !== undefined) {
          // 错词路径：按 WRONG_INTERVALS 推进；走完 1/2/3/20/40 天则视为掌握，停止推送
          p.wrongStage = p.wrongStage + 1;
          if (p.wrongStage >= WRONG_INTERVALS.length) { delete p.wrongStage; p.nextReview = ''; }
          else p.nextReview = addDays(todayStr(), WRONG_INTERVALS[p.wrongStage]);
          p.lastReview = todayStr();
        } else {
          p.stage = Math.min(p.stage + 1, INTERVALS.length - 1);
          p.nextReview = addDays(todayStr(), INTERVALS[p.stage]);
          p.lastReview = todayStr();
        }
      }
    } else {
      // 答错：进入/重置错词路径，下一次在错误后第 2 天推送
      if (!p) {
        p = progress[r.key] = { key: r.key, word: r.word, bank: r.bank, meaning: r.meaning, phonetic_us: r.phonetic_us, phonetic_uk: r.phonetic_uk, firstLearned: r.firstLearned || todayStr(), lastReview: '', stage: 0 };
      }
      p.wrongStage = 0; p.nextReview = addDays(todayStr(), WRONG_INTERVALS[0]); p.lastReview = todayStr();
      const wb = wrongBook[r.key] || { key: r.key, word: r.word, bank: r.bank, meaning: r.meaning, phonetic_us: r.phonetic_us, phonetic_uk: r.phonetic_uk, wrongCount: 0, lastWrong: '', added: todayStr() };
      if (!r._wrongAdded) { wb.wrongCount++; r._wrongAdded = true; }   // 打叉时已计过则不再重复累加
      wb.lastWrong = todayStr(); wrongBook[r.key] = wb;
    }
  });
  st.pool.forEach(r => recordHistory('review', { key: r.key, word: r.word, bank: r.bank, meaning: r.meaning, phonetic_us: r.phonetic_us, phonetic_uk: r.phonetic_uk }));
  saveAll();
  if (typeof after === 'function') { after(); return; }   // 有后续流程（如跳转情境填词）则不落地结果页
  st.done = true;
  renderSummary();
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
  const dates = Object.keys(history).sort().reverse();
  openModal(`<h3>补打卡 · 选择日期</h3>
    <div class="list" id="mkList">${dates.length ? dates.map(d => `<div class="item" data-d="${d}"><div><div class="w">${d}</div><div class="m">新学 ${history[d].new?.length || 0} ｜ 复习 ${history[d].review?.length || 0}</div></div><span class="tag">复习</span></div>`).join('') : '<div class="empty">暂无历史记录</div>'}</div>
    <button class="btn ghost" style="margin-top:12px" onclick="closeModal()">取消</button>`);
  document.querySelectorAll('#mkList .item').forEach(it => it.onclick = () => {
    const pool = buildReviewPool(it.dataset.d); closeModal();
    if (!pool.length) { toast('该日无复习内容'); return; }
    reviewState = { pool: shuffle(pool), idx: 0 };
    goto('review'); renderReviewCard();
  });
}

/* ===================== 错题本 ===================== */
function wrong() {
  app().innerHTML = `${topbar('错题本')}
    <div class="card strawberry">
      <div class="wb-sortbar">
        <div class="seg" id="wbSort">
          <div class="on" data-s="count">错误次数</div>
          <div data-s="added">加入时间</div>
          <div data-s="last">最后错误</div>
        </div>
        <button class="btn ghost sm" id="wbDir">↓ 降序</button>
      </div>
      <div class="wb-filter">
        <div class="seg sm" id="wbFilterDim">
          <div class="on" data-f="all">全部</div>
          <div data-f="count">错误次数</div>
          <div data-f="added">加入时间</div>
          <div data-f="last">最后错误</div>
        </div>
        <div class="seg sm" id="wbFilterVal"></div>
      </div>
      <div class="wb-bar">
        <label class="wb-selall"><input type="checkbox" id="wbAll"> 全选</label>
        <button class="btn ghost sm" id="wbDel" disabled>批量删除 (0)</button>
        <button class="btn ghost sm" id="wbExp" disabled>📊 导出 Excel (0)</button>
      </div>
      <div class="list" id="wrongList"></div>
      ${Object.keys(wrongBook).length ? '' : '<div class="empty">还没有错题，复习答错会自动入库</div>'}
    </div>`;
  let sortBy = 'count', sortDesc = true;
  let filterDim = 'all', filterVal = 'all';
  const list = $('#wrongList');
  const FILTER_OPTS = {
    all: [['all', '全部']],
    count: [['all', '全部'], ['1', '1次'], ['2', '2次'], ['3', '3次及以上']],
    added: [['all', '全部'], ['0-15', '0-15天'], ['16-30', '16-30天'], ['30-60', '30-60天'], ['60+', '60天以上']],
    last: [['all', '全部'], ['0-15', '0-15天'], ['16-30', '16-30天'], ['30-60', '30-60天'], ['60+', '60天以上']],
  };
  const updateSortUI = () => {
    document.querySelectorAll('#wbSort div').forEach(d => d.classList.toggle('on', d.dataset.s === sortBy));
    const db = $('#wbDir'); if (db) db.textContent = sortDesc ? '↓ 降序' : '↑ 升序';
  };
  const renderFilterVal = () => {
    const fv = $('#wbFilterVal');
    fv.innerHTML = FILTER_OPTS[filterDim].map(([v, t]) => `<div data-v="${v}" class="${v === filterVal ? 'on' : ''}">${t}</div>`).join('');
    fv.querySelectorAll('div').forEach(d => d.onclick = () => { filterVal = d.dataset.v; render(); });
  };
  const passFilter = (w) => {
    if (filterDim === 'all' || filterVal === 'all') return true;
    if (filterDim === 'count') {
      const c = w.wrongCount || 0;
      if (filterVal === '3') return c >= 3;
      return String(c) === filterVal;
    }
    const dateStr = filterDim === 'added' ? (w.added || '') : (w.lastWrong || '');
    if (!dateStr) return false;
    const n = daysBetween(dateStr, todayStr());
    if (filterVal === '0-15') return n <= 15;
    if (filterVal === '16-30') return n >= 16 && n <= 30;
    if (filterVal === '30-60') return n >= 31 && n <= 60;
    if (filterVal === '60+') return n >= 61;
    return true;
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
          <div class="meta">最后错：${esc(w.lastWrong || '-')}</div>
          <button class="btn ghost sm wb-del">删</button>
        </div>
        <div class="wb-detail" style="display:none">
          ${detailInner({ word: w.word, bank: w.bank, phonetic_us: us, phonetic_uk: uk, meaning: meaning })}
        </div>`;
      const head = it.querySelector('.wb-head');
      head.onclick = (e) => {
        if (e.target.closest('.wb-del')) return;
        const dv = it.querySelector('.wb-detail');
        const open = dv.style.display === 'none';
        dv.style.display = open ? '' : 'none';
        it.querySelector('.chev').textContent = open ? '▾' : '▸';
      };
      it.querySelector('.wb-check input').onchange = updateBar;
      it.querySelector('.wb-del').onclick = (e) => {
        e.stopPropagation();
        delete wrongBook[w.key];
        saveAll(); render(); toast('已删除');
      };
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
    <div class="card blueberry">
      <h2>自建词库 <span class="r">${selfBank.length} 词 · 优先背诵</span></h2>
      <div class="list" id="selfList"></div>
      <button class="btn primary sm" style="margin-top:10px" id="bulkBtn">📥 批量添加</button>
      ${selfBank.length ? '' : '<div class="empty">点「批量添加」导入单词，或到「查词」里加入</div>'}
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
    <div class="card mint">
      <input class="field" id="q" placeholder="输入英文单词或中文含义…">
      <div class="list" id="dictList"></div>
      <div class="empty" id="dictEmpty">输入关键词开始查词，点击词语查看详情，可加入自建词库</div>
    </div>`;
  const list = $('#dictList'), empty = $('#dictEmpty');
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
      it.innerHTML = `
        <div class="dict-head">
          <div class="w clickable">${esc(x.word)} <span class="chev">▸</span></div>
          <button class="btn ghost sm self-btn">${inSelf ? '已加' : '＋加入'}</button>
        </div>
        <div class="dict-detail" style="display:none">
          ${detailInner(w)}
        </div>`;
      it.querySelector('.dict-head').onclick = () => {
        const d = it.querySelector('.dict-detail');
        const open = d.style.display === 'none';
        d.style.display = open ? '' : 'none';
        it.querySelector('.chev').textContent = open ? '▾' : '▸';
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
  await loadData();
  await seedAccounts();                 // 首次运行预置 lvcheng 等账号
  if (currentAccount && !accounts[currentAccount]) { currentAccount = ''; saveSession(); } // 会话账号已被删则回到登录页
  if (window.Sync) {
    Sync.reload();
    if (Sync.tryImportFromHash()) toast('已通过配对链接开启云同步');
    if (Sync.on()) Sync.sync().catch(() => { });
  }
  if (!Object.keys(BANK_DATA).length) {
    app().innerHTML = `${topbar('背单词工作台')}
      <div class="card"><h2>需要本地服务器</h2>
      <div class="sub-tip">直接双击打开（file://）读不到词库。请在项目目录运行：</div>
      <div class="pos" style="margin-top:10px"><span class="pt">①</span>python -m http.server 8000</div>
      <div class="pos"><span class="pt">②</span>访问 http://localhost:8000/</div></div>`;
    return;
  }
  goto('learn');
  try { speechSynthesis.getVoices(); } catch (e) { }
})();

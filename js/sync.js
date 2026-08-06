// 宝宝成长工作台 - 云同步模块（GitHub Contents API + Web Crypto AES-GCM 加密）
// 数据加密后存公开仓库 sync/data.enc，无口令不可解；合并策略取并集，多设备收敛一致。
'use strict';

const SYNC_PATH = 'sync/data.enc';
const SYNC_REPO = '418024876-create/bb-workbench';

/* ====== 配置存取（存本设备 localStorage） ====== */
function lcGetConfig() {
  try { return JSON.parse(localStorage.getItem('lc_config') || 'null'); } catch (e) { return null; }
}
function lcSaveConfig(cfg) { localStorage.setItem('lc_config', JSON.stringify(cfg)); }
function lcGetPass() { return localStorage.getItem('lc_pass') || ''; }
function lcSavePass(p) { localStorage.setItem('lc_pass', p); }
function lcLastSync() { return localStorage.getItem('lc_last_sync') || ''; }
function lcSetLastSync(t) { localStorage.setItem('lc_last_sync', t); }

/* ====== 加密（PBKDF2 派生密钥 + AES-GCM） ====== */
function encBytes(b) { return btoa(String.fromCharCode.apply(null, b)); }
function decBytes(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

async function lcDeriveKey(pass) {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode('bb-workbench:' + pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('bb-workbench-sync-v1'), iterations: 100000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function lcEncrypt(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: encBytes(iv), ct: encBytes(new Uint8Array(ct)) };
}
async function lcDecrypt(key, payload) {
  const iv = decBytes(payload.iv);
  const ct = decBytes(payload.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ====== GitHub Contents API（api.github.com 支持 CORS） ====== */
async function ghApi(method, url, body) {
  const cfg = lcGetConfig();
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'bb-workbench' };
  if (cfg && cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const t = await res.json(); msg += ' ' + (t.message || '').slice(0, 120); } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}
function ghReadUrl(repo) { return 'https://api.github.com/repos/' + repo + '/contents/' + SYNC_PATH; }

async function ghFetchRemote() {
  const cfg = lcGetConfig();
  const d = await ghApi('GET', ghReadUrl(cfg.repo || SYNC_REPO));
  if (!d) return null;
  let raw = '';
  try { raw = decodeURIComponent(escape(atob(d.content))); } catch (e) { raw = atob(d.content); }
  return { sha: d.sha, data: JSON.parse(raw) };
}
async function ghPushRemote(payload, sha) {
  const cfg = lcGetConfig();
  const body = { message: 'sync ' + new Date().toISOString(), content: btoa(unescape(encodeURIComponent(JSON.stringify(payload)))) };
  if (sha) body.sha = sha;
  return ghApi('PUT', ghReadUrl(cfg.repo || SYNC_REPO), body);
}

/* ====== 合并策略（并集收敛） ====== */
function lcMergeStates(local, remote) {
  const out = Object.assign({}, local);
  out.known = Object.assign({}, remote.known || {}, local.known || {});
  Object.keys(remote.known || {}).forEach(k => {
    if (local.known && local.known[k] && local.known[k] < remote.known[k]) out.known[k] = local.known[k];
  });
  out.starLog = Array.from(new Set([...(local.starLog || []), ...(remote.starLog || [])])).sort();
  out.badges = Array.from(new Set([...(local.badges || []), ...(remote.badges || [])]));
  const days = new Set([...(Object.keys(local.checkins || {})), ...(Object.keys(remote.checkins || {}))]);
  out.checkins = {};
  days.forEach(d => {
    const a = local.checkins && local.checkins[d] ? local.checkins[d] : [];
    const b = remote.checkins && remote.checkins[d] ? remote.checkins[d] : [];
    out.checkins[d] = Array.from(new Set([...a, ...b]));
  });
  out.milestones = Object.assign({}, remote.milestones || {}, local.milestones || {});
  Object.keys(remote.milestones || {}).forEach(k => {
    if (local.milestones && local.milestones[k] && local.milestones[k] < remote.milestones[k]) out.milestones[k] = local.milestones[k];
  });
  out.stars = Math.max(local.stars || 0, remote.stars || 0);
  if (!out.profile && remote.profile) out.profile = remote.profile;
  return out;
}

/* ====== 同步状态 UI ====== */
function lcSetStatus(msg) {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = msg;
}
function lcRenderSyncUI() {
  const cfg = lcGetConfig();
  const bound = !!(cfg && cfg.token && lcGetPass());
  const block = document.getElementById('sync-block');
  if (!block) return;
  block.classList.toggle('bound', bound);
  const last = lcLastSync();
  document.getElementById('sync-last').textContent = bound
    ? (last ? '上次同步：' + new Date(last).toLocaleString('zh-CN', { hour12: false }) : '还没同步过')
    : '未绑定';
  document.getElementById('btn-sync-now').disabled = !bound;
}

/* ====== 同步主流程 ====== */
let lcSyncing = false;
async function lcSyncNow(manual) {
  if (lcSyncing) return;
  lcSyncing = true;
  try {
    await lcSyncInner(manual);
  } finally {
    lcSyncing = false;
  }
}
async function lcSyncInner(manual) {
  const cfg = lcGetConfig();
  const pass = lcGetPass();
  if (!cfg || !cfg.token || !pass) { lcSetStatus('先配置云同步'); return; }
  if (!window.crypto || !crypto.subtle) { lcSetStatus('此环境不支持加密，无法同步'); return; }
  lcSetStatus('同步中…');
  try {
    const key = await lcDeriveKey(pass);
    const remote = await ghFetchRemote();
    if (remote) {
      let remoteState = null;
      try { remoteState = await lcDecrypt(key, remote.data); }
      catch (e) { throw new Error('口令错误或云端数据损坏'); }
      state = lcMergeStates(state, remoteState);
      save();
    }
    const payload = await lcEncrypt(key, state);
    await ghPushRemote(payload, remote ? remote.sha : null);
    const now = new Date().toISOString();
    lcSetLastSync(now);
    lcSetStatus('✓ 同步成功 ' + new Date(now).toLocaleTimeString('zh-CN', { hour12: false }));
    lcRenderSyncUI();
    renderAll();
    if (manual) toast('☁️ 云同步完成');
  } catch (e) {
    lcSetStatus('✗ 同步失败：' + e.message);
    if (manual) toast('✗ 同步失败，看状态行');
  }
}

/* ====== 防抖自动同步 ====== */
let lcTimer = null;
function lcAutoSync() {
  const cfg = lcGetConfig();
  if (!cfg || !cfg.token || !lcGetPass()) return;
  clearTimeout(lcTimer);
  lcTimer = setTimeout(() => lcSyncNow(false), 20000);
}

/* ====== 配置绑定 ====== */
function lcOpenConfig() {
  const cfg = lcGetConfig() || {};
  document.getElementById('lc-token').value = '';
  document.getElementById('lc-pass').value = '';
  document.getElementById('lc-repo').value = cfg.repo || SYNC_REPO;
  document.getElementById('modal-sync').classList.remove('hidden');
}
function lcSaveConfigForm() {
  const token = document.getElementById('lc-token').value.trim();
  const pass = document.getElementById('lc-pass').value;
  let repo = document.getElementById('lc-repo').value.trim() || SYNC_REPO;
  if (!token || !pass) { toast('GitHub Token 和同步口令都要填'); return; }
  lcSaveConfig({ token: token, repo: repo });
  lcSavePass(pass);
  document.getElementById('modal-sync').classList.add('hidden');
  lcRenderSyncUI();
  toast('☁️ 已绑定，开始同步');
  lcSyncNow(true);
}
function lcUnbind() {
  if (!confirm('解绑云同步？本地数据保留，云端数据保留。')) return;
  localStorage.removeItem('lc_config');
  localStorage.removeItem('lc_pass');
  localStorage.removeItem('lc_last_sync');
  lcRenderSyncUI();
  lcSetStatus('已解绑');
}

/* ====== 初始化 ====== */
function lcInit() {
  lcRenderSyncUI();
  document.getElementById('btn-sync-config').addEventListener('click', lcOpenConfig);
  document.getElementById('btn-sync-save').addEventListener('click', lcSaveConfigForm);
  document.getElementById('btn-sync-now').addEventListener('click', () => lcSyncNow(true));
  document.getElementById('btn-sync-unbind').addEventListener('click', lcUnbind);
  document.getElementById('btn-sync-cancel').addEventListener('click', () => document.getElementById('modal-sync').classList.add('hidden'));
  if (lcGetConfig() && lcGetPass()) setTimeout(() => lcSyncNow(false), 1500);
}

// 页面加载完成后初始化云同步 UI
lcInit();

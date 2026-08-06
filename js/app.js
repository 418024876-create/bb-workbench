// 宝宝成长工作台 v1.0 - 核心逻辑
'use strict';

/* ====== 常量 ====== */
const LS_KEY = 'bb_workbench_v1';
const AVATARS = ['👶', '👧', '👦', '🐰', '🐻', '🐼', '🦁', '🐨'];
const ROUND_SIZE = 10; // 每轮闪卡张数

const $ = id => document.getElementById(id);

/* ====== 存储层（localStorage，纯本地） ====== */
function defaultState() {
  return {
    profile: null,      // { name, birth, gender, avatar }
    known: {},          // 'catId:idx' -> 'YYYY-MM-DD'
    stars: 0,           // 累计学习之星
    starLog: [],        // 得星日期记录 'YYYY-MM-DD'（周报用）
    badges: [],         // 已解锁 badge id
    checkins: {},       // 'YYYY-MM-DD' -> ['flash','song','outdoor']
    milestones: {}      // 'ageIdx:itemIdx' -> 'YYYY-MM-DD'
  };
}
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { console.warn('存储读取失败', e); }
  return defaultState();
}
let state = load();
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { console.warn('存储写入失败', e); }
  if (typeof lcAutoSync === 'function') lcAutoSync(); // 云同步防抖钩子
}

/* ====== 日期工具 ====== */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dateStrOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function calcAge(birthStr) {
  const b = new Date(birthStr);
  if (isNaN(b.getTime())) return { y: 0, m: 0, months: 0 };
  const n = new Date();
  let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
  if (n.getDate() < b.getDate()) months--;
  if (months < 0) months = 0;
  return { y: Math.floor(months / 12), m: months % 12, months };
}

/* ====== 语音 TTS（中文） ====== */
let voices = [];
function loadVoices() { try { voices = window.speechSynthesis.getVoices() || []; } catch (e) {} }
if (window.speechSynthesis) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}
function zhVoice() {
  return voices.find(v => /zh[-_]CN/i.test(v.lang))
      || voices.find(v => /^zh/i.test(v.lang))
      || null;
}
function speak(text, rate) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = zhVoice();
  if (v) u.voice = v;
  u.lang = 'zh-CN';
  u.rate = rate || 0.85;
  u.pitch = 1.05;
  window.speechSynthesis.speak(u);
}

/* ====== 通用 UI ====== */
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function celebrate(title, sub) {
  $('celebrate-text').textContent = title;
  $('celebrate-sub').textContent = sub || '';
  const c = $('celebrate');
  c.classList.add('show');
  setTimeout(() => c.classList.remove('show'), 1600);
}

/* ====== 统计 ====== */
function knownCount() { return Object.keys(state.known).length; }
function knownCountOf(catId) {
  return Object.keys(state.known).filter(k => k.startsWith(catId + ':')).length;
}
function calcStreak() {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const c = state.checkins[dateStrOffset(-i)];
    if (c && c.length) streak++;
    else if (i === 0) continue; // 今天还没打卡，从昨天往前算
    else break;
  }
  return streak;
}
function todayDone() { return (state.checkins[todayStr()] || []).slice(); }

/* ====== 勋章 ====== */
function checkBadges() {
  const owned = new Set(state.badges);
  const newly = [];
  for (const b of BADGES) {
    let ok = false;
    if (b.id === 'b_star1') ok = state.stars >= 1;
    else if (b.id === 'b_star5') ok = state.stars >= 5;
    else if (b.id === 'b_star20') ok = state.stars >= 20;
    else if (b.id === 'b_card10') ok = knownCount() >= 10;
    else if (b.id === 'b_card50') ok = knownCount() >= 50;
    else if (b.id === 'b_day3') ok = calcStreak() >= 3;
    if (ok && !owned.has(b.id)) newly.push(b);
  }
  if (newly.length) {
    newly.forEach(b => state.badges.push(b.id));
    save();
    newly.forEach((b, i) => setTimeout(() => toast('🎉 解锁勋章「' + b.name + '」！'), i * 1200));
  }
}

/* ====== Tab 切换 ====== */
const TABS = ['today', 'learn', 'grow', 'me'];
function switchTab(tab) {
  TABS.forEach(t => {
    $('tab-' + t).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

/* ====== 渲染：今日 ====== */
function renderToday() {
  const h = new Date().getHours();
  let hi, emoji, sub;
  if (h >= 5 && h < 11) { hi = '早上好！'; emoji = '🌞'; sub = '新的一天，从闪卡开始'; }
  else if (h >= 11 && h < 14) { hi = '中午好！'; emoji = '🍚'; sub = '吃饱了学两分钟'; }
  else if (h >= 14 && h < 18) { hi = '下午好！'; emoji = '🌤️'; sub = '一起来认识新朋友'; }
  else { hi = '晚上好！'; emoji = '🌙'; sub = '睡前听首儿歌吧'; }
  $('hello-emoji').textContent = emoji;
  $('hello-title').textContent = hi;
  $('hello-sub').textContent = sub;

  const done = todayDone();
  const labels = { flash: '✓ 完成', song: '✓ 完成', outdoor: '✓ 完成' };
  const btnText = { flash: '开始', song: '播放', outdoor: '打卡' };
  document.querySelectorAll('.task-card').forEach(card => {
    const t = card.dataset.task;
    const isD = done.includes(t);
    card.classList.toggle('done', isD);
    const btn = card.querySelector('.task-btn');
    btn.textContent = isD ? labels[t] : btnText[t];
    btn.classList.toggle('done-btn', isD);
  });

  // 今日之星
  const needNext = (state.stars % 5 === 0 && state.stars > 0) ? 5 : (5 - (state.stars % 5));
  $('star-count').textContent = '⭐ × ' + state.stars;
  $('star-fill').style.width = ((state.stars % 5) / 5 * 100) + '%';
  const toNext = needNext === 5 ? 5 : needNext;
  $('star-hint').textContent = '再得 ' + toNext + ' 颗星，解锁下一枚勋章！';
  renderWeeklyCard();
}

/* ====== 本周周报 ====== */
function weekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;            // 周一=0
  const mon = new Date(now); mon.setDate(now.getDate() - day);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { start: fmt(mon), end: fmt(sun) };
}
function inWeek(d) { const r = weekRange(); return d >= r.start && d <= r.end; }

function buildWeeklyReport() {
  const r = weekRange();
  const days = new Set();               // 学习/打卡天数
  const songDays = new Set();
  const outdoorDays = new Set();
  Object.entries(state.checkins).forEach(([date, tasks]) => {
    if (date >= r.start && date <= r.end && tasks.length) {
      days.add(date);
      if (tasks.includes('song')) songDays.add(date);
      if (tasks.includes('outdoor')) outdoorDays.add(date);
    }
  });
  const newKnown = {};                  // 本周新认识：分类 -> 数量
  Object.entries(state.known).forEach(([key, date]) => {
    if (inWeek(date)) {
      const catId = key.split(':')[0];
      newKnown[catId] = (newKnown[catId] || 0) + 1;
    }
  });
  let starCount = 0;
  if (Array.isArray(state.starLog)) starCount = state.starLog.filter(d => inWeek(d)).length;
  let mileCount = 0;
  Object.values(state.milestones).forEach(d => { if (inWeek(d)) mileCount++; });
  return {
    days: days.size, songDays: songDays.size, outdoorDays: outdoorDays.size,
    newKnown, newKnownTotal: Object.values(newKnown).reduce((a, b) => a + b, 0),
    starCount, mileCount, range: r
  };
}

function renderWeeklyCard() {
  const rpt = buildWeeklyReport();
  $('wk-days').textContent = rpt.days;
  $('wk-known').textContent = rpt.newKnownTotal;
  $('wk-stars').textContent = rpt.starCount;
}

function renderWeeklyModal() {
  const rpt = buildWeeklyReport();
  const catName = id => { const c = FLASH_CATEGORIES.find(c => c.id === id); return c ? c.icon + ' ' + c.name : id; };
  const fmtShort = d => { const p = d.split('-'); return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日'; };
  $('weekly-date').textContent = fmtShort(rpt.range.start) + ' ~ ' + fmtShort(rpt.range.end);
  $('wkm-days').textContent = rpt.days; $('wkm-known').textContent = rpt.newKnownTotal;
  $('wkm-song').textContent = rpt.songDays; $('wkm-outdoor').textContent = rpt.outdoorDays;
  $('wkm-stars').textContent = rpt.starCount; $('wkm-mile').textContent = rpt.mileCount;
  // 分类增量
  const catsEl = $('weekly-cats');
  catsEl.innerHTML = '';
  if (rpt.newKnownTotal === 0) {
    catsEl.innerHTML = '<div class="weekly-empty">本周还没认识新卡片，学起来吧！💪</div>';
  } else {
    Object.entries(rpt.newKnown).sort((a, b) => b[1] - a[1]).forEach(([id, n]) => {
      const row = document.createElement('div');
      row.className = 'weekly-cat-row';
      row.innerHTML = '<span>' + catName(id) + '</span><span class="weekly-cat-num">+' + n + '</span>';
      catsEl.appendChild(row);
    });
  }
  // 本周足迹（周一~周日）
  const daysEl = $('weekly-days');
  daysEl.innerHTML = '';
  const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const mon = new Date(rpt.range.start);
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const tasks = state.checkins[key] || [];
    const row = document.createElement('div');
    row.className = 'weekly-day-row' + (tasks.length ? ' active' : '');
    const icons = { flash: '🃏闪卡', song: '🎵儿歌', outdoor: '🌳户外' };
    const desc = tasks.length ? tasks.map(t => icons[t] || t).join(' ') : (key === todayStr() ? '今天还没学' : '休息');
    row.innerHTML = '<span class="weekly-day-name">' + names[i] + '</span><span class="weekly-day-desc">' + desc + '</span>';
    daysEl.appendChild(row);
  }
}

/* ====== 渲染：学一学 ====== */
function renderLearn() {
  const grid = $('cat-grid');
  grid.innerHTML = '';
  FLASH_CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-card';
    btn.innerHTML = '<div class="cat-icon" style="background:' + cat.color + '33">' + cat.icon + '</div>'
      + '<div class="cat-name">' + cat.name + '</div>'
      + '<div class="cat-meta">' + knownCountOf(cat.id) + ' / ' + cat.cards.length + ' 认识</div>';
    btn.addEventListener('click', () => openFlash(cat.id));
    grid.appendChild(btn);
  });
}

/* ====== 闪卡流程 ====== */
let deck = [];          // [{card, key}]
let flashPos = 0;
let currentCatId = 'animal';
let exitTimer = null;
let touchX = 0;

function buildDeck(cat) {
  const known = new Set(Object.keys(state.known).filter(k => k.startsWith(cat.id + ':')));
  const all = cat.cards.map((card, idx) => ({ card, key: cat.id + ':' + idx }));
  const fresh = all.filter(c => !known.has(c.key));
  const rest = all.filter(c => known.has(c.key));
  const result = [...fresh, ...rest].slice(0, ROUND_SIZE);
  return { deck: result, freshCount: fresh.length };
}

function openFlash(catId) {
  const cat = FLASH_CATEGORIES.find(c => c.id === catId);
  if (!cat) return;
  currentCatId = catId;
  const built = buildDeck(cat);
  if (!built.deck.length) { toast('这个分类还没有卡片'); return; }
  if (built.freshCount === 0) toast('都认识啦，复习一遍 ✨');
  deck = built.deck;
  flashPos = 0;
  $('app').classList.add('hidden');
  $('screen-flash').classList.remove('hidden');
  renderFlashCard();
}

function closeFlash() {
  try { window.speechSynthesis.cancel(); } catch (e) {}
  $('screen-flash').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderToday(); renderLearn(); renderGrow(); renderMe();
}

function renderFlashCard() {
  const { card, key } = deck[flashPos];
  $('flash-cat').textContent = FLASH_CATEGORIES.find(c => c.id === currentCatId).name;
  $('flash-progress').textContent = (flashPos + 1) + ' / ' + deck.length;
  $('flash-emoji').textContent = card.e || '✏️';
  $('flash-word').textContent = card.w;
  $('flash-py').textContent = card.p || '';
  const dots = $('flash-dots');
  if (card.d) {
    dots.innerHTML = '';
    for (let i = 0; i < card.d; i++) {
      const s = document.createElement('span');
      s.textContent = '●';
      s.style.background = 'transparent';
      s.style.color = '#5FC4A6';
      s.style.fontSize = '20px';
      s.style.width = 'auto';
      s.style.height = 'auto';
      dots.appendChild(s);
    }
    dots.classList.remove('hidden');
  } else {
    dots.classList.add('hidden');
  }
  speak(card.w);
}

function nextFlash(result) {
  const cardEl = $('flash-card');
  cardEl.classList.add(result === 'yes' ? 'slide-l' : 'slide-r');
  setTimeout(() => {
    if (result === 'yes') {
      state.known[deck[flashPos].key] = todayStr();
      save();
    }
    flashPos++;
    if (flashPos >= deck.length) { finishRound(); return; }
    cardEl.classList.remove('slide-l', 'slide-r');
    renderFlashCard();
  }, 180);
}

function finishRound() {
  state.stars++;
  state.starLog.push(todayStr());
  const arr = state.checkins[todayStr()] || [];
  if (!arr.includes('flash')) arr.push('flash');
  state.checkins[todayStr()] = arr;
  save();
  celebrate('⭐ +1 学习之星', '宝宝真棒，又学了一轮！');
  checkBadges();
  setTimeout(() => closeFlash(), 1700);
}

/* ====== 渲染：成长 ====== */
function renderGrow() {
  $('grow-milestone-num').textContent = Object.keys(state.milestones).length;
  $('grow-known-num').textContent = knownCount();
  $('grow-streak-num').textContent = calcStreak();
  renderMilestones();
}

function renderMilestones() {
  const list = $('milestone-list');
  list.innerHTML = '';
  MILESTONES.forEach((group, gi) => {
    const div = document.createElement('div');
    div.className = 'milestone-group';
    let html = '<div class="milestone-age">' + group.age + ' · ' + group.items.length + ' 项</div><div class="milestone-items">';
    group.items.forEach((item, ii) => {
      const key = gi + ':' + ii;
      const date = state.milestones[key];
      const done = !!date;
      html += '<div class="milestone-item' + (done ? ' done' : '') + '" data-key="' + key + '">'
        + '<span class="m-text">' + item + (date ? ' <span style="color:var(--dim);font-size:11px">' + date + '</span>' : '') + '</span>'
        + '<span class="m-check">✓</span></div>';
    });
    html += '</div>';
    div.innerHTML = html;
    list.appendChild(div);
  });
  list.querySelectorAll('.milestone-item').forEach(item => {
    item.addEventListener('click', () => {
      const key = item.dataset.key;
      if (state.milestones[key]) delete state.milestones[key];
      else state.milestones[key] = todayStr();
      save();
      renderGrow();
      checkBadges();
    });
  });
}

/* ====== 渲染：我的 ====== */
function renderMe() {
  const p = state.profile;
  $('me-avatar').textContent = p.avatar;
  $('me-name').textContent = p.name;
  const age = calcAge(p.birth);
  $('me-meta').textContent = age.y + '岁' + age.m + '个月 · ' + (p.gender === 'boy' ? '男宝' : '女宝') + ' · ' + p.birth;
  renderBadges();
  renderSongs();
}

function renderBadges() {
  const wall = $('badge-wall');
  wall.innerHTML = '';
  BADGES.forEach(b => {
    const owned = state.badges.includes(b.id);
    const div = document.createElement('div');
    div.className = 'badge' + (owned ? '' : ' locked');
    div.innerHTML = '<div class="b-icon">' + b.icon + '</div><div class="b-name">' + b.name + '</div>';
    div.title = b.desc;
    wall.appendChild(div);
  });
}

function renderSongs() {
  const list = $('song-list');
  list.innerHTML = '';
  SONGS.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'song-item';
    div.innerHTML = '<span class="song-name">' + s.title + '</span><span class="song-play">▶️</span>';
    div.addEventListener('click', () => openSong(i));
    list.appendChild(div);
  });
}

/* ====== 儿歌 ====== */
function openSong(idx) {
  const song = SONGS[idx];
  $('song-title').textContent = song.title;
  const box = $('song-lyrics');
  box.innerHTML = '';
  song.lyrics.forEach(line => {
    const d = document.createElement('div');
    d.className = 'line';
    d.textContent = line;
    box.appendChild(d);
  });
  $('modal-song').classList.remove('hidden');
  $('modal-song').dataset.idx = idx;
}
function singSong() {
  const idx = parseInt($('modal-song').dataset.idx, 10);
  const song = SONGS[idx];
  const lines = document.querySelectorAll('#song-lyrics .line');
  try { window.speechSynthesis.cancel(); } catch (e) {}
  lines.forEach(l => l.classList.remove('playing'));
  let i = 0;
  function next() {
    if (i >= lines.length) { lines.forEach(l => l.classList.remove('playing')); return; }
    lines[i].classList.add('playing');
    const u = new SpeechSynthesisUtterance(lines[i].textContent);
    const v = zhVoice();
    if (v) u.voice = v;
    u.lang = 'zh-CN';
    u.rate = 0.8;
    u.pitch = 1.05;
    u.onend = () => { lines[i].classList.remove('playing'); i++; next(); };
    window.speechSynthesis.speak(u);
  }
  next();
}
function closeSong() {
  try { window.speechSynthesis.cancel(); } catch (e) {}
  $('modal-song').classList.add('hidden');
  const arr = state.checkins[todayStr()] || [];
  if (!arr.includes('song')) arr.push('song');
  state.checkins[todayStr()] = arr;
  save();
  toast('🎵 儿歌打卡成功');
  renderToday(); renderGrow(); checkBadges();
}

/* ====== 档案 ====== */
function renderAvatarPicks() {
  ['avatar-pick', 'avatar-pick-edit'].forEach(id => {
    const box = $(id);
    if (!box) return;
    box.innerHTML = '';
    AVATARS.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'av';
      btn.textContent = a;
      btn.addEventListener('click', () => {
        box.querySelectorAll('.av').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        box.dataset.avatar = a;
      });
      box.appendChild(btn);
    });
  });
}
function selectedAvatar(boxId) {
  const box = $(boxId);
  const sel = box.querySelector('.av.sel');
  return sel ? sel.textContent : AVATARS[0];
}

function initSetup() {
  renderAvatarPicks();
  const def = new Date();
  def.setFullYear(def.getFullYear() - 2);
  const maxD = new Date();
  $('inp-birth').max = maxD.toISOString().split('T')[0];
  $('inp-birth').value = def.toISOString().split('T')[0];
  document.querySelectorAll('#screen-setup .g-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#screen-setup .g-btn').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
    });
  });
}

$('btn-start').addEventListener('click', () => {
  const name = $('inp-name').value.trim();
  const birth = $('inp-birth').value;
  if (!name) { toast('给宝宝起个小名吧'); return; }
  if (!birth) { toast('选一下出生日期'); return; }
  const gSel = document.querySelector('#screen-setup .g-btn.sel');
  const gender = gSel ? gSel.dataset.g : 'boy';
  state.profile = { name, birth, gender, avatar: selectedAvatar('avatar-pick') };
  save();
  $('screen-setup').classList.add('hidden');
  $('app').classList.remove('hidden');
  init();
});

/* ====== 档案编辑 ====== */
function openProfileEdit() {
  const p = state.profile;
  $('inp-name-edit').value = p.name;
  $('inp-birth-edit').value = p.birth;
  const box = $('avatar-pick-edit');
  box.querySelectorAll('.av').forEach(b => {
    b.classList.toggle('sel', b.textContent === p.avatar);
  });
  document.querySelectorAll('#modal-profile .g-btn').forEach(b => {
    b.classList.toggle('sel', b.dataset.g === p.gender);
  });
  $('modal-profile').classList.remove('hidden');
}
$('btn-edit-profile').addEventListener('click', openProfileEdit);
$('btn-save-profile').addEventListener('click', () => {
  const name = $('inp-name-edit').value.trim();
  const birth = $('inp-birth-edit').value;
  if (!name) { toast('名字不能空'); return; }
  const gSel = document.querySelector('#modal-profile .g-btn.sel');
  state.profile = {
    name, birth, gender: gSel ? gSel.dataset.g : state.profile.gender,
    avatar: selectedAvatar('avatar-pick-edit')
  };
  save();
  $('modal-profile').classList.add('hidden');
  init();
});
$('btn-cancel-profile').addEventListener('click', () => $('modal-profile').classList.add('hidden'));
document.querySelectorAll('#modal-profile .g-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#modal-profile .g-btn').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
  });
});

/* ====== 数据导出 / 重置 ====== */
$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '宝宝成长数据备份_' + todayStr() + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('📤 备份已导出');
});
$('btn-reset').addEventListener('click', () => {
  if (confirm('确定清空所有数据吗？此操作不可恢复！')) {
    localStorage.removeItem(LS_KEY);
    location.reload();
  }
});

/* ====== 周报弹层 ====== */
$('btn-weekly').addEventListener('click', () => { renderWeeklyModal(); $('modal-weekly').classList.remove('hidden'); });
$('btn-weekly-close').addEventListener('click', () => $('modal-weekly').classList.add('hidden'));

/* ====== 今日任务按钮 ====== */
$('task-flash-btn').addEventListener('click', () => {
  const done = todayDone();
  if (done.includes('flash')) { toast('今天闪卡已经学完啦 🎉'); return; }
  openFlash(currentCatId);
});
$('task-song-btn').addEventListener('click', () => {
  const done = todayDone();
  if (done.includes('song')) { toast('今天儿歌已经听啦 🎵'); return; }
  openSong(0);
});
$('task-outdoor-btn').addEventListener('click', () => {
  const done = todayDone();
  if (done.includes('outdoor')) { toast('户外活动已经打卡啦 🌳'); return; }
  const arr = state.checkins[todayStr()] || [];
  arr.push('outdoor');
  state.checkins[todayStr()] = arr;
  save();
  toast('🌳 户外打卡成功！带娃晒太阳去');
  renderToday(); renderGrow(); checkBadges();
});

/* ====== 儿歌弹层按钮 ====== */
$('song-read').addEventListener('click', singSong);
$('song-close').addEventListener('click', closeSong);

/* ====== 闪卡交互 ====== */
$('flash-card').addEventListener('click', () => speak(deck[flashPos].card.w));
$('flash-speak').addEventListener('click', () => speak(deck[flashPos].card.w));
$('flash-yes').addEventListener('click', () => nextFlash('yes'));
$('flash-no').addEventListener('click', () => nextFlash('no'));

// 长按退出（误触锁定）
$('flash-exit').addEventListener('pointerdown', () => {
  const btn = $('flash-exit');
  btn.classList.add('arming');
  btn.textContent = '再按2秒…';
  exitTimer = setTimeout(() => { closeFlash(); }, 2000);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => {
  $('flash-exit').addEventListener(ev, () => {
    clearTimeout(exitTimer);
    const btn = $('flash-exit');
    btn.classList.remove('arming');
    btn.textContent = '🔒 退出';
  });
});

// 左右滑动翻卡
$('flash-card').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$('flash-card').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) nextFlash(dx < 0 ? 'no' : 'no'); // 滑动=浏览下一张，不标记
});

// 桌面键盘：←→ 翻卡，Enter 认识，空格 朗读
document.addEventListener('keydown', e => {
  if ($('screen-flash').classList.contains('hidden')) return;
  if (e.key === 'ArrowRight') nextFlash('no');
  else if (e.key === 'ArrowLeft') nextFlash('no');
  else if (e.key === 'Enter') nextFlash('yes');
  else if (e.key === ' ') { e.preventDefault(); speak(deck[flashPos].card.w); }
});

/* ====== Tab 按钮 ====== */
document.querySelectorAll('.tab-btn').forEach(b => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

/* ====== 初始化 ====== */
function init() {
  const p = state.profile;
  $('home-avatar').textContent = p.avatar;
  $('home-name').textContent = p.name;
  const age = calcAge(p.birth);
  $('home-age').textContent = age.y + '岁' + age.m + '个月';
  const d = new Date();
  const weeks = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  $('date-chip').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + weeks[d.getDay()];
  switchTab('today');
  renderToday(); renderLearn(); renderGrow(); renderMe();
  checkBadges();
}

// 云同步合并后全量刷新
function renderAll() { renderToday(); renderLearn(); renderGrow(); renderMe(); checkBadges(); }

// PWA：注册 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 注册失败', e));
  });
  // SW 更新接管后自动刷新，避免用户停留在旧缓存版
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}

// 启动
if (state.profile) {
  $('screen-setup').classList.add('hidden');
  $('app').classList.remove('hidden');
  init();
} else {
  initSetup();
}

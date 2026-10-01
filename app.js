/*
 * XOLVE game: screens, answer checking, timer, statistics, archive and sharing.
 * Needs generator.js to be loaded first.
 */
(() => {
'use strict';
const { DIFFICULTIES, MAX_ATTEMPTS, buildPuzzle, dailyPuzzle, dayInfo, infoFromEpoch } = XolveGenerator;
const $ = (id) => document.getElementById(id);
const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

/* ---------- storage (localStorage, with in-memory fallback) ---------- */
const mem = {};
const store = {
  get(k) { try { const v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } catch (e) {} return k in mem ? mem[k] : null; },
  set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const STATS_KEY = 'xolve:stats';
function loadStats() {
  const base = { played: 0, won: 0, current: 0, max: 0, lastWinDay: null, lastPlayedDay: null, totalAttempts: 0, totalTime: 0,
    byDiff: { easy: { played: 0, won: 0 }, medium: { played: 0, won: 0 }, hard: { played: 0, won: 0 }, expert: { played: 0, won: 0 } } };
  const s = store.get(STATS_KEY);
  return s ? Object.assign(base, s, { byDiff: Object.assign(base.byDiff, s.byDiff || {}) }) : base;
}
function liveStreak(st, today) {
  return st.lastWinDay !== null && today - st.lastWinDay <= 1 ? st.current : 0;
}

/* ---------- notation rendering ---------- */
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function toHTML(s) {
  return esc(s)
    .replace(/x/g, '\u0001')
    .replace(/\{([^|}]*)\|([^}]*)\}/g, '<span class="frac"><span class="fn">$1</span><span class="fd">$2</span></span>')
    .replace(/\u0001/g, '<var>x</var>');
}
function toText(s) {
  return s.replace(/\{([^|}]*)\|([^}]*)\}/g, (m, a, b) => (a.includes(' ') ? `(${a})` : a) + '/' + (b.includes(' ') ? `(${b})` : b));
}
function fmtTime(ms) {
  const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

/* ---------- trusted clock ----------
   The day comes from the web server's clock (the Date header of this page),
   read in the player's own time zone. Changing the device clock doesn't unlock tomorrow. */
let clockOffset = 0;
const nowDate = () => new Date(Date.now() + clockOffset);
async function syncClock() {
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 3000);
    const t0 = Date.now();
    const res = await fetch(location.href.split('#')[0], { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
    const t1 = Date.now(); clearTimeout(timer);
    const server = Date.parse(res.headers.get('Date') || '');
    if (!isNaN(server)) clockOffset = server + 500 + (t1 - t0) / 2 - t1; // Date header is whole seconds
  } catch (e) { /* offline or not served over HTTP: fall back to the device clock */ }
}
const fmtDay = (info, opts) => new Date(info.epochDay * 864e5).toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opts));

/* ---------- game state ---------- */
let mode = 'daily';          // daily | archive | practice
let curGame = 'algebra';     // algebra | lattice
let practiceLevel = store.get('xolve:practiceLevel') || 'medium';
let latticeLevel = store.get('xolve:latticeLevel') || 'medium';
let today, game, lastTick = 0, saveCounter = 0, justFinished = false, revealArmed = false;

function loadDay(info, kind) {
  const key = 'xolve:day:' + info.iso;
  const saved = store.get(key);
  game = { puzzle: dailyPuzzle(info), kind, daily: kind === 'daily', info, key,
    attempts: saved ? saved.attempts : [], status: saved ? saved.status : 'playing', elapsed: saved ? saved.elapsed : 0,
    archived: saved ? !!saved.archived : kind === 'archive' };
  justFinished = false;
  showView('sheet');
  render();
}
function startDaily() { today = dayInfo(nowDate()); loadDay(today, 'daily'); }
function startArchivePuzzle(epochDay) {
  if (epochDay >= today.epochDay) return startDaily();
  loadDay(infoFromEpoch(epochDay), 'archive');
}
function startPractice() {
  today = dayInfo(nowDate());
  const seed = (Math.random() * 4294967296) >>> 0;
  const puzzle = buildPuzzle(seed, practiceLevel, { id: 'practice', date: null });
  game = { puzzle, kind: 'practice', daily: false, attempts: [], status: 'playing', elapsed: 0 };
  justFinished = false;
  showView('sheet');
  render();
}
function saveGame() {
  if (game && game.key) store.set(game.key, { attempts: game.attempts, status: game.status, elapsed: Math.round(game.elapsed), archived: game.archived });
}

/* ---------- views ---------- */
function showView(v) {
  $('lattice').hidden = v !== 'lattice';
  $('archive').hidden = v !== 'archive';
  $('sheet').hidden = v !== 'sheet';
  $('btnBack').hidden = !(v === 'sheet' && game && game.kind === 'archive');
}
function archiveStatus(info) {
  const s = store.get('xolve:day:' + info.iso);
  if (!s || (!s.attempts.length && s.status === 'playing')) return ['', 'Play'];
  if (s.status === 'won') return ['won', `Solved in ${s.attempts.length}`];
  if (s.status === 'lost') return ['lost', 'Not solved'];
  return ['', 'In progress'];
}
function renderArchive() {
  showView('archive');
  const first = today.epochDay - today.number + 1;
  const days = [];
  for (let e = today.epochDay; e >= first; e--) days.push(infoFromEpoch(e));
  const hasPast = days.length > 1;
  $('archEmpty').hidden = hasPast;
  $('archList').hidden = !hasPast;
  if (!hasPast) {
    $('archEmptyText').textContent = `Past puzzles appear here once their day has passed. Today's is #${today.number}.`;
    return;
  }
  const lat = curGame === 'lattice';
  $('archList').innerHTML = days.map((d) => {
    const [cls, label] = lat ? XolveLatticeUI.archiveStatus(d) : archiveStatus(d);
    const lvl = lat ? XolveLatticeUI.levelIndex(d.epochDay) : DIFFICULTIES.indexOf(d.difficulty);
    const lvlName = lat ? XolveLatticeUI.levelName(d.epochDay) : LEVEL_NAMES[d.difficulty];
    const pips = [0, 1, 2, 3].map((i) => `<span${i <= lvl ? ' class="on"' : ''}></span>`).join('');
    const when = d.epochDay === today.epochDay ? 'Today' : fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' });
    return `<li><button class="arch-row" data-epoch="${d.epochDay}" aria-label="${lat ? 'Lattice' : 'Puzzle'} ${d.number}, ${when}, ${lvlName}, ${label}"><span class="an">#${d.number}</span><span>${when}</span><span class="pips" aria-hidden="true">${pips}</span><span class="as ${cls}">${label}</span></button></li>`;
  }).join('');
}

/* ---------- rendering ---------- */
function render() {
  const p = game.puzzle;
  const lvl = DIFFICULTIES.indexOf(p.difficulty);
  $('puzzleLabel').textContent = game.kind === 'practice' ? 'Practice' : `Puzzle #${p.id}`;
  $('levelLabel').textContent = game.kind === 'daily'
    ? `${fmtDay(game.info, { weekday: 'long' })}, ${LEVEL_NAMES[p.difficulty].toLowerCase()}`
    : game.kind === 'archive'
      ? `${fmtDay(game.info, { weekday: 'short', day: 'numeric', month: 'short' })}, ${LEVEL_NAMES[p.difficulty].toLowerCase()}`
      : LEVEL_NAMES[p.difficulty];
  [...$('pips').children].forEach((el, i) => el.classList.toggle('on', i <= lvl));

  const eq = $('equation');
  eq.innerHTML = `${toHTML(p.expression)}<span class="eqs">=</span>${toHTML(p.rightHandSide)}`;
  eq.setAttribute('aria-label', `${toText(p.expression)} = ${toText(p.rightHandSide)}`.replace(/\u2212/g, 'minus'));
  fitEquation();

  const playing = game.status === 'playing';
  $('answerRow').hidden = !playing;
  $('btnReveal').hidden = !playing;
  $('btnReveal').textContent = 'Reveal the answer';
  $('btnReveal').classList.remove('arm');
  revealArmed = false;
  $('msg').textContent = '';
  renderTries();
  renderStatus();

  renderHints();
  $('result').hidden = playing;
  $('final').hidden = playing;
  if (!playing) renderResult();
  else { $('guess').value = ''; if (window.matchMedia('(hover: hover)').matches) $('guess').focus({ preventScroll: true }); }
}
function renderTries() {
  const wrong = game.attempts.filter((a) => !a.hint && !a.correct);
  $('tries').innerHTML = wrong.map((a) => `<li><span class="sr">Not </span>${esc(a.value)}</li>`).join('');
}
/* ---------- hints ----------
   Hint 1 shows the first instruction. Each later hint shows where the previous
   instruction leads, plus the next instruction. The final line (x = ...) is never shown. */
const hintCount = () => game.attempts.filter((a) => a.hint).length;
const maxHints = () => game.puzzle.solutionSteps.length - 1;
const noteHTML = (note) => esc(note).replace(/(^|[\s\d\u2212])x\b/g, '$1<var>x</var>');
function renderHints(animateLast) {
  const playing = game.status === 'playing', h = hintCount();
  const box = $('hints'), btn = $('btnHint');
  box.hidden = !playing || h === 0;
  btn.hidden = !playing;
  if (playing && h > 0) {
    const s = game.puzzle.solutionSteps;
    const row = (st, showNote, showEq, cls) => `<li${cls ? ` class="${cls}"` : ''}>${showNote ? `<span class="note">${noteHTML(st.note)}</span>` : ''}${showEq ? `<span class="l">${toHTML(st.lhs)}</span><span>=</span><span class="r">${toHTML(st.rhs)}</span>` : ''}</li>`;
    let html = row(s[0], false, true);
    for (let i = 1; i <= h; i++) {
      // The note for step i is new on hint i; its result line appears on hint i + 1.
      html += `<li${animateLast && i === h ? ' class="new"' : ''}><span class="note">${noteHTML(s[i].note)}</span></li>`;
      if (i < h) html += row(s[i], false, true, animateLast && i === h - 1 ? 'new' : '');
    }
    $('hintSteps').innerHTML = html;
  }
  const left = MAX_ATTEMPTS - game.attempts.length;
  if (h >= maxHints()) { btn.disabled = true; $('hintLabel').textContent = 'No more hints'; $('hintCost').textContent = 'The next step is the answer'; }
  else if (left <= 1) { btn.disabled = true; $('hintLabel').textContent = 'No hints left'; $('hintCost').textContent = 'Save your last attempt to answer'; }
  else { btn.disabled = false; $('hintLabel').textContent = h ? 'Next hint' : 'Get a hint'; $('hintCost').textContent = 'Uses 1 attempt'; }
}
function useHint() {
  if (game.status !== 'playing' || hintCount() >= maxHints() || MAX_ATTEMPTS - game.attempts.length <= 1) return;
  game.attempts.push({ hint: true });
  const left = MAX_ATTEMPTS - game.attempts.length;
  say(`Hint used. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`);
  renderHints(true);
  renderStatus();
  saveGame();
}

function renderStatus() {
  const st = loadStats();
  const streak = liveStreak(st, today.epochDay);
  const el = $('streakStat');
  el.hidden = !game.daily;
  el.innerHTML = streak ? `🔥 <b>${streak}</b> day streak` : 'No streak yet';
  $('attemptsStat').textContent = game.attempts.length;
  $('timeStat').textContent = fmtTime(game.elapsed);
}
function renderResult() {
  const p = game.puzzle, won = game.status === 'won', n = game.attempts.length;
  const fin = $('final');
  fin.className = 'final' + (won ? '' : ' lost') + (justFinished ? ' animate' : '');
  fin.innerHTML = `<var>x</var> = <span class="ringed">${p.answer}${won ? '<svg class="ring" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M80 9 C62 1 22 2 9 16 C-2 29 8 52 42 57 C74 61 99 49 97 30 C95 15 76 6 58 5"/></svg>' : ''}</span>` +
    (won ? '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M3 13 L9.5 19.5 L22 3"/></svg>' : '');

  $('verdict').textContent = won ? (n === 1 ? 'Correct, first time' : 'Correct') : 'Not this time';
  const st = loadStats();
  const streak = liveStreak(st, today.epochDay);
  const hints = hintCount();
  const hintNote = hints ? ` including ${hints} ${hints === 1 ? 'hint' : 'hints'}` : '';
  let summary = won
    ? `Solved in ${n} ${n === 1 ? 'attempt' : 'attempts'}${hintNote}, ${fmtTime(game.elapsed)}.`
    : `The answer was ${p.answer}. Here's how to get there.`;
  $('summary').textContent = summary;

  const steps = $('steps');
  steps.className = 'steps';
  $('result').classList.toggle('animate', justFinished);
  steps.innerHTML = p.solutionSteps.map((s, i) => {
    const d = (i * 0.22 + 0.9).toFixed(2);
    const style = justFinished ? ` style="animation-delay:${d}s"` : '';
    return `<li>${s.note ? `<span class="note"${style}>${esc(s.note).replace(/(^|[\s\d\u2212])x\b/g, '$1<var>x</var>')}</span>` : ''}<span class="l"${style}>${toHTML(s.lhs)}</span><span${style}>=</span><span class="r"${style}>${toHTML(s.rhs)}</span></li>`;
  }).join('');

  $('btnShare').hidden = game.kind === 'practice';
  $('btnNew').hidden = game.kind !== 'practice';
  $('btnPractice').hidden = game.kind !== 'daily';
  $('btnArchiveBack').hidden = game.kind !== 'archive';
  updateCountdown();
}

/* Shrink the equation font until it fits the screen width. */
function fitEquation() {
  const wrap = $('eqWrap'), eq = $('equation');
  eq.style.fontSize = '';
  let size = parseFloat(getComputedStyle(eq).fontSize);
  const avail = wrap.clientWidth - 40;
  while (eq.scrollWidth > avail && size > 18) { size -= 1; eq.style.fontSize = size + 'px'; }
}

/* ---------- answer checking ---------- */
function parseAnswer(raw) {
  const s = raw.trim().replace(/\u2212/g, '-').replace(/^x\s*=\s*/i, '').replace(/\s+/g, '');
  let m;
  if ((m = s.match(/^(-?\d+)\/(-?\d+)$/)) && +m[2] !== 0) return { value: +m[1] / +m[2], num: +m[1], den: +m[2], label: s };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { value: +s, label: String(+s) };
  return null;
}
function isCorrect(a, answer) {
  return a.den !== undefined ? a.num === answer * a.den : Math.abs(a.value - answer) < 1e-9;
}
function submit() {
  if (game.status !== 'playing') return;
  const input = $('guess');
  if (!input.value.trim()) { say('Enter a value for x.'); return; }
  const a = parseAnswer(input.value);
  if (!a) { say('Enter a number, like 7.'); shake(); return; }
  if (game.attempts.some((t) => !t.hint && Math.abs(parseAnswer(t.value).value - a.value) < 1e-9)) { say(`You've already tried ${a.label}.`); shake(); return; }
  const correct = isCorrect(a, game.puzzle.answer);
  game.attempts.push({ value: a.label, correct });
  if (correct) return finish('won');
  if (game.attempts.length >= MAX_ATTEMPTS) return finish('lost');
  const left = MAX_ATTEMPTS - game.attempts.length;
  say(`${a.label} isn't right. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`);
  input.value = '';
  shake();
  renderTries();
  renderStatus();
  renderHints();
  saveGame();
}
function say(t) { $('msg').textContent = t; }
function shake() { const i = $('guess'); i.classList.remove('shake'); void i.offsetWidth; i.classList.add('shake'); }

function finish(status) {
  game.status = status;
  justFinished = true;
  if (game.daily) recordStats(status === 'won');
  saveGame();
  render();
}
function recordStats(won) {
  const st = loadStats(), day = today.epochDay, d = game.puzzle.difficulty;
  if (st.lastPlayedDay === day) return;
  st.played++; st.byDiff[d].played++; st.lastPlayedDay = day;
  if (won) {
    st.won++; st.byDiff[d].won++;
    st.totalAttempts += game.attempts.length; st.totalTime += Math.round(game.elapsed);
    st.current = st.lastWinDay === day - 1 ? st.current + 1 : 1;
    st.lastWinDay = day; st.max = Math.max(st.max, st.current);
  } else {
    st.current = 0;
  }
  store.set(STATS_KEY, st);
}

/* ---------- timer (only runs while the page is visible) ---------- */
function tick() {
  const now = performance.now();
  if (game && game.status === 'playing' && !document.hidden && !$('sheet').hidden) {
    game.elapsed += now - lastTick;
    $('timeStat').textContent = fmtTime(game.elapsed);
    if (++saveCounter % 20 === 0) saveGame();
  }
  lastTick = now;
  const current = dayInfo(nowDate());
  if (today && current.epochDay !== today.epochDay) newDay(current);
  else if (game && game.status !== 'playing') updateCountdown();
}
/* Midnight in the player's time zone: switch to the new puzzle wherever they are. */
function newDay(current) {
  today = current;
  if (curGame === 'algebra' && mode === 'daily') { saveGame(); startDaily(); toast(`Puzzle #${today.number} is live`); }
  else if (mode === 'archive' && !$('archive').hidden) renderArchive();
  XolveLatticeUI.newDay();
}
document.addEventListener('visibilitychange', () => { lastTick = performance.now(); if (document.hidden) saveGame(); });
window.addEventListener('pagehide', saveGame);

function updateCountdown() {
  const el = $('next');
  if (!game.daily || game.status === 'playing') { el.textContent = ''; return; }
  const n = nowDate(), midnight = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  const ms = Math.max(0, midnight - n);
  el.textContent = `Next puzzle in ${fmtTime(ms)}`;
}

/* ---------- sharing ---------- */
function shareText() {
  const p = game.puzzle, won = game.status === 'won';
  const squares = game.attempts.map((a) => (a.hint ? '💡' : a.correct ? '🟩' : '🟥')).join('');
  const streak = liveStreak(loadStats(), today.epochDay);
  return [`XOLVE #${p.id} (${LEVEL_NAMES[p.difficulty]}${game.kind === 'archive' ? ', archive' : ''})`,
    `${squares} ${won ? `${game.attempts.length}/6 in ${fmtTime(game.elapsed)}` : 'X/6'}`,
    streak && game.kind === 'daily' ? `🔥 ${streak}` : ''].filter(Boolean).join('\n');
}
function share() { copyText(shareText()); }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Result copied'); return; } catch (e) {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove();
  if (ok) { toast('Result copied'); return; }
  const box = document.createElement('textarea');
  box.className = 'copybox'; box.value = text; box.setAttribute('readonly', '');
  document.querySelectorAll('.copybox').forEach((b) => b.remove());
  const host = curGame === 'lattice' ? $('latResult') : $('result');
  host.appendChild(box); box.select();
  toast('Copy the result below');
}
let toastTimer;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800); }

/* ---------- statistics dialog ---------- */
function openStats() {
  const st = loadStats();
  const pct = st.played ? Math.round((st.won / st.played) * 100) : 0;
  const avgA = st.won ? (st.totalAttempts / st.won).toFixed(1) : '0';
  const avgT = st.won ? fmtTime(st.totalTime / st.won) : '0:00';
  const figs = [[st.played, 'Played'], [pct + '%', 'Win rate'], [st.won, 'Solved'],
    [liveStreak(st, today.epochDay), 'Current streak'], [st.max, 'Longest streak'], [avgA, 'Avg attempts'],
  ];
  $('figs').innerHTML = figs.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('') +
    `<div style="grid-column:1/-1"><b>${avgT}</b><span>Average solve time</span></div>`;
  const maxPlayed = Math.max(1, ...DIFFICULTIES.map((d) => st.byDiff[d].played));
  $('dist').innerHTML = DIFFICULTIES.map((d) => {
    const b = st.byDiff[d];
    return `<div class="bar-row"><span>${LEVEL_NAMES[d]}</span><span class="bar" role="img" aria-label="${b.won} of ${b.played} solved"><i style="width:${(b.won / maxPlayed) * 100}%"></i></span><span class="v">${b.won}/${b.played}</span></div>`;
  }).join('');
  XolveLatticeUI.renderStats($('latStats'), $('latDist'));
  $('dlgStats').showModal();
}

/* ---------- events ---------- */
$('btnCheck').addEventListener('click', submit);
$('guess').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
$('btnReveal').addEventListener('click', () => {
  if (!revealArmed) { revealArmed = true; $('btnReveal').textContent = game.kind === 'daily' ? 'Tap again to reveal (counts as a loss)' : 'Tap again to reveal'; $('btnReveal').classList.add('arm'); return; }
  finish('lost');
});
$('btnShare').addEventListener('click', share);
$('btnNew').addEventListener('click', startPractice);
$('btnPractice').addEventListener('click', () => go('algebra', 'practice'));
$('btnBack').addEventListener('click', () => { saveGame(); renderArchive(); });
$('btnArchiveBack').addEventListener('click', () => { saveGame(); renderArchive(); });
$('btnToday').addEventListener('click', () => go(curGame, 'daily'));
$('archList').addEventListener('click', (e) => {
  const b = e.target.closest('.arch-row'); if (!b) return;
  const ep = +b.dataset.epoch;
  if (ep === today.epochDay) go(curGame, 'daily');
  else if (curGame === 'lattice') { showView('lattice'); XolveLatticeUI.open('archive', ep); }
  else startArchivePuzzle(ep);
});
$('btnStats').addEventListener('click', openStats);
$('btnHelp').addEventListener('click', () => (curGame === 'lattice' ? XolveLatticeUI.openHelp() : $('dlgHelp').showModal()));
$('btnBook').addEventListener('click', () => (curGame === 'lattice' ? XolveLatticeUI.openHelp() : $('dlgBook').showModal()));
$('btnHint').addEventListener('click', useHint);
$('btnHome').addEventListener('click', () => {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  go('algebra', 'daily');
  window.scrollTo({ top: 0 });
});
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
});
/* ---------- navigation: pick a game, then Today / Archive / Practice ---------- */
const LEVELS_FOR = { algebra: ['easy', 'medium', 'hard', 'expert'], lattice: ['easy', 'medium', 'hard', 'extreme'] };
function go(g, m) {
  saveGame();
  if (curGame === 'lattice') XolveLatticeUI.close();
  curGame = g; mode = m;
  document.querySelectorAll('.game').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.game === g)));
  document.querySelectorAll('.mode').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('levels').hidden = m !== 'practice';
  markLevel();
  today = dayInfo(nowDate());
  if (m === 'archive') renderArchive();
  else if (g === 'lattice') { showView('lattice'); XolveLatticeUI.open(m, m === 'practice' ? latticeLevel : undefined); }
  else if (m === 'daily') startDaily();
  else startPractice();
}
document.querySelectorAll('.game').forEach((b) => b.addEventListener('click', () => { if (b.dataset.game !== curGame) go(b.dataset.game, mode); }));
document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => go(curGame, b.dataset.mode)));
function markLevel() {
  const list = LEVELS_FOR[curGame], current = curGame === 'lattice' ? latticeLevel : practiceLevel;
  $('lastLevel').dataset.level = list[3];
  $('lastLevel').textContent = curGame === 'lattice' ? 'Extreme' : 'Expert';
  document.querySelectorAll('.level').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === current)));
}
document.querySelectorAll('.level').forEach((b) => b.addEventListener('click', () => {
  if (curGame === 'lattice') {
    latticeLevel = b.dataset.level; store.set('xolve:latticeLevel', latticeLevel); markLevel();
    XolveLatticeUI.open('practice', latticeLevel);
  } else {
    practiceLevel = b.dataset.level; store.set('xolve:practiceLevel', practiceLevel); markLevel(); startPractice();
  }
}));
window.addEventListener('resize', () => game && fitEquation());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => game && fitEquation());

/* ---------- boot ---------- */
markLevel();
$('sheet').hidden = true;
syncClock().then(() => {
  XolveLatticeUI.init({ store, nowDate, dayInfo, infoFromEpoch, toast, fmtTime, share: copyText, go });
  startDaily();
  lastTick = performance.now();
  setInterval(tick, 250);
  setInterval(syncClock, 15 * 60 * 1000);
  if (!store.get('xolve:seenHelp')) { store.set('xolve:seenHelp', true); $('dlgHelp').showModal(); }
});
})();

/*
 * XOLVE Algebra: the equation screen, answer checking, hints, timer, statistics and sharing.
 * Needs algebra/engine.js and shared/shell.js. The shell starts it with init() and
 * shows or hides it with open() / close().
 */
(() => {
'use strict';
const { DIFFICULTIES, MAX_ATTEMPTS, buildPuzzle, dailyPuzzle, dayInfo, infoFromEpoch } = XolveGenerator;
const $ = (id) => document.getElementById(id);
const LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

let deps;                    // from the shell: { store, nowDate, toast, fmtTime, fmtDay, share, go, ... }
const store = { get: (k) => deps.store.get(k), set: (k, v) => deps.store.set(k, v) };
const fmtTime = (ms) => deps.fmtTime(ms);
const fmtDay = (info, opts) => deps.fmtDay(info, opts);
const nowDate = () => deps.nowDate();
const toast = (t) => deps.toast(t);

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
/* ---------- game state ---------- */
let today, game, lastTick = 0, saveCounter = 0, justFinished = false, revealArmed = false;
let isOpen = false;

function loadDay(info, kind) {
  const key = 'xolve:day:' + info.iso;
  const saved = store.get(key);
  game = { puzzle: dailyPuzzle(info), kind, daily: kind === 'daily', info, key,
    attempts: saved ? saved.attempts : [], status: saved ? saved.status : 'playing', elapsed: saved ? saved.elapsed : 0,
    archived: saved ? !!saved.archived : kind === 'archive' };
  justFinished = false;
  render();
}
function startDaily() { today = dayInfo(nowDate()); loadDay(today, 'daily'); }
function startArchivePuzzle(epochDay) {
  today = dayInfo(nowDate());
  if (epochDay >= today.epochDay) return startDaily();
  loadDay(infoFromEpoch(epochDay), 'archive');
}
function startPractice(level) {
  today = dayInfo(nowDate());
  const seed = (Math.random() * 4294967296) >>> 0;
  const puzzle = buildPuzzle(seed, level, { id: 'practice', date: null });
  game = { puzzle, kind: 'practice', daily: false, attempts: [], status: 'playing', elapsed: 0 };
  justFinished = false;
  render();
}
function saveGame() {
  if (game && game.key) store.set(game.key, { attempts: game.attempts, status: game.status, elapsed: Math.round(game.elapsed), archived: game.archived });
}

/* ---------- archive rows (the list itself is drawn by the shell) ---------- */
function archiveStatus(info) {
  const s = store.get('xolve:day:' + info.iso);
  if (!s || (!s.attempts.length && s.status === 'playing')) return ['', 'Play'];
  if (s.status === 'won') return ['won', `Solved in ${s.attempts.length}`];
  if (s.status === 'lost') return ['lost', 'Not solved'];
  return ['', 'In progress'];
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
  $('btnBack').hidden = game.kind !== 'archive';

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
  if (isOpen && game && game.status === 'playing' && !document.hidden) {
    game.elapsed += now - lastTick;
    $('timeStat').textContent = fmtTime(game.elapsed);
    if (++saveCounter % 20 === 0) saveGame();
  }
  lastTick = now;
  if (isOpen && game && game.status !== 'playing') updateCountdown();
}
/* Midnight in the player's time zone (the shell spots it): switch to the new puzzle. */
function newDay() {
  if (isOpen && game && game.kind === 'daily') { saveGame(); startDaily(); toast(`Puzzle #${today.number} is live`); }
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
    streak && game.kind === 'daily' ? `🔥 ${streak}` : '', deps.linkFor('algebra')].filter(Boolean).join('\n');
}
function share() { deps.share(shareText()); }
/* ---------- statistics (the shell opens the dialog) ---------- */
function renderStats() {
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
}

/* ---------- wiring ---------- */
function init(d) {
  deps = d;
  $('btnCheck').addEventListener('click', submit);
  $('guess').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  $('btnReveal').addEventListener('click', () => {
    if (!revealArmed) { revealArmed = true; $('btnReveal').textContent = game.kind === 'daily' ? 'Tap again to reveal (counts as a loss)' : 'Tap again to reveal'; $('btnReveal').classList.add('arm'); return; }
    finish('lost');
  });
  $('btnShare').addEventListener('click', share);
  $('btnNew').addEventListener('click', () => startPractice(game.puzzle.difficulty));
  $('btnPractice').addEventListener('click', () => deps.go('algebra', 'practice'));
  $('btnBack').addEventListener('click', () => deps.go('algebra', 'archive'));
  $('btnArchiveBack').addEventListener('click', () => deps.go('algebra', 'archive'));
  $('btnHint').addEventListener('click', useHint);
  document.addEventListener('visibilitychange', () => { lastTick = performance.now(); if (document.hidden) saveGame(); });
  window.addEventListener('pagehide', saveGame);
  window.addEventListener('resize', () => isOpen && game && fitEquation());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => isOpen && game && fitEquation());
  lastTick = performance.now();
  setInterval(tick, 250);
}
/* open('daily'), open('archive', epochDay) or open('practice', level) */
function open(kind, arg) {
  isOpen = true;
  lastTick = performance.now();
  if (kind === 'daily') startDaily();
  else if (kind === 'archive') startArchivePuzzle(arg);
  else startPractice(arg || 'medium');
}
function close() { saveGame(); isOpen = false; revealArmed = false; $('btnBack').hidden = true; }

XolveShell.register('algebra', {
  name: 'Algebra', view: 'sheet', archiveLabel: 'Puzzle', levelKey: 'xolve:practiceLevel',
  levels: DIFFICULTIES.map((id) => ({ id, name: LEVEL_NAMES[id] })),
  init, open, close, newDay, renderStats,
  archiveStatus,
  levelIndex: (epochDay) => DIFFICULTIES.indexOf(infoFromEpoch(epochDay).difficulty),
  levelName: (epochDay) => LEVEL_NAMES[infoFromEpoch(epochDay).difficulty],
  openHelp: () => $('dlgHelp').showModal(),
  openBook: () => $('dlgBook').showModal(),
  resultHost: () => $('result'),
});
})();

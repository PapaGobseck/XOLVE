/*
 * XOLVE Countdown: reach the target with six numbers.
 * Daily: the numbers stay covered until Start, then a 60-second clock runs.
 * Archive: untimed, numbers shown straight away.
 * Practice: unlimited random puzzles, untimed. Not saved, no stats.
 * Needs countdown/engine.js and shared/shell.js. The shell starts it with init() and
 * shows or hides it with open() / close().
 */
(() => {
  'use strict';
  const C = XolveCountdown;
  const $ = (id) => document.getElementById(id);
  const STATS_KEY = 'xolve:countdown-stats';
  const LIMIT = C.TIME_LIMIT_MS;

  let deps;                 // from the shell
  let state = null;         // the puzzle being played
  let isOpen = false, justFinished = false, revealArmed = false;
  const cache = {};

  /* state: { kind: 'daily' | 'archive' | 'practice', info, key, puzzle,
              status: 'ready' (daily, not started) | 'playing' | 'done',
              startedAt: ms (daily clock), steps: [{ a, op, b }], attempts: [{ value }],
              best: { value, steps: [{ x, op, y, r }] } | null,
              outcome: 'exact' | 'closest' | 'timeout' | 'revealed', timeMs }
     Tiles have ids: 0–5 are the six numbers, and step k makes tile 6 + k.
     A step's a and b are tile ids; its answer takes b's place in the row. */
  const keyFor = (info) => 'xolve:cd:' + info.iso;
  const dailyPuzzle = (info) => cache[info.iso] || (cache[info.iso] = C.dailyPuzzle(info));
  const P = () => state.puzzle;
  const off = (v) => Math.abs(v - P().target);
  const timed = () => state.kind === 'daily';
  const remaining = () => Math.max(0, LIMIT - (Date.now() - state.startedAt));
  const SYM = { '+': '+', '-': C.MINUS, '*': C.TIMES, '/': C.DIVIDE };
  let pick = null;          // { a: tile id, op } while building a step
  let typed = '', typedTimer = null;

  /* The value of each tile, and which tile sits in each of the six places. */
  function board() {
    const vals = P().numbers.slice(), slots = [0, 1, 2, 3, 4, 5];
    state.steps.forEach((s) => {
      const id = vals.length;
      vals.push(apply(vals[s.a], s.op, vals[s.b]).value);
      slots[slots.indexOf(s.a)] = null;
      slots[slots.indexOf(s.b)] = id;
    });
    return { vals, slots };
  }
  /* One step, checked against the rules. */
  function apply(x, op, y) {
    if (op === '+') return { value: x + y };
    if (op === '*') return { value: x * y };
    if (op === '-') return y > x ? { reason: `${x} ${C.MINUS} ${y} goes below zero. Try ${y} ${C.MINUS} ${x}.` } : { value: x - y };
    if (y === 0) return { reason: "You can't divide by zero" };
    return x % y ? { reason: `${x} ${C.DIVIDE} ${y} isn't a whole number` } : { value: x / y };
  }
  /* Just the steps that lead to a tile, in order, for showing how a number was made. */
  function stepsFor(id, vals) {
    const out = [];
    const walk = (t) => {
      if (t < 6) return;
      const s = state.steps[t - 6];
      walk(s.a); walk(s.b);
      out.push({ x: vals[s.a], op: s.op, y: vals[s.b], r: vals[t] });
    };
    walk(id);
    return out;
  }
  /* The example solution is stored as one line; turn it into steps the same way. */
  function solutionSteps(expr) {
    const toks = expr.match(/\d+|[+\u2212\u00d7\u00f7()]/g), out = [];
    let i = 0;
    const OP = { '+': '+', '\u2212': '-', '\u00d7': '*', '\u00f7': '/' };
    const step = (x, o, y) => { const r = apply(x, OP[o], y).value; out.push({ x, op: OP[o], y, r }); return r; };
    const factor = () => { const t = toks[i++]; if (t === '(') { const v = expr_(); i++; return v; } return +t; };
    const term = () => { let v = factor(); while (toks[i] === '\u00d7' || toks[i] === '\u00f7') { const o = toks[i++]; v = step(v, o, factor()); } return v; };
    const expr_ = () => { let v = term(); while (toks[i] === '+' || toks[i] === '\u2212') { const o = toks[i++]; v = step(v, o, term()); } return v; };
    expr_();
    return out;
  }
  const stepsHTML = (steps) => steps.map((s) => `<li>${s.x} ${SYM[s.op]} ${s.y} = <b>${s.r}</b></li>`).join('');

  function load(info, kind) {
    const saved = deps.store.get(keyFor(info));
    state = Object.assign({ steps: [], attempts: [], best: null, status: kind === 'daily' ? 'ready' : 'playing' }, saved || {},
      { kind, info, key: keyFor(info), puzzle: dailyPuzzle(info) });
    if (!Array.isArray(state.steps)) state.steps = [];
    // An archive round is never timed, even if it was started as a daily one.
    if (kind === 'archive' && state.status === 'ready') state.status = 'playing';
    justFinished = false; revealArmed = false; pick = null; typed = '';
    $('cdMsg').textContent = '';
    if (timed() && state.status === 'playing' && remaining() <= 0) timeUp(true);
    render();
  }
  /* A practice puzzle: a random draw, untimed. Never saved. */
  function loadPractice() {
    const puzzle = C.buildPuzzle((Math.random() * 4294967296) >>> 0, { id: 'practice', date: null });
    state = { kind: 'practice', puzzle, steps: [], attempts: [], best: null, status: 'playing' };
    justFinished = false; revealArmed = false; pick = null; typed = '';
    $('cdMsg').textContent = '';
    render();
  }
  function save() {
    if (!state || state.kind === 'practice') return;
    const { status, startedAt, steps, attempts, best, outcome, timeMs } = state;
    deps.store.set(state.key, { status, startedAt, steps, attempts, best, outcome, timeMs });
  }

  /* ---------- rendering ---------- */
  function render() {
    if (!state) return;
    const p = P(), st = state.status, kind = state.kind;
    $('cdLabel').textContent = kind === 'practice' ? 'Practice' : `Countdown #${state.info.number}`;
    $('cdDate').textContent = kind === 'practice' ? 'Untimed'
      : deps.fmtDay(state.info, kind === 'daily' ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }) + (kind === 'archive' ? ', untimed' : '');
    $('cdBack').hidden = kind !== 'archive';
    $('cdTarget').textContent = p.target;
    $('cdStart').hidden = st !== 'ready';
    $('cdStartNote').hidden = st !== 'ready';
    const on = st === 'playing';
    $('cdPlay').hidden = !on;
    $('cdClock').hidden = !(on && timed());
    $('cdGiveUp').hidden = !(on && !timed());
    if (!revealArmed) { $('cdGiveUp').textContent = 'Show a solution'; $('cdGiveUp').classList.remove('arm'); }
    renderBoard();
    renderAttempts();
    if (on) renderClock();
    $('cdResult').hidden = st !== 'done';
    if (st === 'done') renderResult();
  }
  function renderBoard() {
    const st = state.status;
    if (st === 'ready') {
      $('cdTiles').innerHTML = P().numbers.map(() => `<button class="cd-tile covered" disabled aria-label="Hidden number">?</button>`).join('');
      return;
    }
    // Once the round is over, show the six numbers again.
    const { vals, slots } = st === 'playing' ? board() : { vals: P().numbers, slots: [0, 1, 2, 3, 4, 5] };
    $('cdTiles').innerHTML = slots.map((id) => {
      if (id === null) return '<span class="cd-tile gone" aria-hidden="true"></span>';
      const v = vals[id], cls = ['cd-tile'];
      if (id < 6 && C.LARGE.includes(v)) cls.push('large');
      if (id >= 6) cls.push('made');
      if (String(v).length >= 4) cls.push(String(v).length >= 6 ? 'longer' : 'long');
      if (pick && pick.a === id) cls.push('sel');
      return `<button class="${cls.join(' ')}" data-id="${id}" aria-pressed="${!!(pick && pick.a === id)}"${st === 'playing' ? '' : ' disabled'}>${v}</button>`;
    }).join('');
    if (st !== 'playing') return;
    $('cdSteps').innerHTML = stepsHTML(state.steps.map((s, k) => ({ x: vals[s.a], op: s.op, y: vals[s.b], r: vals[6 + k] })));
    $('cdOps').querySelectorAll('[data-op]').forEach((b) => b.setAttribute('aria-pressed', String(!!(pick && pick.op && SYM[pick.op] === b.dataset.op))));
    $('cdOps').querySelector('[data-act="undo"]').disabled = !state.steps.length;
    $('cdOps').querySelector('[data-act="reset"]').disabled = !state.steps.length;
    $('cdHint').textContent = !pick ? (state.steps.length ? 'Pick a number for your next step' : 'Pick a number to start')
      : !pick.op ? `${vals[pick.a]} … now pick + ${C.MINUS} ${C.TIMES} or ${C.DIVIDE}`
        : `${vals[pick.a]} ${SYM[pick.op]} … now pick another number`;
  }
  function renderAttempts() {
    const b = state.best;
    $('cdBest').hidden = !b || state.status !== 'playing';
    if (b) $('cdBest').innerHTML = `Closest so far: <b>${b.value}</b> <span>(${off(b.value)} away)</span>`;
    $('cdTries').innerHTML = state.status === 'playing' ? state.attempts.map((a) => `<li>${a.value}</li>`).join('') : '';
  }
  function renderClock() {
    if (!timed() || state.status !== 'playing') return;
    const ms = remaining(), s = Math.ceil(ms / 1000);
    $('cdSecs').textContent = s;
    $('cdBar').style.width = (ms / LIMIT) * 100 + '%';
    $('cdClock').classList.toggle('low', s <= 10);
  }

  function renderResult() {
    const p = P(), b = state.best, o = state.outcome;
    $('cdVerdict').textContent = { exact: 'Bang on', closest: b ? `${off(b.value)} away` : '', timeout: 'Out of time', revealed: 'Not this time' }[o];
    const secs = state.timeMs !== undefined ? Math.max(1, Math.round(state.timeMs / 1000)) : null;
    $('cdSummary').textContent = o === 'exact'
      ? `You made ${p.target}${secs && timed() ? ` in ${secs} ${secs === 1 ? 'second' : 'seconds'}` : ''}.`
      : o === 'closest' ? `Your closest was ${b.value}, for a target of ${p.target}.`
        : o === 'timeout' ? `You didn't make a number before the clock ran out. The target was ${p.target}.`
          : `The target was ${p.target}.`;
    $('cdYours').hidden = !b;
    $('cdYoursHead').textContent = o === 'exact' ? 'Your steps' : 'How you made your closest';
    // Rounds saved before steps existed kept a one-line calculation instead.
    if (b) $('cdYoursCalc').innerHTML = b.steps ? stepsHTML(b.steps) : `<li>${b.expr.replace(/</g, '&lt;')} = <b>${b.value}</b></li>`;
    $('cdSolution').innerHTML = stepsHTML(solutionSteps(p.solution));
    $('cdShare').hidden = state.kind !== 'daily';
    $('cdArchive').hidden = state.kind !== 'daily';
    $('cdArchiveBack').hidden = state.kind !== 'archive';
    $('cdNew').hidden = state.kind !== 'practice';
    updateCountdown();
    $('cdResult').classList.toggle('animate', justFinished);
    justFinished = false;
  }
  function updateCountdown() {
    const el = $('cdNext');
    if (!state || state.kind !== 'daily' || state.status !== 'done') { el.textContent = ''; return; }
    if (deps.dayInfo(deps.nowDate()).epochDay > state.info.epochDay) { el.textContent = "Today's countdown is ready. Tap Today to play it."; return; }
    const n = deps.nowDate(), midnight = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    el.textContent = `Next countdown in ${deps.fmtTime(Math.max(0, midnight - n))}`;
  }
  function say(t) { $('cdMsg').textContent = t; }

  /* ---------- playing ---------- */
  function start() {
    if (state.status !== 'ready') return;
    state.status = 'playing';
    state.startedAt = Date.now();
    save();
    render();
  }
  function playable() {
    if (state.status !== 'playing') return false;
    if (timed() && remaining() <= 0) { timeUp(); return false; }
    return true;
  }
  /* Tapping a number: start a step, change the first number, or finish the step. */
  function tapTile(id) {
    if (!playable()) return;
    say('');
    if (!pick || !pick.op) { pick = pick && pick.a === id ? null : { a: id }; return renderBoard(); }
    if (pick.a === id) { pick = { a: id }; return renderBoard(); }
    const { vals } = board(), r = apply(vals[pick.a], pick.op, vals[id]);
    if (r.reason) { say(r.reason); return; }
    state.steps.push({ a: pick.a, op: pick.op, b: id });
    pick = null;
    made(6 + state.steps.length - 1);
  }
  function tapOp(op) {
    if (!playable()) return;
    say('');
    if (!pick) { say('Pick a number first'); return; }
    pick = { a: pick.a, op: pick.op === op ? undefined : op };
    renderBoard();
  }
  /* A new number counts straight away. */
  function made(id) {
    const { vals } = board(), v = vals[id];
    if (!state.attempts.some((a) => a.value === v)) state.attempts.push({ value: v });
    if (!state.best || off(v) < off(state.best.value)) state.best = { value: v, steps: stepsFor(id, vals) };
    if (v === P().target) return finish('exact');
    save();
    renderBoard(); renderAttempts();
  }
  function undo() {
    if (!playable() || !state.steps.length) return;
    state.steps.pop(); pick = null; say('');
    save(); renderBoard();
  }
  function reset() {
    if (!playable() || !state.steps.length) return;
    state.steps = []; pick = null; say('');
    save(); renderBoard();
  }
  function timeUp(quiet) { finish(state.best ? 'closest' : 'timeout', quiet); }
  function finish(outcome, quiet) {
    state.status = 'done';
    state.outcome = outcome;
    if (timed()) state.timeMs = Math.min(LIMIT, Date.now() - state.startedAt);
    if (state.kind === 'daily') recordStats();
    justFinished = !quiet;
    revealArmed = false; pick = null;
    save();
    if (isOpen && !quiet) { say(''); render(); $('cdResult').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  /* Keyboard: type a number to pick that tile, then + - * /, then another number.
     A number that could still grow (5 when there's also a 50) waits a moment. */
  function typeDigit(d) {
    const { vals, slots } = board(), live = slots.filter((id) => id !== null);
    const tryBuf = (buf) => live.filter((id) => String(vals[id]).startsWith(buf) && !(pick && !pick.op && pick.a === id));
    clearTimeout(typedTimer);
    typed += d;
    if (!tryBuf(typed).length) typed = d;
    const cands = tryBuf(typed);
    if (!cands.length) { typed = ''; say(`${d} isn't one of your numbers`); return; }
    const exact = cands.find((id) => String(vals[id]) === typed);
    const longer = cands.some((id) => String(vals[id]).length > typed.length);
    if (exact !== undefined && !longer) { typed = ''; tapTile(exact); }
    else if (exact !== undefined) typedTimer = setTimeout(() => { typed = ''; tapTile(exact); }, 700);
  }
  function onKey(e) {
    if (!isOpen || !state || state.status !== 'playing' || document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) { e.preventDefault(); typeDigit(k); }
    else if (k === '+' || k === '-' || k === '*' || k === '/' || k === 'x' || k === 'X') { e.preventDefault(); tapOp(k === 'x' || k === 'X' ? '*' : k); }
    else if (k === 'Backspace') { e.preventDefault(); if (pick) { pick = null; renderBoard(); } else undo(); }
    else if (k === 'Escape') { pick = null; typed = ''; renderBoard(); }
  }

  /* ---------- statistics ---------- */
  const BANDS = [['exact', 'Exact'], ['near', '1–5 away'], ['mid', '6–10 away'], ['far', '11+ away'], ['none', 'No answer']];
  function loadStats() {
    const base = { played: 0, exact: 0, current: 0, max: 0, lastWinDay: null, lastPlayedDay: null, totalTime: 0, bands: {} };
    const st = Object.assign(base, deps.store.get(STATS_KEY) || {});
    BANDS.forEach(([k]) => (st.bands[k] = st.bands[k] || 0));
    return st;
  }
  function liveStreak(st) {
    const today = deps.dayInfo(deps.nowDate()).epochDay;
    return st.lastWinDay !== null && today - st.lastWinDay <= 1 ? st.current : 0;
  }
  function bandOf() {
    if (!state.best) return 'none';
    const d = off(state.best.value);
    return d === 0 ? 'exact' : d <= 5 ? 'near' : d <= 10 ? 'mid' : 'far';
  }
  function recordStats() {
    const st = loadStats(), day = state.info.epochDay;
    if (st.lastPlayedDay === day) return;
    st.played++; st.lastPlayedDay = day; st.bands[bandOf()]++;
    if (state.outcome === 'exact') {
      st.exact++; st.totalTime += Math.round(state.timeMs || 0);
      st.current = st.lastWinDay === day - 1 ? st.current + 1 : 1;
      st.lastWinDay = day; st.max = Math.max(st.max, st.current);
    } else st.current = 0;
    deps.store.set(STATS_KEY, st);
  }
  function renderStats() {
    const st = loadStats();
    const pct = st.played ? Math.round((st.exact / st.played) * 100) : 0;
    const avg = st.exact ? Math.round(st.totalTime / st.exact / 1000) + 's' : '0s';
    const figs = [[st.played, 'Played'], [pct + '%', 'Exact rate'], [avg, 'Avg time'],
      [liveStreak(st), 'Current streak'], [st.max, 'Longest streak'], [st.exact, 'Exact']];
    $('cdStats').innerHTML = figs.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    const most = Math.max(1, ...BANDS.map(([k]) => st.bands[k]));
    $('cdDist').innerHTML = BANDS.map(([k, name]) => `<div class="bar-row cd-bar-row"><span>${name}</span><span class="bar" role="img" aria-label="${st.bands[k]} days"><i style="width:${(st.bands[k] / most) * 100}%"></i></span><span class="v">${st.bands[k]}</span></div>`).join('');
  }

  /* ---------- archive rows (the list itself is drawn by the shell) ---------- */
  function archiveStatus(info) {
    const s = deps.store.get(keyFor(info));
    if (!s || s.status === 'ready' || (s.status === 'playing' && !(s.attempts || []).length)) return ['', 'Play'];
    if (s.status === 'playing') return ['', 'In progress'];
    if (s.outcome === 'exact') return ['won', 'Solved'];
    if (s.outcome === 'closest') return ['', `${Math.abs(s.best.value - dailyPuzzle(info).target)} away`];
    return ['lost', s.outcome === 'timeout' ? 'Out of time' : 'Not solved'];
  }

  /* ---------- sharing (today's puzzle only) ---------- */
  function shareText() {
    const p = P(), b = state.best, o = state.outcome, st = loadStats(), streak = liveStreak(st);
    const secs = Math.max(1, Math.round((state.timeMs || 0) / 1000));
    const lines = o === 'exact'
      ? ["I Xolved today's numbers countdown", `🎯 ${p.target} in ${secs}s`]
      : o === 'closest'
        ? [`I got ${b.value} in today's Xolve countdown`, `🎯 ${p.target}, ${off(b.value)} away`]
        : ["I ran out of time on today's Xolve countdown", `🎯 ${p.target}`];
    return [`XOLVE Countdown #${state.info.number}`, ...lines, o === 'exact' && streak ? `🔥 ${streak}` : '', 'https://xolve.games'].filter(Boolean).join('\n');
  }

  /* ---------- clock ---------- */
  function tick() {
    // The clock keeps running if the player leaves the page or switches game.
    if (state && timed() && state.status === 'playing') {
      if (remaining() <= 0) { timeUp(!isOpen); if (!isOpen) return; }
      else if (isOpen) renderClock();
    }
    if (isOpen && state && state.status === 'done') updateCountdown();
  }

  /* ---------- How to play ---------- */
  const openHelp = () => $('dlgCountdown').showModal();

  /* ---------- wiring ---------- */
  function init(d) {
    deps = d;
    $('cdStart').addEventListener('click', start);
    $('cdTiles').addEventListener('click', (e) => { const t = e.target.closest('.cd-tile[data-id]'); if (t && !t.disabled) tapTile(+t.dataset.id); });
    $('cdOps').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'undo') undo();
      else if (b.dataset.act === 'reset') reset();
      else tapOp({ '+': '+', [C.MINUS]: '-', [C.TIMES]: '*', [C.DIVIDE]: '/' }[b.dataset.op]);
    });
    document.addEventListener('keydown', onKey);
    $('cdGiveUp').addEventListener('click', () => {
      if (!revealArmed) { revealArmed = true; $('cdGiveUp').textContent = 'Tap again to show a solution'; $('cdGiveUp').classList.add('arm'); return; }
      finish(state.best ? 'closest' : 'revealed');
    });
    $('cdShare').addEventListener('click', () => deps.share(shareText()));
    $('cdArchive').addEventListener('click', () => deps.go('countdown', 'archive'));
    $('cdNew').addEventListener('click', () => { loadPractice(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('cdArchiveBack').addEventListener('click', () => deps.go('countdown', 'archive'));
    $('cdBack').addEventListener('click', () => deps.go('countdown', 'archive'));
    $('cdHow').addEventListener('click', openHelp);
    window.addEventListener('pagehide', save);
    setInterval(tick, 200);
  }
  /* open('daily'), open('archive', epochDay) or open('practice') */
  function open(kind, arg) {
    isOpen = true;
    if (kind === 'practice') return loadPractice();
    const today = deps.dayInfo(deps.nowDate());
    if (kind === 'archive' && arg < today.epochDay) load(deps.infoFromEpoch(arg), 'archive');
    else load(today, 'daily');
  }
  function close() { save(); isOpen = false; revealArmed = false; pick = null; }
  function newDay() {
    // Never swap the puzzle mid-round; the result screen points to the new one instead.
    if (isOpen && state && state.kind === 'daily' && state.status !== 'playing') { save(); load(deps.dayInfo(deps.nowDate()), 'daily'); deps.toast('A new countdown is live'); }
  }

  XolveShell.register('countdown', {
    name: 'Countdown', view: 'countdown', archiveLabel: 'Countdown', levelKey: 'xolve:countdownPractice',
    levels: [],
    init, open, close, newDay, archiveStatus, renderStats, openHelp, openBook: openHelp,
    levelIndex: () => null, levelName: () => '',
    resultHost: () => $('cdResult'),
  });
})();

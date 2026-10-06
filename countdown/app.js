/*
 * XOLVE Countdown: reach the target with six numbers.
 * Daily: the numbers stay covered until Start, then a 60-second clock runs.
 * Archive: untimed, numbers shown straight away. No practice mode.
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

  /* state: { kind: 'daily' | 'archive', info, key, puzzle,
              status: 'ready' (daily, not started) | 'playing' | 'done',
              startedAt: ms (daily clock), attempts: [{ expr, value }], best: { expr, value } | null,
              outcome: 'exact' | 'closest' | 'timeout' | 'revealed', timeMs } */
  const keyFor = (info) => 'xolve:cd:' + info.iso;
  const dailyPuzzle = (info) => cache[info.iso] || (cache[info.iso] = C.dailyPuzzle(info));
  const P = () => state.puzzle;
  const off = (v) => Math.abs(v - P().target);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const timed = () => state.kind === 'daily';
  const remaining = () => Math.max(0, LIMIT - (Date.now() - state.startedAt));

  function load(info, kind) {
    const saved = deps.store.get(keyFor(info));
    state = Object.assign({ attempts: [], best: null, status: kind === 'daily' ? 'ready' : 'playing' }, saved || {},
      { kind, info, key: keyFor(info), puzzle: dailyPuzzle(info) });
    // An archive round is never timed, even if it was started as a daily one.
    if (kind === 'archive' && state.status === 'ready') state.status = 'playing';
    justFinished = false; revealArmed = false;
    $('cdInput').value = '';
    $('cdMsg').textContent = '';
    if (timed() && state.status === 'playing' && remaining() <= 0) timeUp(true);
    render();
  }
  function save() {
    if (!state) return;
    const { status, startedAt, attempts, best, outcome, timeMs } = state;
    deps.store.set(state.key, { status, startedAt, attempts, best, outcome, timeMs });
  }

  /* ---------- rendering ---------- */
  function render() {
    if (!state) return;
    const p = P(), st = state.status, kind = state.kind;
    $('cdLabel').textContent = `Countdown #${state.info.number}`;
    $('cdDate').textContent = deps.fmtDay(state.info, kind === 'daily' ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }) + (kind === 'archive' ? ', untimed' : '');
    $('cdBack').hidden = kind !== 'archive';
    $('cdTarget').textContent = p.target;

    const covered = st === 'ready';
    $('cdTiles').innerHTML = p.numbers.map((n, i) => covered
      ? `<button class="cd-tile covered" disabled aria-label="Hidden number">?</button>`
      : `<button class="cd-tile${C.LARGE.includes(n) ? ' large' : ''}" data-i="${i}" data-v="${n}">${n}</button>`).join('');
    $('cdStart').hidden = !covered;
    $('cdStartNote').hidden = !covered;

    const on = st === 'playing';
    $('cdPlay').hidden = !on;
    $('cdClock').hidden = !(on && timed());
    $('cdGiveUp').hidden = !(on && !timed());
    if (!revealArmed) { $('cdGiveUp').textContent = 'Show a solution'; $('cdGiveUp').classList.remove('arm'); }
    renderAttempts();
    if (on) { markTiles(); preview(); renderClock(); }
    $('cdResult').hidden = st !== 'done';
    if (st === 'done') renderResult();
  }
  function renderAttempts() {
    const b = state.best;
    $('cdBest').hidden = !b || state.status !== 'playing';
    if (b) $('cdBest').innerHTML = `Closest so far: <b>${b.value}</b> <span>(${off(b.value)} away)</span>`;
    const tries = state.status === 'playing' ? state.attempts : [];
    $('cdTries').innerHTML = tries.map((a) => `<li>${a.value}</li>`).join('');
  }
  function renderClock() {
    if (!timed() || state.status !== 'playing') return;
    const ms = remaining(), s = Math.ceil(ms / 1000);
    $('cdSecs').textContent = s;
    $('cdBar').style.width = (ms / LIMIT) * 100 + '%';
    $('cdClock').classList.toggle('low', s <= 10);
  }
  /* Grey out the tiles the current calculation already uses. */
  function markTiles() {
    const nums = ($('cdInput').value.match(/\d+/g) || []).map(Number);
    const tiles = [...$('cdTiles').querySelectorAll('.cd-tile')];
    tiles.forEach((t) => t.classList.remove('used'));
    nums.forEach((n) => { const t = tiles.find((x) => +x.dataset.v === n && !x.classList.contains('used')); if (t) t.classList.add('used'); });
  }
  /* Show what the calculation makes while it's valid. */
  function preview() {
    const raw = $('cdInput').value, r = raw.trim() ? C.check(raw, P().numbers) : null;
    $('cdPreview').textContent = r && r.ok ? `= ${r.value}` : '';
  }

  function renderResult() {
    const p = P(), b = state.best, o = state.outcome;
    const verdict = { exact: 'Bang on', closest: b ? `${off(b.value)} away` : '', timeout: 'Out of time', revealed: 'Not this time' }[o];
    $('cdVerdict').textContent = verdict;
    const secs = state.timeMs !== undefined ? Math.max(1, Math.round(state.timeMs / 1000)) : null;
    $('cdSummary').textContent = o === 'exact'
      ? `You made ${p.target}${secs && timed() ? ` in ${secs} ${secs === 1 ? 'second' : 'seconds'}` : ''}.`
      : o === 'closest' ? `Your closest was ${b.value}, for a target of ${p.target}.`
        : o === 'timeout' ? `No answer before the clock ran out. The target was ${p.target}.`
          : `The target was ${p.target}.`;
    $('cdYours').hidden = !b;
    $('cdYoursHead').textContent = o === 'exact' ? 'Your answer' : 'Your closest';
    if (b) $('cdYoursCalc').innerHTML = `${esc(b.expr)} = <b>${b.value}</b>`;
    $('cdSolution').innerHTML = `${esc(p.solution)} = <b>${p.target}</b>`;
    $('cdShare').hidden = state.kind !== 'daily';
    $('cdArchive').hidden = state.kind !== 'daily';
    $('cdArchiveBack').hidden = state.kind !== 'archive';
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
  function shake() { const i = $('cdInput'); i.classList.remove('shake'); void i.offsetWidth; i.classList.add('shake'); }

  /* ---------- playing ---------- */
  function start() {
    if (state.status !== 'ready') return;
    state.status = 'playing';
    state.startedAt = Date.now();
    save();
    render();
    if (!coarse) $('cdInput').focus({ preventScroll: true });
  }
  function submit() {
    if (state.status !== 'playing') return;
    if (timed() && remaining() <= 0) return timeUp();
    const raw = $('cdInput').value;
    const r = C.check(raw, P().numbers);
    if (!r.ok) { say(r.reason); shake(); return; }
    const expr = raw.trim().replace(/\s+/g, ' ');
    if (state.attempts.some((a) => a.value === r.value)) { say(`You've already made ${r.value}.`); return; }
    state.attempts.push({ expr, value: r.value });
    if (!state.best || off(r.value) < off(state.best.value)) state.best = { expr, value: r.value };
    if (r.value === P().target) return finish('exact');
    say(`${r.value}: ${off(r.value)} away.`);
    save();
    renderAttempts();
  }
  function timeUp(quiet) { finish(state.best ? 'closest' : 'timeout', quiet); }
  function finish(outcome, quiet) {
    state.status = 'done';
    state.outcome = outcome;
    if (timed()) state.timeMs = Math.min(LIMIT, Date.now() - state.startedAt);
    if (state.kind === 'daily') recordStats();
    justFinished = !quiet;
    revealArmed = false;
    save();
    if (isOpen && !quiet) { $('cdMsg').textContent = ''; render(); $('cdResult').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  /* Where the next key goes: the cursor if the box has focus, otherwise the end. */
  function caret() {
    const el = $('cdInput'), end = el.value.length;
    return document.activeElement === el ? [el.selectionStart ?? end, el.selectionEnd ?? end] : [end, end];
  }
  /* Insert text at the cursor, as typing would. */
  function insert(text) {
    const el = $('cdInput'), [a, b] = caret();
    el.setRangeText(text, a, b, 'end');
    afterEdit();
  }
  function backspace() {
    const el = $('cdInput');
    let [a, b] = caret();
    if (a === b) {
      // Delete a whole number at once, and the spaces around a symbol.
      const before = el.value.slice(0, a);
      const m = before.match(/(\d+|\s*[^\s\d]\s*|\s+)$/);
      a = m ? a - m[0].length : Math.max(0, a - 1);
    }
    el.setRangeText('', a, b, 'end');
    afterEdit();
  }
  function afterEdit() {
    const el = $('cdInput'), pos = el.selectionStart;
    // Show the proper symbols, whichever key was used. Each swap is one character, so the cursor stays put.
    const shown = el.value.replace(/-/g, C.MINUS).replace(/[*xX]/g, C.TIMES).replace(/\//g, C.DIVIDE);
    if (shown !== el.value) { el.value = shown; el.setSelectionRange(pos, pos); }
    $('cdMsg').textContent = '';
    markTiles(); preview();
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
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  function init(d) {
    deps = d;
    const input = $('cdInput');
    // On touch screens the tiles and symbol keys do the typing, so keep the phone keyboard away.
    if (coarse) input.inputMode = 'none';
    $('cdStart').addEventListener('click', start);
    // Tapping a number or symbol shouldn't take the cursor out of the box.
    ['cdTiles', 'cdOps'].forEach((id) => $(id).addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }));
    $('cdTiles').addEventListener('click', (e) => {
      const t = e.target.closest('.cd-tile[data-v]');
      if (!t || state.status !== 'playing' || t.classList.contains('used')) return;
      insert(t.dataset.v);
    });
    $('cdOps').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || state.status !== 'playing') return;
      if (b.dataset.op === 'del') backspace();
      else if (b.dataset.op === 'clear') { input.value = ''; afterEdit(); }
      else insert(/[()]/.test(b.dataset.op) ? b.dataset.op : ` ${b.dataset.op} `);
    });
    input.addEventListener('input', afterEdit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    $('cdCheck').addEventListener('click', submit);
    $('cdGiveUp').addEventListener('click', () => {
      if (!revealArmed) { revealArmed = true; $('cdGiveUp').textContent = 'Tap again to show a solution'; $('cdGiveUp').classList.add('arm'); return; }
      finish(state.best ? 'closest' : 'revealed');
    });
    $('cdShare').addEventListener('click', () => deps.share(shareText()));
    $('cdArchive').addEventListener('click', () => deps.go('countdown', 'archive'));
    $('cdArchiveBack').addEventListener('click', () => deps.go('countdown', 'archive'));
    $('cdBack').addEventListener('click', () => deps.go('countdown', 'archive'));
    $('cdHow').addEventListener('click', openHelp);
    window.addEventListener('pagehide', save);
    setInterval(tick, 200);
  }
  /* open('daily') or open('archive', epochDay) */
  function open(kind, arg) {
    isOpen = true;
    const today = deps.dayInfo(deps.nowDate());
    if (kind === 'archive' && arg < today.epochDay) load(deps.infoFromEpoch(arg), 'archive');
    else load(today, 'daily');
  }
  function close() { save(); isOpen = false; revealArmed = false; }
  function newDay() {
    // Never swap the puzzle mid-round; the result screen points to the new one instead.
    if (isOpen && state && state.kind === 'daily' && state.status !== 'playing') { save(); load(deps.dayInfo(deps.nowDate()), 'daily'); deps.toast('A new countdown is live'); }
  }

  XolveShell.register('countdown', {
    name: 'Countdown', view: 'countdown', archiveLabel: 'Countdown', levelKey: 'xolve:countdownLevel',
    levels: [], practice: false,
    init, open, close, newDay, archiveStatus, renderStats, openHelp, openBook: openHelp,
    levelIndex: () => null, levelName: () => '',
    resultHost: () => $('cdResult'),
  });
})();

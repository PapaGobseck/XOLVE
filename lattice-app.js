/*
 * XOLVE Lattice mode: the grid, keypad, checking, hints, statistics and worked solution.
 * Needs lattice.js. app.js starts it with init() and shows or hides it with open() / close().
 */
const XolveLatticeUI = (() => {
  'use strict';
  const X = XolveLatticeEngine;
  const $ = (id) => document.getElementById(id);
  const STATS_KEY = 'xolve:lattice-stats';
  // Daily difficulty follows the week: easy Monday, medium Tue/Wed, hard Thu/Fri, extreme at the weekend.
  const WEEK = ['extreme', 'easy', 'medium', 'medium', 'hard', 'hard', 'extreme']; // Sun..Sat
  const levelOn = (epochDay) => WEEK[(((epochDay + 4) % 7) + 7) % 7];
  let E = null; // engine for the current puzzle's grid size

  let deps;                 // { store, nowDate, dayInfo, infoFromEpoch, toast, fmtTime, share, go }
  let state = null;         // the puzzle being played
  let selected = null;      // slot name, or 'k3' for the carry note on diagonal 4
  let isOpen = false, justFinished = false, revealArmed = false;
  let lastTick = 0, saveCounter = 0;
  const cache = {};

  /* ---------- puzzles ---------- */
  const dailySeed = (epochDay) => Math.imul(epochDay ^ 0x2c1b3c6d, 0x9E3779B1) >>> 0;
  const dailyPuzzle = (info) => cache[info.iso] || (cache[info.iso] = X.generate(dailySeed(info.epochDay), levelOn(info.epochDay)));
  const blank = () => ({ entries: {}, scratch: {}, hinted: [], hintLog: [], wrong: [], checks: 0, status: 'playing', elapsed: 0 });
  const keyFor = (info) => 'xolve:lat:' + info.iso;
  const infoFor = (epochDay) => deps.infoFromEpoch(epochDay);

  function start(s) {
    state = s;
    E = X.forPuzzle(state.puzzle);
    selected = null; justFinished = false; revealArmed = false;
    $('latMsg').textContent = '';
    render();
    if (!deps.store.get('xolve:seenLatticeHelp')) { deps.store.set('xolve:seenLatticeHelp', true); openHelp(); }
  }
  function loadDay(info, kind) {
    start(Object.assign(blank(), deps.store.get(keyFor(info)) || {}, { kind, info, key: keyFor(info), puzzle: dailyPuzzle(info) }));
  }
  function loadPractice(level) {
    const seed = (Math.random() * 4294967296) >>> 0;
    start(Object.assign(blank(), { kind: 'practice', info: deps.dayInfo(deps.nowDate()), puzzle: X.generate(seed, level) }));
    window.scrollTo({ top: 0 });
  }
  function save() {
    if (!state || !state.key) return;
    const { entries, scratch, hinted, hintLog, wrong, checks, status } = state;
    deps.store.set(state.key, { entries, scratch, hinted, hintLog, wrong, checks, status, elapsed: Math.round(state.elapsed) });
  }

  /* ---------- helpers ---------- */
  const P = () => state.puzzle;
  const maxHints = () => X.LEVELS[P().level].hints;
  function fmtProduct(digits) {
    const d = digits.slice(), out = [];
    while (d.length > 3) out.unshift(d.splice(-3).join(''));
    out.unshift(d.join(''));
    return out.join(',');
  }
  const isHidden = (s) => P().hidden.includes(s);
  const playing = () => state.status === 'playing';
  function shown(s) {
    if (!isHidden(s)) return P().givens[s];
    return playing() ? state.entries[s] : P().solution[s];
  }
  function knownNow() {
    const known = Object.assign({}, P().givens);
    P().hidden.forEach((s) => { if (state.entries[s] === P().solution[s]) known[s] = state.entries[s]; });
    return known;
  }
  const emptySlots = () => P().hidden.filter((s) => state.entries[s] === undefined);
  function nextEmpty(from) {
    const order = E.ALL_SLOTS.filter((s) => isHidden(s));
    const start = from ? order.indexOf(from) : -1;
    for (let i = 1; i <= order.length; i++) {
      const s = order[(start + i + order.length) % order.length];
      if (state.entries[s] === undefined) return s;
    }
    return null;
  }
  function related(sel) {
    const set = new Set();
    if (!sel) return set;
    let k = null;
    if (sel[0] === 'c') { set.add('a' + sel[2]); set.add('b' + sel[1]); }
    if (sel[0] === 'p') k = +sel.slice(1);
    if (sel[0] === 'k') k = +sel.slice(1);
    if (k !== null) E.DIAGONALS[k].forEach((s) => set.add(s));
    return set;
  }

  /* ---------- lattice markup (also used for the example in How it works) ---------- */
  function latticeHTML(m) {
    const K = m.cols + m.rows;
    const tile = (cls, inner) => `<div class="lc ${cls}">${inner}</div>`;
    let h = `<div class="lattice ${m.cls || ''}" style="grid-template-columns:repeat(${m.cols + 2}, var(--cs))">`;
    h += tile('corner', '');
    for (let c = 0; c < m.cols; c++) h += tile('fbox', m.top(c));
    h += tile('corner times', '×');
    for (let r = 0; r < m.rows; r++) {
      h += tile('pbox', m.carry(K - 1 - r) + m.prod(K - 1 - r));
      for (let c = 0; c < m.cols; c++) {
        const edges = [c === 0 ? 'bl' : '', r === 0 ? 'bt' : '', c === m.cols - 1 ? 'br' : '', r === m.rows - 1 ? 'bb' : ''].join(' ');
        h += tile(`cell ${edges}`, m.half(r, c, 't') + m.half(r, c, 'u'));
      }
      h += tile('fbox', m.side(r));
    }
    h += tile('corner', '');
    for (let c = 0; c < m.cols; c++) h += tile('pbox', m.carry(m.cols - 1 - c) + m.prod(m.cols - 1 - c));
    h += tile('corner', '');
    return h + '</div>';
  }

  function slotHTML(s, pos, rel) {
    const v = shown(s);
    const cls = ['ld', pos];
    if (rel.has(s)) cls.push('rel');
    if (!isHidden(s)) return `<span class="${cls.join(' ')} given">${v}</span>`;
    cls.push('slot');
    if (playing()) {
      if (v === undefined) cls.push('empty');
      else cls.push(state.hinted.includes(s) ? 'hinted' : 'entered');
      if (state.wrong.includes(s)) cls.push('wrong');
      if (s === selected) cls.push('sel');
    } else {
      cls.push(state.hinted.includes(s) ? 'hinted' : state.entries[s] === P().solution[s] ? 'entered' : 'revealed');
    }
    const label = `${E.slotName(s)}: ${v === undefined ? 'empty' : v}`;
    return `<button class="${cls.join(' ')}" data-slot="${s}" aria-label="${label}"${playing() ? '' : ' tabindex="-1"'}>${v === undefined ? '?' : v}</button>`;
  }
  function carryHTML(k) {
    if (playing()) {
      const v = state.scratch[k];
      return `<button class="carry${selected === 'k' + k ? ' sel' : ''}" data-carry="${k}" aria-label="Carry note for diagonal ${k + 1} (not checked)">${v === undefined ? '' : v}</button>`;
    }
    const w = E.diagonalWorking(P().solution)[k];
    return `<span class="carry done">${w.carryIn || ''}</span>`;
  }
  function gridHTML() {
    const rel = related(selected);
    return latticeHTML({
      cols: E.C, rows: E.R,
      top: (c) => slotHTML('a' + c, 'fd', rel),
      side: (r) => slotHTML('b' + r, 'fd', rel),
      half: (r, c, h) => slotHTML(`c${r}${c}${h}`, h === 't' ? 'ht' : 'hu', rel),
      prod: (k) => slotHTML('p' + k, 'pd', rel),
      carry: carryHTML,
    });
  }
  function equationHTML() {
    const d = (s) => { const v = shown(s); const cls = isHidden(s) ? (v === undefined ? 'q' : state.hinted.includes(s) ? 'h' : 'e') : ''; return `<span class="${cls}">${v === undefined ? '?' : v}</span>`; };
    const A = E.A_SLOTS.map(d).join(''), B = E.B_SLOTS.map(d).join('');
    return `${A} × ${B} = ${fmtProduct(E.P_SLOTS.map(d))}`;
  }

  /* ---------- rendering ---------- */
  function render() {
    if (!state) return;
    const kind = state.kind, lvl = P().level, lvlName = X.LEVELS[lvl].name;
    const date = (opts) => new Date(state.info.epochDay * 864e5).toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opts));
    $('latLabel').textContent = kind === 'practice' ? 'Practice' : `Lattice #${state.info.number}`;
    $('latDate').textContent = kind === 'daily' ? `${date({ weekday: 'long' })}, ${lvlName.toLowerCase()}`
      : kind === 'archive' ? `${date({ weekday: 'short', day: 'numeric', month: 'short' })}, ${lvlName.toLowerCase()}`
      : lvlName;
    [...$('latPips').children].forEach((el, i) => el.classList.toggle('on', i <= X.LEVEL_ORDER.indexOf(lvl)));
    $('latBack').hidden = kind !== 'archive';
    $('latEq').innerHTML = equationHTML();
    $('latGrid').innerHTML = gridHTML();

    const on = playing();
    $('latPad').hidden = !on;
    $('latActions').hidden = !on;
    $('latReveal').hidden = !on;
    const left = maxHints() - state.hinted.length;
    $('latHint').disabled = !on || left <= 0;
    $('latHintsMax').textContent = maxHints();
    if (!revealArmed) { $('latReveal').textContent = 'Reveal the solution'; $('latReveal').classList.remove('arm'); }
    $('latHint').textContent = left > 0 ? `Hint (${left} left)` : 'No hints left';
    $('latHints').hidden = !state.hintLog.length || !on;
    $('latHints').innerHTML = state.hintLog.map((t) => `<li>${esc(t)}</li>`).join('');
    $('latChecks').textContent = state.checks;
    $('latHintsUsed').textContent = state.hinted.length;
    $('latTime').textContent = deps.fmtTime(state.elapsed);
    $('latResult').hidden = on;
    if (!on) renderResult();
    else if (!$('latMsg').dataset.keep) $('latMsg').textContent = '';
    delete $('latMsg').dataset.keep;
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function renderResult() {
    const p = P(), won = state.status === 'won';
    $('latVerdict').textContent = won ? 'Solved' : 'Not this time';
    const product = fmtProduct(String(p.A * p.B).split(''));
    const extra = [];
    if (state.hinted.length) extra.push(`${state.hinted.length} ${state.hinted.length === 1 ? 'hint' : 'hints'}`);
    if (state.checks) extra.push(`${state.checks} ${state.checks === 1 ? 'check' : 'checks'}`);
    $('latSummary').textContent = won
      ? `${p.A} × ${p.B} = ${product}, in ${deps.fmtTime(state.elapsed)}${extra.length ? ` with ${extra.join(' and ')}` : ''}.`
      : `It was ${p.A} × ${p.B} = ${product}. Here's how to work it out.`;

    const path = E.solutionPath(p).steps.filter((s) => s.type === 'factor' || s.type === 'trial' || s.type === 'back');
    const diag = E.diagonalWorking(p.solution);
    $('latSteps').innerHTML =
      path.map((s) => `<li>${esc(s.text)}</li>`).join('') +
      `<li>With both numbers known, fill every remaining cell by multiplying its column digit by its row digit.</li>`;
    $('latDiag').innerHTML = diag.map((w) => {
      const sum = w.terms.join(' + ') + (w.carryIn ? ` + ${w.carryIn} carried` : '');
      return `<li><span>Diagonal ${w.k + 1}</span><span>${sum} = ${w.total}</span><span>${w.carryOut ? `write ${w.digit}, carry ${w.carryOut}` : `write ${w.digit}`}</span></li>`;
    }).join('');
    $('latReadOff').textContent = `Reading down the left and along the bottom gives ${product}.`;

    $('latShare').hidden = state.kind === 'practice';
    $('latNew').hidden = state.kind !== 'practice';
    $('latMore').hidden = state.kind !== 'daily';
    $('latArchiveBack').hidden = state.kind !== 'archive';
    updateCountdown();
    if (justFinished) { $('latResult').classList.add('animate'); justFinished = false; } else $('latResult').classList.remove('animate');
  }
  function updateCountdown() {
    const el = $('latNext');
    if (!state || state.kind !== 'daily' || playing()) { el.textContent = ''; return; }
    const n = deps.nowDate(), midnight = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    el.textContent = `Next lattice in ${deps.fmtTime(Math.max(0, midnight - n))}`;
  }
  function say(t) { $('latMsg').textContent = t; $('latMsg').dataset.keep = '1'; }

  /* ---------- playing ---------- */
  function select(s) {
    if (!playing()) return;
    selected = s;
    revealArmed = false;
    render();
  }
  function input(d) {
    if (!state || !playing()) return;
    if (!selected) selected = nextEmpty(null);
    if (!selected) return;
    if (selected[0] === 'k') { state.scratch[selected.slice(1)] = d; render(); save(); return; }
    if (state.hinted.includes(selected)) { say('That digit came from a hint, so it stays.'); render(); return; }
    state.entries[selected] = d;
    state.wrong = state.wrong.filter((s) => s !== selected);
    selected = nextEmpty(selected) || selected;
    render(); save();
  }
  function erase() {
    if (!state || !playing() || !selected) return;
    if (selected[0] === 'k') delete state.scratch[selected.slice(1)];
    else if (!state.hinted.includes(selected)) { delete state.entries[selected]; state.wrong = state.wrong.filter((s) => s !== selected); }
    render(); save();
  }
  function move(step) {
    const order = E.ALL_SLOTS.filter((s) => isHidden(s));
    const i = order.indexOf(selected);
    select(order[(i + step + order.length) % order.length]);
  }

  function check() {
    if (!playing()) return;
    const sol = P().solution;
    const filled = P().hidden.filter((s) => state.entries[s] !== undefined);
    if (!filled.length) { say('Fill in some digits first, then check.'); return; }
    state.checks++;
    state.wrong = filled.filter((s) => !state.hinted.includes(s) && state.entries[s] !== sol[s]);
    const empty = P().hidden.length - filled.length, n = state.wrong.length;
    if (!n && !empty) return finish('won');
    if (n) say(`${n} ${n === 1 ? 'digit is' : 'digits are'} wrong and marked in red.${empty ? ` ${empty} still empty.` : ''}`);
    else say(`Everything so far is right. ${empty} ${empty === 1 ? 'digit' : 'digits'} to go.`);
    render(); save();
  }
  function hint() {
    if (!playing() || state.hinted.length >= maxHints()) return;
    const sol = P().solution;
    const targets = P().hidden.filter((s) => state.entries[s] !== sol[s]);
    if (!targets.length) { say('Everything you\'ve entered is right. Press Check to finish.'); render(); return; }
    let step = E.nextStep(knownNow(), targets);
    if (!step) { const s = targets[0]; step = { slot: s, value: sol[s], text: `${E.slotName(s)} is ${sol[s]}.` }; }
    state.entries[step.slot] = step.value;
    state.hinted.push(step.slot);
    state.wrong = state.wrong.filter((s) => s !== step.slot);
    state.hintLog.push(step.text.charAt(0).toUpperCase() + step.text.slice(1));
    selected = nextEmpty(step.slot);
    const left = maxHints() - state.hinted.length;
    say(`Hint used. ${left ? `${left} left.` : 'That was your last one.'}`);
    if (!emptySlots().length && P().hidden.every((s) => state.entries[s] === sol[s])) return finish('won');
    render(); save();
  }
  function finish(status) {
    state.status = status;
    justFinished = true;
    selected = null;
    if (state.kind === 'daily') recordStats(status === 'won');
    save(); render();
    if (status === 'won') $('latResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- statistics ---------- */
  function loadStats() {
    const base = { played: 0, won: 0, current: 0, max: 0, lastWinDay: null, lastPlayedDay: null, totalTime: 0, totalHints: 0, byLevel: {} };
    const st = Object.assign(base, deps.store.get(STATS_KEY) || {});
    X.LEVEL_ORDER.forEach((l) => (st.byLevel[l] = Object.assign({ played: 0, won: 0 }, st.byLevel[l] || {})));
    return st;
  }
  function liveStreak(st) {
    const today = deps.dayInfo(deps.nowDate()).epochDay;
    return st.lastWinDay !== null && today - st.lastWinDay <= 1 ? st.current : 0;
  }
  function recordStats(won) {
    const st = loadStats(), day = state.info.epochDay;
    if (st.lastPlayedDay === day) return;
    const lv = st.byLevel[P().level];
    st.played++; lv.played++; st.lastPlayedDay = day; st.totalHints += state.hinted.length;
    if (won) {
      st.won++; lv.won++; st.totalTime += Math.round(state.elapsed);
      st.current = st.lastWinDay === day - 1 ? st.current + 1 : 1;
      st.lastWinDay = day; st.max = Math.max(st.max, st.current);
    } else st.current = 0;
    deps.store.set(STATS_KEY, st);
  }
  function renderStats(el, distEl) {
    const st = loadStats();
    const pct = st.played ? Math.round((st.won / st.played) * 100) : 0;
    const figs = [[st.played, 'Played'], [pct + '%', 'Win rate'], [st.won ? deps.fmtTime(st.totalTime / st.won) : '0:00', 'Avg time'],
      [liveStreak(st), 'Current streak'], [st.max, 'Longest streak'], [st.played ? (st.totalHints / st.played).toFixed(1) : '0', 'Avg hints']];
    el.innerHTML = figs.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    const maxPlayed = Math.max(1, ...X.LEVEL_ORDER.map((l) => st.byLevel[l].played));
    distEl.innerHTML = X.LEVEL_ORDER.map((l) => {
      const b = st.byLevel[l];
      return `<div class="bar-row"><span>${X.LEVELS[l].name}</span><span class="bar" role="img" aria-label="${b.won} of ${b.played} solved"><i style="width:${(b.won / maxPlayed) * 100}%"></i></span><span class="v">${b.won}/${b.played}</span></div>`;
    }).join('');
  }

  /* ---------- archive rows (rendered by app.js) ---------- */
  function archiveStatus(info) {
    const s = deps.store.get(keyFor(info));
    if (!s || (!Object.keys(s.entries || {}).length && s.status === 'playing')) return ['', 'Play'];
    if (s.status === 'won') return ['won', 'Solved'];
    if (s.status === 'lost') return ['lost', 'Not solved'];
    return ['', 'In progress'];
  }
  const levelIndex = (epochDay) => X.LEVEL_ORDER.indexOf(levelOn(epochDay));
  const levelName = (epochDay) => X.LEVELS[levelOn(epochDay)].name;
  function shareText() {
    const won = state.status === 'won', h = state.hinted.length;
    return [`XOLVE Lattice #${state.info.number} (${X.LEVELS[P().level].name}${state.kind === 'archive' ? ', archive' : ''})`,
      won ? `✅ Solved in ${deps.fmtTime(state.elapsed)}` : '❌ Not solved',
      `${'💡'.repeat(h) || 'No hints'}${state.checks ? `, ${state.checks} ${state.checks === 1 ? 'check' : 'checks'}` : ''}`,
      liveStreak(loadStats()) && won && state.kind === 'daily' ? `🔥 ${liveStreak(loadStats())}` : '', 'https://xolve.games'].filter(Boolean).join('\n');
  }

  /* ---------- timer ---------- */
  function tick() {
    const now = performance.now();
    if (isOpen && state && playing() && !document.hidden) {
      state.elapsed += now - lastTick;
      $('latTime').textContent = deps.fmtTime(state.elapsed);
      if (++saveCounter % 20 === 0) save();
    }
    lastTick = now;
    if (isOpen) updateCountdown();
  }

  /* ---------- How it works ---------- */
  function exampleHTML() {
    // 47 × 36 = 1692
    const top = [4, 7], side = [3, 6], prod = [2, 9, 6, 1], carry = [0, 0, 0, 0];
    const v = (r, c) => top[c] * side[r];
    return latticeHTML({
      cols: 2, rows: 2, cls: 'mini',
      top: (c) => `<span class="ld fd given">${top[c]}</span>`,
      side: (r) => `<span class="ld fd given">${side[r]}</span>`,
      half: (r, c, h) => `<span class="ld ${h === 't' ? 'ht' : 'hu'} given">${h === 't' ? Math.floor(v(r, c) / 10) : v(r, c) % 10}</span>`,
      prod: (k) => `<span class="ld pd given">${prod[k]}</span>`,
      carry: (k) => `<span class="carry done">${carry[k] || ''}</span>`,
    });
  }
  function openHelp() {
    $('latExample').innerHTML = exampleHTML();
    $('dlgLattice').showModal();
  }

  /* ---------- wiring ---------- */
  function init(d) {
    deps = d;
    $('latGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-slot],[data-carry]');
      if (!b || !playing()) return;
      select(b.dataset.slot || 'k' + b.dataset.carry);
    });
    $('latPad').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.key === 'del') erase(); else input(+b.dataset.key);
    });
    $('latCheck').addEventListener('click', check);
    $('latHint').addEventListener('click', hint);
    $('latReveal').addEventListener('click', () => {
      if (!revealArmed) { revealArmed = true; $('latReveal').textContent = state.kind === 'daily' ? 'Tap again to reveal (counts as not solved)' : 'Tap again to reveal'; $('latReveal').classList.add('arm'); return; }
      finish('lost');
    });
    $('latShare').addEventListener('click', () => deps.share(shareText()));
    $('latNew').addEventListener('click', () => loadPractice(P().level));
    $('latMore').addEventListener('click', () => deps.go('lattice', 'practice'));
    $('latArchiveBack').addEventListener('click', () => { save(); deps.go('lattice', 'archive'); });
    $('latBack').addEventListener('click', () => { save(); deps.go('lattice', 'archive'); });
    $('latHow').addEventListener('click', openHelp);
    document.addEventListener('keydown', (e) => {
      if (!isOpen || !state || !playing() || document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); input(+e.key); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); erase(); }
      else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); check(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    });
    document.addEventListener('visibilitychange', () => { lastTick = performance.now(); if (document.hidden) save(); });
    window.addEventListener('pagehide', save);
    lastTick = performance.now();
    setInterval(tick, 250);
  }
  /* open('daily'), open('archive', epochDay) or open('practice', level) */
  function open(kind, arg) {
    if (state && state.key) save();
    isOpen = true;
    lastTick = performance.now();
    const today = deps.dayInfo(deps.nowDate());
    if (kind === 'daily') loadDay(today, 'daily');
    else if (kind === 'archive') { if (arg >= today.epochDay) loadDay(today, 'daily'); else loadDay(infoFor(arg), 'archive'); }
    else loadPractice(arg || 'medium');
  }
  function close() { isOpen = false; save(); revealArmed = false; }
  function newDay() {
    if (isOpen && state && state.kind === 'daily') { save(); loadDay(deps.dayInfo(deps.nowDate()), 'daily'); deps.toast('A new lattice is live'); }
  }

  return { init, open, close, newDay, renderStats, openHelp, archiveStatus, levelIndex, levelName, LEVEL_ORDER: X.LEVEL_ORDER, LEVELS: X.LEVELS };
})();

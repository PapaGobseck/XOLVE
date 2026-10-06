/*
 * XOLVE shell, shared by every game: trusted clock, storage, toasts, copying results,
 * game and mode navigation, the archive list, the statistics dialog and start-up.
 * Needs shared/calendar.js. Each game's app.js registers itself with XolveShell.register().
 *
 * A game registers an object with:
 *   name, view (id of its screen), archiveLabel, levels [{ id, name }], levelKey,
 *   init(deps), open(kind, arg), close(), newDay(),
 *   archiveStatus(info) -> [cssClass, label], levelIndex(epochDay), levelName(epochDay),
 *   renderStats(), openHelp(), openBook(), resultHost()
 * Optional: practice: false hides the Practice tab for that game, and levelIndex()
 * returning null draws an archive row without difficulty pips.
 * open() is called as open('daily'), open('archive', epochDay) or open('practice', level).
 */
const XolveShell = (() => {
  'use strict';
  const Cal = XolveCalendar;
  const $ = (id) => document.getElementById(id);

  /* ---------- storage (localStorage, with in-memory fallback) ---------- */
  const mem = {};
  const store = {
    get(k) { try { const v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } catch (e) {} return k in mem ? mem[k] : null; },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ---------- formatting ---------- */
  function fmtTime(ms) {
    const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  const fmtDay = (info, opts) => new Date(info.epochDay * 864e5).toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opts));

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

  /* ---------- toasts and copying results ---------- */
  let toastTimer;
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800); }
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
    games[curGame].resultHost().appendChild(box); box.select();
    toast('Copy the result below');
  }

  /* ---------- games ---------- */
  const games = {};
  const order = [];
  function register(id, game) { games[id] = game; order.push(id); }

  let curGame = null, mode = 'daily', today = null;
  /* The saved practice level, or medium (or the game's first level if it has no medium). */
  function levelFor(g) {
    const ids = (games[g].levels || []).map((l) => l.id), saved = store.get(games[g].levelKey);
    return ids.includes(saved) ? saved : ids.includes('medium') ? 'medium' : ids[0];
  }

  /* Show one screen: the archive or a game's view. */
  function showView(id) {
    $('archive').hidden = id !== 'archive';
    order.forEach((g) => { $(games[g].view).hidden = id !== games[g].view; });
  }

  /* ---------- navigation: pick a game, then Today / Archive / Practice ---------- */
  function go(g, m) {
    if (curGame) games[curGame].close();
    if (m === 'practice' && games[g].practice === false) m = 'daily';
    curGame = g; mode = m;
    document.querySelector('.mode[data-mode="practice"]').hidden = games[g].practice === false;
    document.querySelectorAll('.game').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.game === g)));
    document.querySelectorAll('.mode').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    renderLevels();
    today = Cal.dayInfo(nowDate());
    if (m === 'archive') return renderArchive();
    showView(games[g].view);
    games[g].open(m, m === 'practice' ? levelFor(g) : undefined);
  }

  /* Practice difficulty buttons, built from the current game's levels. */
  function renderLevels() {
    const levels = games[curGame].levels || [];
    $('levels').hidden = mode !== 'practice' || !levels.length;
    const current = levelFor(curGame);
    $('levels').innerHTML = levels.map((l) => `<button class="level" data-level="${l.id}" aria-pressed="${l.id === current}">${l.name}</button>`).join('');
  }

  /* ---------- archive ---------- */
  function renderArchive() {
    showView('archive');
    const G = games[curGame];
    const first = today.epochDay - today.number + 1;
    const days = [];
    for (let e = today.epochDay; e >= first; e--) days.push(Cal.infoFromEpoch(e));
    const hasPast = days.length > 1;
    $('archEmpty').hidden = hasPast;
    $('archList').hidden = !hasPast;
    if (!hasPast) {
      $('archEmptyText').textContent = `Past puzzles appear here once their day has passed. Today's is #${today.number}.`;
      return;
    }
    $('archList').innerHTML = days.map((d) => {
      const [cls, label] = G.archiveStatus(d);
      const lvl = G.levelIndex(d.epochDay), lvlName = G.levelName(d.epochDay);
      const pips = lvl === null ? '' : [0, 1, 2, 3].map((i) => `<span${i <= lvl ? ' class="on"' : ''}></span>`).join('');
      const when = d.epochDay === today.epochDay ? 'Today' : fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' });
      return `<li><button class="arch-row" data-epoch="${d.epochDay}" aria-label="${G.archiveLabel} ${d.number}, ${when}, ${lvlName ? lvlName + ', ' : ''}${label}"><span class="an">#${d.number}</span><span>${when}</span><span class="pips" aria-hidden="true">${pips}</span><span class="as ${cls}">${label}</span></button></li>`;
    }).join('');
  }

  /* ---------- dark mode switch ----------
     Untouched, the site follows the device (and keeps following it while open).
     Flipping the switch saves a choice that overrides the device; flipping it back
     to match the device clears the choice, so the site follows the device again. */
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const deviceTheme = () => (darkQuery.matches ? 'dark' : 'light');
  function applyTheme() {
    const chosen = store.get('xolve:theme');
    const root = document.documentElement;
    if (chosen === 'dark' || chosen === 'light') root.dataset.theme = chosen; else delete root.dataset.theme;
    $('btnTheme').setAttribute('aria-checked', String((chosen || deviceTheme()) === 'dark'));
  }
  function toggleTheme() {
    const next = $('btnTheme').getAttribute('aria-checked') === 'true' ? 'light' : 'dark';
    store.set('xolve:theme', next === deviceTheme() ? null : next);
    applyTheme();
  }

  /* ---------- "New here?" note ----------
     Shown until it's dismissed. Players who already saw the old automatic How to play don't get it. */
  const introSeen = () => store.get('xolve:introDismissed') || store.get('xolve:seenHelp') || store.get('xolve:seenLatticeHelp');
  function dismissIntro() { store.set('xolve:introDismissed', true); $('intro').hidden = true; }

  /* ---------- statistics dialog: every game fills in its own section ---------- */
  function openStats() {
    order.forEach((g) => games[g].renderStats());
    $('dlgStats').showModal();
  }

  /* ---------- midnight in the player's time zone ---------- */
  function tick() {
    const current = Cal.dayInfo(nowDate());
    if (!today || current.epochDay === today.epochDay) return;
    today = current;
    if (mode === 'archive' && !$('archive').hidden) renderArchive();
    order.forEach((g) => games[g].newDay());
  }

  /* ---------- events ---------- */
  function wire() {
    document.querySelectorAll('.game').forEach((b) => b.addEventListener('click', () => { if (b.dataset.game !== curGame) go(b.dataset.game, mode); }));
    document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => go(curGame, b.dataset.mode)));
    $('levels').addEventListener('click', (e) => {
      const b = e.target.closest('.level'); if (!b) return;
      store.set(games[curGame].levelKey, b.dataset.level);
      renderLevels();
      games[curGame].open('practice', b.dataset.level);
    });
    $('archList').addEventListener('click', (e) => {
      const b = e.target.closest('.arch-row'); if (!b) return;
      const ep = +b.dataset.epoch;
      if (ep === today.epochDay) return go(curGame, 'daily');
      showView(games[curGame].view);
      games[curGame].open('archive', ep);
    });
    $('btnToday').addEventListener('click', () => go(curGame, 'daily'));
    $('btnStats').addEventListener('click', openStats);
    $('btnHelp').addEventListener('click', () => games[curGame].openHelp());
    $('btnBook').addEventListener('click', () => games[curGame].openBook());
    $('btnTheme').addEventListener('click', toggleTheme);
    darkQuery.addEventListener('change', applyTheme);
    $('introHow').addEventListener('click', () => games[curGame].openHelp());
    $('introClose').addEventListener('click', dismissIntro);
    $('btnHome').addEventListener('click', () => {
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      go(curGame, 'daily');
      window.scrollTo({ top: 0 });
    });
    document.querySelectorAll('dialog').forEach((d) => {
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    });
  }

  /* ---------- start-up (after every game's script has registered) ---------- */
  function boot() {
    order.forEach((g) => { $(games[g].view).hidden = true; });
    applyTheme();
    $('intro').hidden = !!introSeen();
    wire();
    syncClock().then(() => {
      const deps = { store, nowDate, dayInfo: Cal.dayInfo, infoFromEpoch: Cal.infoFromEpoch, toast, fmtTime, fmtDay, share: copyText, go };
      order.forEach((g) => games[g].init(deps));
      go(order[0], 'daily');
      setInterval(tick, 1000);
      setInterval(syncClock, 15 * 60 * 1000);
    });
  }
  document.addEventListener('DOMContentLoaded', boot);

  return { register };
})();

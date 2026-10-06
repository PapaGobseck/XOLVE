/*
 * XOLVE Countdown engine
 * Six numbers drawn from the Countdown pool, and a target from 100 to 999.
 * The solver lists every value the six numbers can make, so each target is
 * guaranteed to have an exact solution. The date is the seed, so every player
 * gets the same daily puzzle.
 *
 * Rules: each number at most once; + − × ÷ only; no step may go negative
 * or leave a remainder.
 */
const XolveCountdown = (() => {
  'use strict';
  const MINUS = '\u2212', TIMES = '\u00d7', DIVIDE = '\u00f7';
  const LARGE = [25, 50, 75, 100];
  const SMALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const POOL = [...LARGE, ...SMALL, ...SMALL]; // one of each large, two of each small
  const PICK = 6, TARGET_MIN = 100, TARGET_MAX = 999, TIME_LIMIT_MS = 60000;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const r = mulberry32(seed); r(); r();
    const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    return {
      int,
      pick: (arr) => arr[int(0, arr.length - 1)],
      shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    };
  }

  /* ---------- solver ----------
     For every subset of the six numbers, work out every value that subset can make
     (using all of it), by splitting it into two smaller subsets and combining their
     values. Each value keeps the expression that uses the fewest numbers, so the
     solution shown after a round is as short as possible.
     An entry is { v: value, e: expression text, p: precedence, n: numbers used }. */
  const PREC_ATOM = 3, PREC_MUL = 2, PREC_ADD = 1;
  const wrap = (x, needs) => (needs ? `(${x.e})` : x.e);
  function combine(a, b, out) {
    // Only steps that can help: no ×1 or ÷1, no zero results, no negatives or remainders.
    const n = a.n + b.n;
    out(a.v + b.v, `${a.e} + ${b.e}`, PREC_ADD, n);
    if (a.v > b.v) out(a.v - b.v, `${a.e} ${MINUS} ${wrap(b, b.p === PREC_ADD)}`, PREC_ADD, n);
    if (b.v > a.v) out(b.v - a.v, `${b.e} ${MINUS} ${wrap(a, a.p === PREC_ADD)}`, PREC_ADD, n);
    if (a.v > 1 && b.v > 1) out(a.v * b.v, `${wrap(a, a.p === PREC_ADD)} ${TIMES} ${wrap(b, b.p === PREC_ADD)}`, PREC_MUL, n);
    if (b.v > 1 && a.v % b.v === 0) out(a.v / b.v, `${wrap(a, a.p === PREC_ADD)} ${DIVIDE} ${wrap(b, b.p !== PREC_ATOM)}`, PREC_MUL, n);
    if (a.v > 1 && b.v % a.v === 0 && a.v !== b.v) out(b.v / a.v, `${wrap(b, b.p === PREC_ADD)} ${DIVIDE} ${wrap(a, a.p !== PREC_ATOM)}`, PREC_MUL, n);
  }
  function solve(numbers) {
    const k = numbers.length, full = (1 << k) - 1;
    const byMask = new Array(full + 1);
    for (let i = 0; i < k; i++) byMask[1 << i] = new Map([[numbers[i], { v: numbers[i], e: String(numbers[i]), p: PREC_ATOM, n: 1 }]]);
    for (let mask = 1; mask <= full; mask++) {
      if (byMask[mask]) continue;
      const here = new Map();
      const out = (v, e, p, n) => { const old = here.get(v); if (!old || n < old.n) here.set(v, { v, e, p, n }); };
      // Each split {A, B} once: A holds the lowest set bit of the mask.
      const low = mask & -mask;
      for (let a = (mask - 1) & mask; a > 0; a = (a - 1) & mask) {
        if (!(a & low)) continue;
        const b = mask ^ a;
        for (const x of byMask[a].values()) for (const y of byMask[b].values()) combine(x, y, out);
      }
      byMask[mask] = here;
    }
    // Merge: the best expression for each value across all subsets.
    const best = new Map();
    for (let mask = 1; mask <= full; mask++) {
      for (const x of byMask[mask].values()) { const old = best.get(x.v); if (!old || x.n < old.n) best.set(x.v, x); }
    }
    return best;
  }

  /* ---------- puzzles ---------- */
  function buildPuzzle(seed, meta) {
    const r = makeRng(seed);
    for (let tries = 0; tries < 50; tries++) {
      const numbers = r.shuffle(POOL).slice(0, PICK).sort((x, y) => y - x); // large first, like the show's board
      const reach = solve(numbers);
      // A target that is one of the six numbers would be solved by typing it, so leave those out.
      const targets = [...reach.keys()].filter((v) => v >= TARGET_MIN && v <= TARGET_MAX && !numbers.includes(v)).sort((x, y) => x - y);
      if (!targets.length) continue; // practically never happens; draw again
      const target = r.pick(targets);
      return { id: meta.id, date: meta.date, numbers, target, solution: reach.get(target).e, solutionNumbersUsed: reach.get(target).n };
    }
    throw new Error('Could not generate a countdown puzzle');
  }
  function dailyPuzzle(info) {
    // Different salt from the algebra game, so the two don't follow the same sequence.
    const seed = Math.imul(info.epochDay ^ 0x2c1b3c6d, 2654435761) >>> 0;
    return buildPuzzle(seed, { id: info.number, date: info.iso });
  }

  /* ---------- checking a typed answer ----------
     check('(75 − 5) × 10 + 3', numbers) → { ok: true, value: 703, used: [75, 5, 10, 3] }
     or { ok: false, reason: '…' }. Steps are evaluated in the order written, with the usual
     precedence, and every step must stay a whole number of zero or more.
     Accepts − or -, × or * or x, ÷ or /. */
  function tokenize(s) {
    const tokens = [];
    const src = s.replace(/\s+/g, '');
    for (let i = 0; i < src.length;) {
      const c = src[i];
      if (/\d/.test(c)) { let j = i; while (j < src.length && /\d/.test(src[j])) j++; tokens.push({ t: 'num', v: Number(src.slice(i, j)) }); i = j; continue; }
      if ('+-\u2212*\u00d7xX/\u00f7()'.includes(c)) {
        const op = c === '-' || c === MINUS ? '-' : c === '*' || c === TIMES || c === 'x' || c === 'X' ? '*' : c === '/' || c === DIVIDE ? '/' : c;
        tokens.push({ t: op }); i++; continue;
      }
      return { error: `"${c}" isn't allowed` };
    }
    return { tokens };
  }
  class CheckError extends Error {}
  function check(input, numbers) {
    const tk = tokenize(String(input));
    if (tk.error) return { ok: false, reason: tk.error };
    const tokens = tk.tokens;
    if (!tokens.length) return { ok: false, reason: 'Enter a calculation' };
    const left = numbers.slice(), used = [];
    let i = 0;
    const peek = () => tokens[i] && tokens[i].t;
    const sym = (op) => (op === '-' ? MINUS : op === '*' ? TIMES : op === '/' ? DIVIDE : op);
    function factor() {
      const tok = tokens[i];
      if (!tok) throw new CheckError('The calculation ends too soon');
      if (tok.t === 'num') {
        i++;
        const at = left.indexOf(tok.v);
        if (at < 0) throw new CheckError(numbers.includes(tok.v) ? `You've already used every ${tok.v}` : `${tok.v} isn't one of today's numbers`);
        left.splice(at, 1); used.push(tok.v);
        return tok.v;
      }
      if (tok.t === '(') {
        i++;
        const v = expr();
        if (peek() !== ')') throw new CheckError('A bracket is missing');
        i++;
        return v;
      }
      throw new CheckError(tok.t === ')' ? 'A bracket is closed before it opens' : `Expected a number before ${sym(tok.t)}`);
    }
    function term() {
      let v = factor();
      while (peek() === '*' || peek() === '/') {
        const op = tokens[i++].t, w = factor();
        if (op === '*') v *= w;
        else if (w === 0) throw new CheckError("You can't divide by zero");
        else if (v % w !== 0) throw new CheckError(`${v} ${DIVIDE} ${w} isn't a whole number`);
        else v /= w;
      }
      return v;
    }
    function expr() {
      let v = term();
      while (peek() === '+' || peek() === '-') {
        const op = tokens[i++].t, w = term();
        if (op === '+') v += w;
        else if (w > v) throw new CheckError(`${v} ${MINUS} ${w} goes below zero`);
        else v -= w;
      }
      return v;
    }
    try {
      const value = expr();
      if (i < tokens.length) throw new CheckError(tokens[i].t === ')' ? 'There is an extra closing bracket' : 'Something is missing between two parts');
      return { ok: true, value, used };
    } catch (e) {
      if (e instanceof CheckError) return { ok: false, reason: e.message };
      throw e;
    }
  }

  return {
    MINUS, TIMES, DIVIDE, LARGE, SMALL, POOL, PICK, TARGET_MIN, TARGET_MAX, TIME_LIMIT_MS,
    solve, buildPuzzle, dailyPuzzle, check,
  };
})();

if (typeof module !== 'undefined') module.exports = XolveCountdown; // lets Node run the tests

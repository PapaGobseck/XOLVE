/*
 * XOLVE Lattice engine
 * Multiplication laid out as a lattice, at four difficulty levels.
 * Digits are hidden only while the puzzle still has exactly one solution.
 *
 * Slot names:
 *   a0..     digits of the top number (left to right)
 *   b0..     digits of the side number (top to bottom)
 *   cRCt/u   tens / units of the cell in row R, column C
 *   p0..     product digits, p0 = units (bottom right)
 */
const XolveLatticeEngine = (() => {
  'use strict';

  /* Grid size, digits to hide, how many digits of the two numbers to try hiding,
     the most "try each option" steps allowed, and hints per puzzle. */
  const LEVELS = {
    easy:    { name: 'Easy',    C: 3, R: 2, hide: 9,  hideA: 2, hideB: 1, minFactors: 2, maxTrials: 0, hints: 3 },
    medium:  { name: 'Medium',  C: 4, R: 3, hide: 18, hideA: 3, hideB: 2, minFactors: 4, maxTrials: 0, hints: 4 },
    hard:    { name: 'Hard',    C: 4, R: 3, hide: 24, hideA: 3, hideB: 2, minFactors: 4, maxTrials: 1, hints: 5 },
    extreme: { name: 'Extreme', C: 4, R: 3, hide: 29, hideA: 4, hideB: 2, minFactors: 5, maxTrials: 2, hints: 6 },
  };
  const LEVEL_ORDER = ['easy', 'medium', 'hard', 'extreme'];

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
      shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    };
  }

  /* Everything that depends on the grid size (C columns × R rows). */
  const engines = {};
  function sized(C, R) {
    const key = C + 'x' + R;
    if (engines[key]) return engines[key];
    const K = C + R;
    const pow = (n) => 10 ** n;
    /* ---------- slots and diagonals ---------- */
    const range = (n) => Array.from({ length: n }, (_, i) => i);
    const A_SLOTS = range(C).map((c) => 'a' + c);
    const B_SLOTS = range(R).map((r) => 'b' + r);
    const CELL_SLOTS = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) CELL_SLOTS.push(`c${r}${c}t`, `c${r}${c}u`);
    const P_SLOTS = range(K).map((i) => 'p' + (K - 1 - i));
    const ALL_SLOTS = [...A_SLOTS, ...B_SLOTS, ...CELL_SLOTS, ...P_SLOTS];

    // Diagonal 0 is the bottom-right corner. A cell's units sit on diagonal d, its tens on d + 1.
    const diagOf = (r, c) => (R - 1 - r) + (C - 1 - c);
    const DIAGONALS = Array.from({ length: K }, () => []);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      DIAGONALS[diagOf(r, c)].push(`c${r}${c}u`);
      DIAGONALS[diagOf(r, c) + 1].push(`c${r}${c}t`);
    }
    const isFactor = (s) => s[0] === 'a' || s[0] === 'b';

    function solutionFor(A, B) {
      const a = String(A).split('').map(Number), b = String(B).split('').map(Number), P = A * B;
      const sol = {};
      a.forEach((d, c) => (sol['a' + c] = d));
      b.forEach((d, r) => (sol['b' + r] = d));
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const v = a[c] * b[r];
        sol[`c${r}${c}t`] = Math.floor(v / 10);
        sol[`c${r}${c}u`] = v % 10;
      }
      for (let k = 0; k < K; k++) sol['p' + k] = Math.floor(P / 10 ** k) % 10;
      return sol;
    }

    /* Diagonal sums, with the carry coming into each diagonal. */
    function diagonalWorking(sol) {
      const out = [];
      let carry = 0;
      for (let k = 0; k < K; k++) {
        const terms = DIAGONALS[k].map((s) => sol[s]);
        const total = terms.reduce((x, y) => x + y, 0) + carry;
        out.push({ k, terms, carryIn: carry, total, digit: total % 10, carryOut: Math.floor(total / 10) });
        carry = Math.floor(total / 10);
      }
      return out;
    }

    /* ---------- solver: every (A, B) consistent with the known digits ---------- */
    function solve(known, limit = 2) {
      const out = [];
      const kv = (s) => known[s];
      for (let B = pow(R - 1); B < pow(R); B++) {
        const b = String(B).split('').map(Number);
        let bad = false;
        for (let r = 0; r < R; r++) if (kv('b' + r) !== undefined && kv('b' + r) !== b[r]) { bad = true; break; }
        if (bad) continue;
        const cand = [];
        for (let c = 0; c < C && !bad; c++) {
          const list = [];
          for (let a = c === 0 ? 1 : 0; a <= 9; a++) {
            if (kv('a' + c) !== undefined && kv('a' + c) !== a) continue;
            let fit = true;
            for (let r = 0; r < R; r++) {
              const v = a * b[r], t = kv(`c${r}${c}t`), u = kv(`c${r}${c}u`);
              if ((t !== undefined && t !== Math.floor(v / 10)) || (u !== undefined && u !== v % 10)) { fit = false; break; }
            }
            if (fit) list.push(a);
          }
          if (!list.length) bad = true; else cand.push(list);
        }
        if (bad) continue;
        const walk = (c, A) => {
          if (c === C) {
            const P = A * B;
            if (P < pow(K - 1)) return false; // the product never starts with 0
            for (let k = 0; k < K; k++) {
              const pk = kv('p' + k);
              if (pk !== undefined && pk !== Math.floor(P / pow(k)) % 10) return false;
            }
            out.push({ A, B });
            return out.length >= limit;
          }
          for (const a of cand[c]) if (walk(c + 1, A * 10 + a)) return true;
          return false;
        };
        if (walk(0, 0)) return out;
      }
      return out;
    }

    /* ---------- deductions (used for hints and the worked solution) ---------- */
    const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
    function slotName(s) {
      if (s[0] === 'a') return `the ${ORD[+s[1]]} digit of the top number`;
      if (s[0] === 'b') return `the ${ORD[+s[1]]} digit of the side number`;
      if (s[0] === 'p') return `product digit ${K - +s.slice(1)}`;
      return `the ${s[3] === 't' ? 'tens' : 'units'} digit in row ${+s[1] + 1}, column ${+s[2] + 1}`;
    }
    const join = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
    const orList = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' or ' + xs[xs.length - 1]);

    /* What the grid alone says about one unknown factor digit. */
    function localFactor(known, slot) {
      const isA = slot[0] === 'a', idx = +slot[1];
      const domain = []; for (let d = idx === 0 ? 1 : 0; d <= 9; d++) domain.push(d);
      const constraints = [];
      const others = range(isA ? R : C);
      for (const o of others) {
        const other = known[(isA ? 'b' : 'a') + o];
        if (other === undefined) continue;
        const r = isA ? o : idx, c = isA ? idx : o;
        const t = known[`c${r}${c}t`], u = known[`c${r}${c}u`];
        if (t === undefined && u === undefined) continue;
        const set = domain.filter((d) => { const v = d * other; return (t === undefined || t === Math.floor(v / 10)) && (u === undefined || u === v % 10); });
        const expr = isA ? `? × ${other}` : `${other} × ?`;
        let text;
        if (t !== undefined && u !== undefined) text = `${expr} = ${t ? '' + t + u : u}`;
        else if (u !== undefined) text = `${expr} ends in ${u}`;
        else text = t === 0 ? `${expr} is less than 10` : `${expr} is in the ${t}0s`;
        constraints.push({ set, text });
      }
      let cands = domain;
      constraints.forEach((x) => (cands = cands.filter((d) => x.set.includes(d))));
      return { cands, constraints };
    }
    function explainFactor(constraints, value) {
      // Pick the fewest clues that pin the digit down.
      let cands = null; const used = [];
      const pool = constraints.slice().sort((x, y) => x.set.length - y.set.length);
      while (pool.length && (!cands || cands.length > 1)) {
        pool.sort((x, y) => (cands ? x.set.filter((d) => cands.includes(d)).length - y.set.filter((d) => cands.includes(d)).length : x.set.length - y.set.length));
        const next = pool.shift();
        const narrowed = cands ? cands.filter((d) => next.set.includes(d)) : next.set;
        if (cands && narrowed.length === cands.length) continue;
        cands = narrowed; used.push(next.text);
      }
      return `${join(used)}, so it must be ${value}.`;
    }

    function knownDiagonalsBelow(known, k) {
      for (let j = 0; j < k; j++) if (DIAGONALS[j].some((s) => known[s] === undefined)) return false;
      return true;
    }
    function carryInto(known, k) {
      let carry = 0;
      for (let j = 0; j < k; j++) carry = Math.floor((DIAGONALS[j].reduce((x, s) => x + known[s], 0) + carry) / 10);
      return carry;
    }

    /* The next sensible step from what's known. `targets` limits which slots may be filled. */
    function nextStep(known, targets) {
      const open = targets.filter((s) => known[s] === undefined);
      if (!open.length) return null;

      // 1. A factor digit pinned down by the cells around it.
      for (const s of open.filter(isFactor)) {
        const { cands, constraints } = localFactor(known, s);
        if (cands.length === 1 && constraints.length) return { slot: s, value: cands[0], type: 'factor', text: `For ${slotName(s)}: ${explainFactor(constraints, cands[0])}` };
      }
      // 2. A cell whose row and column digits are both known.
      for (const s of open.filter((x) => x[0] === 'c')) {
        const r = +s[1], c = +s[2], a = known['a' + c], b = known['b' + r];
        if (a === undefined || b === undefined) continue;
        const v = a * b, value = s[3] === 't' ? Math.floor(v / 10) : v % 10;
        return { slot: s, value, type: 'cell', text: `${a} × ${b} = ${v < 10 ? '0' + v : v}, so ${slotName(s)} is ${value}.` };
      }
      // 3. A cell worked back from a product digit.
      for (let k = 0; k < K; k++) {
        const missing = DIAGONALS[k].filter((s) => known[s] === undefined);
        if (missing.length !== 1 || known['p' + k] === undefined || !open.includes(missing[0]) || !knownDiagonalsBelow(known, k)) continue;
        const carry = carryInto(known, k), have = DIAGONALS[k].filter((s) => s !== missing[0]).map((s) => known[s]);
        const sum = have.reduce((x, y) => x + y, 0) + carry;
        const value = (((known['p' + k] - sum) % 10) + 10) % 10;
        const parts = have.length ? join(have.map(String)).replace(/, | and /g, ' + ') : '0';
        return { slot: missing[0], value, type: 'back', text: `Diagonal ${k + 1} has to end in ${known['p' + k]}. The other digits make ${parts}${carry ? ` plus a carry of ${carry}` : ''} = ${sum}, so ${slotName(missing[0])} is ${value}.` };
      }
      // 4. A product digit from a finished diagonal.
      for (let k = 0; k < K; k++) {
        const s = 'p' + k;
        if (!open.includes(s) || DIAGONALS[k].some((x) => known[x] === undefined) || !knownDiagonalsBelow(known, k)) continue;
        const carry = carryInto(known, k), terms = DIAGONALS[k].map((x) => known[x]);
        const total = terms.reduce((x, y) => x + y, 0) + carry;
        const sumText = terms.join(' + ') + (carry ? ` + ${carry} carried` : '');
        return { slot: s, value: total % 10, type: 'product', text: `Diagonal ${k + 1}: ${sumText} = ${total}, so ${slotName(s)} is ${total % 10}${total >= 10 ? ` (carry ${Math.floor(total / 10)})` : ''}.` };
      }
      // 5. Trial: only one option for a factor digit fits every clue.
      let best = null;
      for (const s of open.filter(isFactor)) {
        const { cands } = localFactor(known, s);
        if (!best || cands.length < best.cands.length) best = { s, cands };
      }
      if (best) {
        const viable = best.cands.filter((d) => solve(Object.assign({}, known, { [best.s]: d }), 1).length);
        if (viable.length === 1) {
          const v = viable[0];
          const opts = best.cands.length <= 4 ? `From the grid it could be ${orList(best.cands.map(String))}, but only` : 'Only';
          return { slot: best.s, value: v, type: 'trial', text: `For ${slotName(best.s)}: ${opts} ${v} makes every other digit, including the product, fit.` };
        }
      }
      return null;
    }

    function solutionPath(puzzle) {
      const known = Object.assign({}, puzzle.givens);
      const steps = [];
      for (let guard = 0; guard < 60; guard++) {
        const step = nextStep(known, puzzle.hidden);
        if (!step) break;
        known[step.slot] = step.value;
        steps.push(step);
      }
      return { steps, complete: puzzle.hidden.every((s) => known[s] !== undefined), trials: steps.filter((s) => s.type === 'trial').length };
    }

    return engines[key] = { C, R, K, A_SLOTS, B_SLOTS, CELL_SLOTS, P_SLOTS, ALL_SLOTS, DIAGONALS, diagOf, solutionFor, diagonalWorking, solve, nextStep, solutionPath, slotName, isFactor };
  }

  /* ---------- generator ---------- */
  function generate(seed, level = 'hard') {
    const cfg = LEVELS[level];
    const E = sized(cfg.C, cfg.R);
    const rng = makeRng(seed);
    const digits = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 10 + rng.int(1, 9); return v; };
    for (let attempt = 0; attempt < 60; attempt++) {
      let A, B;
      do { A = digits(cfg.C); B = digits(cfg.R); } while (A * B < 10 ** (E.K - 1));
      const solution = E.solutionFor(A, B);
      const known = Object.assign({}, solution);
      const hidden = [];
      // Try hiding digits of the two numbers first, then cells and product digits.
      const order = [...rng.shuffle(E.A_SLOTS).slice(0, cfg.hideA), ...rng.shuffle(E.B_SLOTS).slice(0, cfg.hideB), ...rng.shuffle([...E.CELL_SLOTS, ...E.P_SLOTS])];
      for (const s of order) {
        if (hidden.length >= cfg.hide) break;
        const v = known[s];
        delete known[s];
        if (E.solve(known, 2).length === 1) hidden.push(s); else known[s] = v;
      }
      if (hidden.length < cfg.hide || hidden.filter(E.isFactor).length < cfg.minFactors) continue;
      const puzzle = { level, C: cfg.C, R: cfg.R, A, B, solution, givens: known, hidden: E.ALL_SLOTS.filter((s) => hidden.includes(s)) };
      const path = E.solutionPath(puzzle);
      if (!path.complete || path.trials > cfg.maxTrials) continue;
      return puzzle;
    }
    throw new Error('Could not generate a lattice puzzle');
  }

  return { LEVELS, LEVEL_ORDER, sized, generate, forPuzzle: (p) => sized(p.C, p.R) };
})();

if (typeof module !== 'undefined') module.exports = XolveLatticeEngine;

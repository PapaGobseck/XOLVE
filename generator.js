/*
 * XOLVE puzzle engine
 * Builds every equation backwards from a chosen answer, so each puzzle has a known,
 * correct solution. The date is the seed, so every player gets the same daily puzzle.
 */
const XolveGenerator = (() => {
  'use strict';
  const MINUS = '\u2212';
  const LAUNCH_EPOCH_DAY = Date.UTC(2026, 9, 1) / 864e5; // Puzzle #1 = 1 October 2026
  const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
  const WEEKDAY_DIFFICULTY = ['expert', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert']; // Sun..Sat
  const MAX_ATTEMPTS = 6;

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
    const r = mulberry32(seed);
    r(); r();
    return {
      int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      chance: (p) => r() < p,
    };
  }

  /* Notation: plain text with '−' for minus, implicit multiplication, {num|den} for fractions. */
  const num = (v) => (v < 0 ? MINUS + (-v) : String(v));
  const cx = (a) => (a === 1 ? 'x' : a === -1 ? MINUS + 'x' : num(a) + 'x');
  const plusC = (b) => (b === 0 ? '' : b > 0 ? ` + ${b}` : ` ${MINUS} ${-b}`);
  const plusX = (a) => (a === 0 ? '' : a > 0 ? ` + ${cx(a)}` : ` ${MINUS} ${cx(-a)}`);
  const fr = (n, d) => `{${n}|${d}}`;
  const paren = (k, inner) => (k === 1 ? '' : k === -1 ? MINUS : num(k)) + `(${inner})`;
  const S = (lhs, rhs, note) => ({ lhs, rhs: typeof rhs === 'number' ? num(rhs) : rhs, note });
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const lcm = (a, b) => (a * b) / gcd(a, b);
  function divideStep(steps, k, x) {
    if (k !== 1) steps.push(S('x', x, `Divide both sides by ${num(k)}`));
  }

  /* Every template picks x first, then builds the equation around it (spec section 5). */
  const TEMPLATES = {
    easy: [
      (r) => { const x = r.int(2, 25), a = r.int(2, 15);
        return { x, lhs: `x${plusC(a)}`, rhs: x + a, ops: 1, steps: [S('x', x, `Subtract ${a} from both sides`)] }; },
      (r) => { const a = r.int(2, 12), x = r.int(a + 2, a + 20);
        return { x, lhs: `x${plusC(-a)}`, rhs: x - a, ops: 1, steps: [S('x', x, `Add ${a} to both sides`)] }; },
      (r) => { const a = r.int(2, 9), x = r.int(2, 12);
        return { x, lhs: cx(a), rhs: a * x, ops: 1, steps: [S('x', x, `Divide both sides by ${a}`)] }; },
      (r) => { const a = r.int(2, 6), k = r.int(2, 9), x = a * k;
        return { x, lhs: fr('x', a), rhs: k, ops: 1, steps: [S('x', x, `Multiply both sides by ${a}`)] }; },
      (r) => { const a = r.int(2, 15), x = r.int(2, 25);
        return { x, lhs: `${a} + x`, rhs: a + x, ops: 1, steps: [S('x', x, `Subtract ${a} from both sides`)] }; },
      (r) => { const x = r.int(2, 25), a = r.int(2, 15);
        return { x, lhs: String(x + a), rhs: `x${plusC(a)}`, ops: 1, steps: [S('x', x, `Subtract ${a} from both sides`)] }; },
      (r) => { const a = r.int(2, 9), x = r.int(2, 12);
        return { x, lhs: String(a * x), rhs: cx(a), ops: 1, steps: [S('x', x, `Divide both sides by ${a}`)] }; },
    ],
    medium: [
      (r) => { const a = r.int(2, 9), b = r.int(1, 20), x = r.int(2, 12);
        return { x, lhs: `${cx(a)}${plusC(b)}`, rhs: a * x + b, ops: 2,
          steps: [S(cx(a), a * x, `Subtract ${b} from both sides`), S('x', x, `Divide both sides by ${a}`)] }; },
      (r) => { const a = r.int(2, 9), x = r.int(3, 12), b = r.int(1, Math.min(20, a * x - 1));
        return { x, lhs: `${cx(a)}${plusC(-b)}`, rhs: a * x - b, ops: 2,
          steps: [S(cx(a), a * x, `Add ${b} to both sides`), S('x', x, `Divide both sides by ${a}`)] }; },
      (r) => { const a = r.int(2, 9), b = r.int(1, 9), x = r.int(2, 12);
        return { x, lhs: paren(a, `x${plusC(b)}`), rhs: a * (x + b), ops: 2,
          steps: [S(`x${plusC(b)}`, x + b, `Divide both sides by ${a}`), S('x', x, `Subtract ${b} from both sides`)] }; },
      (r) => { const a = r.int(2, 9), b = r.int(1, 9), x = r.int(b + 1, b + 12);
        return { x, lhs: paren(a, `x${plusC(-b)}`), rhs: a * (x - b), ops: 2,
          steps: [S(`x${plusC(-b)}`, x - b, `Divide both sides by ${a}`), S('x', x, `Add ${b} to both sides`)] }; },
      (r) => { const a = r.int(2, 5), k = r.int(2, 9), x = a * k, b = r.int(1, 15);
        return { x, lhs: `${fr('x', a)}${plusC(b)}`, rhs: k + b, ops: 2,
          steps: [S(fr('x', a), k, `Subtract ${b} from both sides`), S('x', x, `Multiply both sides by ${a}`)] }; },
      (r) => { const a = r.int(2, 9), b = r.int(1, 20), x = r.int(2, 12);
        return { x, lhs: `${b} + ${cx(a)}`, rhs: a * x + b, ops: 2,
          steps: [S(cx(a), a * x, `Subtract ${b} from both sides`), S('x', x, `Divide both sides by ${a}`)] }; },
      (r) => { const a = r.int(2, 9), x = r.int(3, 12), b = r.int(1, Math.min(20, a * x - 1));
        return { x, lhs: String(a * x - b), rhs: `${cx(a)}${plusC(-b)}`, ops: 2,
          steps: [S(String(a * x), cx(a), `Add ${b} to both sides`), S('x', x, `Divide both sides by ${a}`)] }; },
      (r) => { const b = r.int(2, 6), a = r.int(2, 7), k = r.int(2, 9), x = b * k;
        return { x, lhs: fr(cx(a), b), rhs: a * k, ops: 2,
          steps: [S(cx(a), a * x, `Multiply both sides by ${b}`), S('x', x, `Divide both sides by ${a}`)] }; },
      (r) => { const a = r.int(2, 5), k = r.int(3, 12), x = a * k, b = r.int(1, k - 1);
        return { x, lhs: `${fr('x', a)}${plusC(-b)}`, rhs: k - b, ops: 2,
          steps: [S(fr('x', a), k, `Add ${b} to both sides`), S('x', x, `Multiply both sides by ${a}`)] }; },
    ],
    hard: [
      // ax + b = cx + d
      (r) => { const c = r.int(1, 6), a = r.int(c + 2, c + 6), x = r.int(2, 12), b = r.int(1, 15), k = a - c, d = k * x + b;
        const steps = [S(`${cx(k)}${plusC(b)}`, d, `Subtract ${cx(c)} from both sides`), S(cx(k), k * x, `Subtract ${b} from both sides`)];
        divideStep(steps, k, x);
        return { x, lhs: `${cx(a)}${plusC(b)}`, rhs: `${cx(c)}${plusC(d)}`, ops: 3, steps }; },
      // a(x − b) + c = d
      (r) => { const a = r.int(2, 7), b = r.int(1, 8), x = r.int(b + 1, b + 10), c = r.int(1, 15), d = a * (x - b) + c;
        return { x, lhs: `${paren(a, `x${plusC(-b)}`)}${plusC(c)}`, rhs: d, ops: 3,
          steps: [S(paren(a, `x${plusC(-b)}`), d - c, `Subtract ${c} from both sides`),
                  S(`x${plusC(-b)}`, x - b, `Divide both sides by ${a}`),
                  S('x', x, `Add ${b} to both sides`)] }; },
      // a(x + b) = cx + d
      (r) => { const c = r.int(1, 5), a = r.int(c + 2, c + 5), b = r.int(1, 6), x = r.int(2, 12), k = a - c, d = k * x + a * b;
        const steps = [S(`${cx(a)}${plusC(a * b)}`, `${cx(c)}${plusC(d)}`, 'Expand the bracket'),
                       S(`${cx(k)}${plusC(a * b)}`, d, `Subtract ${cx(c)} from both sides`),
                       S(cx(k), k * x, `Subtract ${a * b} from both sides`)];
        divideStep(steps, k, x);
        return { x, lhs: paren(a, `x${plusC(b)}`), rhs: `${cx(c)}${plusC(d)}`, ops: 4, steps }; },
      // (ax + b)/c = d
      (r) => { const c = r.int(2, 5), a = r.int(2, 6), x = r.int(2, 12); let b = r.int(1, 12);
        b += (c - ((a * x + b) % c)) % c; const d = (a * x + b) / c;
        return { x, lhs: fr(`${cx(a)}${plusC(b)}`, c), rhs: d, ops: 3,
          steps: [S(`${cx(a)}${plusC(b)}`, a * x + b, `Multiply both sides by ${c}`),
                  S(cx(a), a * x, `Subtract ${b} from both sides`),
                  S('x', x, `Divide both sides by ${a}`)] }; },
      // ax − b = cx + d
      (r) => { for (;;) { const c = r.int(1, 6), a = r.int(c + 2, c + 6), x = r.int(2, 12), b = r.int(1, 15), k = a - c, d = k * x - b;
        if (d <= 0) continue;
        const steps = [S(`${cx(k)}${plusC(-b)}`, d, `Subtract ${cx(c)} from both sides`), S(cx(k), k * x, `Add ${b} to both sides`)];
        divideStep(steps, k, x);
        return { x, lhs: `${cx(a)}${plusC(-b)}`, rhs: `${cx(c)}${plusC(d)}`, ops: 3, steps }; } },
      // a(x + b) = c(x + d)
      (r) => { for (;;) { const c = r.int(2, 5), a = r.int(c + 1, c + 4), b = r.int(1, 6), x = r.int(2, 12);
        if ((a * (x + b)) % c) continue;
        const d = (a * (x + b)) / c - x, k = a - c; if (d > 20) continue;
        const steps = [S(`${cx(a)}${plusC(a * b)}`, `${cx(c)}${plusC(c * d)}`, 'Expand both brackets'),
                       S(`${cx(k)}${plusC(a * b)}`, c * d, `Subtract ${cx(c)} from both sides`),
                       S(cx(k), k * x, `Subtract ${a * b} from both sides`)];
        divideStep(steps, k, x);
        return { x, lhs: paren(a, `x${plusC(b)}`), rhs: paren(c, `x${plusC(d)}`), ops: 4, steps }; } },
      // ax + b + cx = d
      (r) => { const a = r.int(2, 6), c = r.int(1, 5), b = r.int(1, 15), x = r.int(2, 12), k = a + c, d = k * x + b;
        return { x, lhs: `${cx(a)}${plusC(b)}${plusX(c)}`, rhs: d, ops: 3,
          steps: [S(`${cx(k)}${plusC(b)}`, d, 'Collect like terms'), S(cx(k), k * x, `Subtract ${b} from both sides`), S('x', x, `Divide both sides by ${k}`)] }; },
    ],
    expert: [
      // a(bx − c) − d(x + e) = f
      (r) => { let a, b, d; do { a = r.int(2, 5); b = r.int(2, 4); d = r.int(1, 5); } while (a * b - d < 2);
        const c = r.int(1, 6), e = r.int(1, 6), x = r.int(2, 12), k = a * b - d, K = a * c + d * e, f = k * x - K;
        const second = d === 1 ? ` ${MINUS} (x${plusC(e)})` : ` ${MINUS} ${d}(x${plusC(e)})`;
        const steps = [S(`${cx(a * b)}${plusC(-a * c)}${plusX(-d)}${plusC(-d * e)}`, f, 'Expand both brackets'),
                       S(`${cx(k)}${plusC(-K)}`, f, 'Collect like terms'),
                       S(cx(k), k * x, `Add ${K} to both sides`)];
        divideStep(steps, k, x);
        return { x, lhs: `${paren(a, `${cx(b)}${plusC(-c)}`)}${second}`, rhs: f, ops: 5, steps }; },
      // (ax − b)/c + d = e
      (r) => { const c = r.int(2, 5), a = r.int(2, 7), x = r.int(2, 12); let b = r.int(1, 12);
        b += (((a * x - b) % c) + c) % c; const q = (a * x - b) / c, d = r.int(1, 12), e = q + d;
        return { x, lhs: `${fr(`${cx(a)}${plusC(-b)}`, c)}${plusC(d)}`, rhs: e, ops: 4,
          steps: [S(fr(`${cx(a)}${plusC(-b)}`, c), q, `Subtract ${d} from both sides`),
                  S(`${cx(a)}${plusC(-b)}`, a * x - b, `Multiply both sides by ${c}`),
                  S(cx(a), a * x, `Add ${b} to both sides`),
                  S('x', x, `Divide both sides by ${a}`)] }; },
      // x/a ± x/b = c
      (r) => { let a, b; do { a = r.int(2, 6); b = r.int(2, 6); } while (a === b); if (a > b) [a, b] = [b, a];
        const L = lcm(a, b), x = L * r.int(1, 3), p = L / a, s = L / b, minus = r.chance(0.4);
        const k = minus ? p - s : p + s, c = minus ? x / a - x / b : x / a + x / b;
        const steps = [S(`${cx(p)}${minus ? ` ${MINUS} ` : ' + '}${cx(s)}`, L * c, `Multiply both sides by ${L}`),
                       S(cx(k), L * c, 'Collect like terms')];
        divideStep(steps, k, x);
        return { x, lhs: `${fr('x', a)}${minus ? ` ${MINUS} ` : ' + '}${fr('x', b)}`, rhs: c, ops: 4, steps }; },
      // (ax + b)/c = (dx − e)/f
      (r) => { for (;;) {
        const c = r.int(2, 5), f = r.int(2, 5); if (c === f) continue;
        const a = r.int(1, 6), d = r.int(1, 6), x = r.int(2, 12); if (f * a <= c * d) continue;
        let b = r.int(1, 10); b += (c - ((a * x + b) % c)) % c;
        const kq = (a * x + b) / c, e = d * x - f * kq; if (e === 0) continue;
        const L = `${cx(a)}${plusC(b)}`, R = `${cx(d)}${plusC(-e)}`, K = f * a - c * d;
        const steps = [S(paren(f, L), paren(c, R), `Multiply both sides by ${c * f}`),
                       S(`${cx(f * a)}${plusC(f * b)}`, `${cx(c * d)}${plusC(-c * e)}`, 'Expand both brackets'),
                       S(`${cx(K)}${plusC(f * b)}`, -c * e, `Subtract ${cx(c * d)} from both sides`),
                       S(cx(K), -c * e - f * b, `Subtract ${f * b} from both sides`)];
        divideStep(steps, K, x);
        return { x, lhs: fr(L, c), rhs: fr(R, f), ops: 6, steps }; } },
      // a[b(x − c) + d] = e  (nested brackets)
      (r) => { const a = r.int(2, 4), b = r.int(2, 5), c = r.int(1, 8), d = r.int(1, 9), x = r.int(2, 12), inner = b * (x - c) + d, e = a * inner;
        return { x, lhs: `${a}[${paren(b, `x${plusC(-c)}`)}${plusC(d)}]`, rhs: e, ops: 4,
          steps: [S(`${paren(b, `x${plusC(-c)}`)}${plusC(d)}`, inner, `Divide both sides by ${a}`),
                  S(paren(b, `x${plusC(-c)}`), inner - d, `Subtract ${d} from both sides`),
                  S(`x${plusC(-c)}`, x - c, `Divide both sides by ${b}`),
                  S('x', x, `Add ${c} to both sides`)] }; },
      // x/a + b = x/c − d
      (r) => { for (;;) { const c = r.int(2, 5), a = r.int(c + 1, 8); const L = lcm(a, c); if (L > 30) continue;
        const x = L * r.int(1, 3), Sx = x / c - x / a; if (Sx < 2) continue;
        const b = r.int(1, Sx - 1), d = Sx - b, p = L / a, s = L / c, k = p - s;
        const steps = [S(`${cx(p)}${plusC(L * b)}`, `${cx(s)}${plusC(-L * d)}`, `Multiply both sides by ${L}`),
                       S(`${cx(k)}${plusC(L * b)}`, -L * d, `Subtract ${cx(s)} from both sides`),
                       S(cx(k), -L * d - L * b, `Subtract ${L * b} from both sides`)];
        divideStep(steps, k, x);
        return { x, lhs: `${fr('x', a)}${plusC(b)}`, rhs: `${fr('x', c)}${plusC(-d)}`, ops: 5, steps }; } },
    ],
  };

  function buildPuzzle(seed, difficulty, meta, templateIndex) {
    const r = makeRng(seed);
    const pool = TEMPLATES[difficulty];
    const tpl = templateIndex === undefined ? r.pick(pool) : pool[templateIndex];
    const p = tpl(r);
    const rhs = typeof p.rhs === 'number' ? num(p.rhs) : p.rhs;
    const steps = [S(p.lhs, rhs, null), ...p.steps];
    const all = steps.map((s) => s.lhs + ' = ' + s.rhs).join(' ');
    const original = p.lhs + ' ' + rhs;
    return {
      id: meta.id, date: meta.date, difficulty,
      expression: p.lhs, rightHandSide: rhs, answer: p.x,
      solutionSteps: steps, operationCount: p.ops,
      usesBrackets: /[(\[]/.test(original),
      usesFractions: original.includes('{'),
      usesNegativeNumbers: /\u2212[\dx(]/.test(all), // a minus with no space after it is a negative value, not subtraction
      xOccurrences: (original.match(/x/g) || []).length,
    };
  }

  /* ---------- calendar ---------- */
  const difficultyOn = (epochDay) => WEEKDAY_DIFFICULTY[(((epochDay + 4) % 7) + 7) % 7]; // 1 Jan 1970 was a Thursday
  function infoFromEpoch(epochDay) {
    const d = new Date(epochDay * 864e5);
    const iso = d.toISOString().slice(0, 10);
    return { epochDay, iso, number: epochDay - LAUNCH_EPOCH_DAY + 1, difficulty: difficultyOn(epochDay) };
  }
  function localEpochDay(date) {
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  }
  function dayInfo(date) { return infoFromEpoch(localEpochDay(date)); }

  /* Templates are dealt like a shuffled deck: within a difficulty, every template is
     used once before any repeats, and the same one never appears twice in a row. */
  const deckCache = {};
  function deck(difficulty, round) {
    const key = difficulty + round;
    if (deckCache[key]) return deckCache[key];
    const n = TEMPLATES[difficulty].length;
    const r = makeRng(Math.imul(round + 1, 0x9E3779B1) ^ (DIFFICULTIES.indexOf(difficulty) * 0x85EBCA77));
    const order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = r.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
    if (round > 0) { const prev = deck(difficulty, round - 1); if (order[0] === prev[n - 1]) [order[0], order[1]] = [order[1], order[0]]; }
    return (deckCache[key] = order);
  }
  function templateIndexFor(epochDay, difficulty) {
    let k = 0;
    for (let e = LAUNCH_EPOCH_DAY; e < epochDay; e++) if (difficultyOn(e) === difficulty) k++;
    const n = TEMPLATES[difficulty].length;
    return deck(difficulty, Math.floor(k / n))[k % n];
  }
  function dailyPuzzle(info) {
    // Same date -> same seed -> same puzzle for every player.
    const seed = Math.imul(info.epochDay ^ 0x5bd1e995, 2654435761) >>> 0;
    return buildPuzzle(seed, info.difficulty, { id: info.number, date: info.iso }, templateIndexFor(info.epochDay, info.difficulty));
  }

  return {
    MINUS, LAUNCH_EPOCH_DAY, DIFFICULTIES, MAX_ATTEMPTS, TEMPLATES,
    buildPuzzle, dailyPuzzle, dayInfo, infoFromEpoch, templateIndexFor,
  };
})();

if (typeof module !== 'undefined') module.exports = XolveGenerator; // lets Node run the tests

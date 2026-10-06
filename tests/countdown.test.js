// Checks Countdown puzzles: a fair draw from the pool, a target from 100 to 999 that is
// really reachable, a solution that passes the answer checker, and the checker's rules.
// Run with: node tests/countdown.test.js
const C = require('../countdown/engine.js');
const Cal = require('../shared/calendar.js');

const problems = [];
const LAUNCH = Cal.LAUNCH_EPOCH_DAY;
const info = Cal.infoFromEpoch;
const count = (arr) => arr.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {});
const poolCount = count(C.POOL);

// 1. Ten years of daily puzzles.
const DAYS = 3650;
const largeMix = {};
let slowest = 0, totalMs = 0;
for (let e = LAUNCH; e < LAUNCH + DAYS; e++) {
  const t0 = Date.now();
  const p = C.dailyPuzzle(info(e));
  const ms = Date.now() - t0; totalMs += ms; slowest = Math.max(slowest, ms);
  const tag = `day ${p.date}`;
  if (p.numbers.length !== C.PICK) problems.push(`${tag}: ${p.numbers.length} numbers`);
  for (const [v, n] of Object.entries(count(p.numbers))) if (!poolCount[v] || n > poolCount[v]) problems.push(`${tag}: too many ${v}s`);
  if (p.target < C.TARGET_MIN || p.target > C.TARGET_MAX) problems.push(`${tag}: target ${p.target} out of range`);
  if (p.numbers.includes(p.target)) problems.push(`${tag}: target is one of the numbers`);
  const r = C.check(p.solution, p.numbers);
  if (!r.ok || r.value !== p.target) problems.push(`${tag}: solution "${p.solution}" doesn't make ${p.target} (${r.reason || r.value})`);
  else if (r.used.length !== p.solutionNumbersUsed) problems.push(`${tag}: solution uses ${r.used.length} numbers, expected ${p.solutionNumbersUsed}`);
  const again = C.dailyPuzzle(info(e));
  if (again.target !== p.target || again.numbers.join() !== p.numbers.join()) problems.push(`${tag}: same day gave a different puzzle`);
  const large = p.numbers.filter((v) => C.LARGE.includes(v)).length;
  largeMix[large] = (largeMix[large] || 0) + 1;
}

// 2. Every value the solver claims for a few puzzles must pass the checker.
for (let e = LAUNCH; e < LAUNCH + 20; e++) {
  const p = C.dailyPuzzle(info(e));
  for (const [v, x] of C.solve(p.numbers)) {
    const r = C.check(x.e, p.numbers);
    if (!r.ok || r.value !== v) { problems.push(`day ${p.date}: solver says "${x.e}" = ${v}, checker says ${r.reason || r.value}`); break; }
  }
}

// 3. The checker's rules.
const N = [100, 75, 10, 5, 5, 3];
const ok = (input, value) => { const r = C.check(input, N); if (!r.ok || r.value !== value) problems.push(`check "${input}": expected ${value}, got ${r.reason || r.value}`); };
const bad = (input, why) => { const r = C.check(input, N); if (r.ok) problems.push(`check "${input}": should be rejected (${why})`); };
ok('100 + 75', 175);
ok('(75 \u2212 5) \u00d7 10 + 3', 703);
ok('(75-5)*10+3', 703);
ok('75 x 10 / 5', 150);
ok('100 \u00f7 (5 \u00d7 5)', 4);
ok('5 + 5', 10);
bad('3 \u2212 5 + 100', 'a step goes negative');
bad('75 \u00f7 10', 'a remainder');
bad('5 + 5 + 5', 'only two 5s');
bad('7 + 3', '7 is not a number today');
bad('(75 + 3', 'missing bracket');
bad('75 + 3)', 'extra bracket');
bad('75 +', 'ends too soon');
bad('75 3', 'missing operator');
bad('', 'empty');
bad('75 ^ 2', 'not an allowed symbol');
bad('10 \u00f7 (5 \u2212 5)', 'divide by zero');

console.log(`Large numbers per puzzle: ${JSON.stringify(largeMix)}`);
console.log(`Generation: ${(totalMs / DAYS).toFixed(1)} ms average, ${slowest} ms slowest`);
problems.slice(0, 20).forEach((x) => console.log('FAIL', x));
console.log(`${DAYS} countdown puzzles and the answer checker tested, ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);

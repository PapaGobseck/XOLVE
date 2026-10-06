// Checks that every generated algebra puzzle is correct. Run with: node tests/algebra.test.js
const G = require('../algebra/engine.js');

// Turn the puzzle notation into JavaScript so each line of working can be evaluated.
const toJs = (s) => s
  .replace(/\{([^|}]*)\|([^}]*)\}/g, '(($1)/($2))')
  .replace(/\u2212/g, '-').replace(/\[/g, '(').replace(/\]/g, ')')
  .replace(/(\d)(x|\()/g, '$1*$2');
const evaluate = (expr, x) => Function('x', 'return ' + toJs(expr))(x);
const equal = (a, b) => Math.abs(a - b) < 1e-9;

let checked = 0;
const failures = [];
function check(p, label) {
  checked++;
  for (const step of p.solutionSteps) {
    if (!equal(evaluate(step.lhs, p.answer), evaluate(step.rhs, p.answer))) failures.push(`${label}: step "${step.lhs} = ${step.rhs}" is wrong for x = ${p.answer}`);
  }
  const first = p.solutionSteps[0];
  if (equal(evaluate(first.lhs, p.answer + 1), evaluate(first.rhs, p.answer + 1))) failures.push(`${label}: more than one solution`);
  const last = p.solutionSteps[p.solutionSteps.length - 1];
  if (last.lhs !== 'x' || last.rhs !== String(p.answer)) failures.push(`${label}: last step isn't x = ${p.answer}`);
  if (!Number.isInteger(p.answer) || p.answer < 1) failures.push(`${label}: answer ${p.answer} isn't a positive whole number`);
}

// 1. Random puzzles from every template at every level.
for (const d of G.DIFFICULTIES) {
  G.TEMPLATES[d].forEach((_, t) => {
    for (let seed = 1; seed <= 500; seed++) check(G.buildPuzzle(seed * 7919, d, {}, t), `${d} template ${t + 1}, seed ${seed}`);
  });
}

// 2. Five years of daily puzzles, and no shape repeated on back-to-back days of the same level.
const last = {};
let repeats = 0;
for (let e = G.LAUNCH_EPOCH_DAY; e < G.LAUNCH_EPOCH_DAY + 365 * 5; e++) {
  const info = G.infoFromEpoch(e);
  check(G.dailyPuzzle(info), `daily ${info.iso}`);
  const t = G.templateIndexFor(e, info.difficulty);
  if (last[info.difficulty] === t) repeats++;
  last[info.difficulty] = t;
}
if (repeats) failures.push(`${repeats} back-to-back repeats of the same template`);

failures.slice(0, 20).forEach((f) => console.log('FAIL', f));
console.log(`${checked} puzzles checked, ${failures.length} problems`);
process.exit(failures.length ? 1 : 0);

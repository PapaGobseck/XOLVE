// Checks Lattice puzzles at every level: one solution each, no leading zero in the product,
// correct hint/solution steps, and no more "try the options" steps than the level allows.
// Run with: node tests/lattice.test.js
const X = require('../lattice/engine.js');

const problems = [];
const PER_LEVEL = 100;
for (const level of X.LEVEL_ORDER) {
  const cfg = X.LEVELS[level];
  const trials = {};
  for (let i = 1; i <= PER_LEVEL; i++) {
    const seed = Math.imul(i, 2654435761) >>> 0;
    const p = X.generate(seed, level);
    const E = X.forPuzzle(p);
    const tag = `${level} seed ${seed}`;
    const sols = E.solve(p.givens, 3);
    if (sols.length !== 1 || sols[0].A !== p.A || sols[0].B !== p.B) problems.push(`${tag}: not exactly one solution`);
    if (String(p.A * p.B).length !== E.K) problems.push(`${tag}: product has a leading zero`);
    if (p.hidden.length !== cfg.hide) problems.push(`${tag}: ${p.hidden.length} digits hidden, expected ${cfg.hide}`);
    const path = E.solutionPath(p);
    if (!path.complete) problems.push(`${tag}: step-by-step solver got stuck`);
    for (const s of path.steps) if (p.solution[s.slot] !== s.value) problems.push(`${tag}: wrong step for ${s.slot}`);
    if (path.trials > cfg.maxTrials) problems.push(`${tag}: needs ${path.trials} trial steps`);
    trials[path.trials] = (trials[path.trials] || 0) + 1;
    const w = E.diagonalWorking(p.solution);
    if (w.map((x) => x.digit).reverse().join('') !== String(p.A * p.B)) problems.push(`${tag}: diagonal sums don't give the product`);
  }
  console.log(`${cfg.name.padEnd(8)} ${cfg.C}×${cfg.R} grid, ${cfg.hide} hidden, ${cfg.hints} hints. Trial steps needed: ${JSON.stringify(trials)}`);
}
problems.slice(0, 20).forEach((x) => console.log('FAIL', x));
console.log(`${PER_LEVEL * X.LEVEL_ORDER.length} lattice puzzles checked, ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);

# XOLVE

**One equation. Every day. Actually solve it.**

XOLVE is a Wordle-style daily maths puzzle with three games:

- **Algebra:** everyone gets the same equation each day, and the job is to solve it for *x*. You get 6 attempts, a timer, a streak, and the worked solution once you finish.
- **Lattice:** a multiplication laid out as a lattice (Chinese multiplication) grid, with digits hidden. Fill in every missing digit, with unlimited checks and hints that explain each step.
- **Countdown:** reach a target from 100 to 999 using six numbers and + − × ÷, like the numbers round on Countdown. The numbers are hidden until you press Start, then you have 60 seconds and your closest result counts. Past countdowns in the archive are untimed.

## Features

- A new puzzle every day at midnight in the player's time zone
- Difficulty rises through the week: easy on Monday, medium Tuesday and Wednesday, hard Thursday and Friday, expert at the weekend
- Worked solution after every puzzle, one step at a time
- Streaks and statistics, saved in the player's browser
- Archive of past puzzles (these don't affect the streak or statistics)
- Practice mode with unlimited puzzles at any level
- Hints that reveal the working one step at a time, and a formula book of algebra rules
- Lattice: its own daily puzzle, archive, practice, streak and statistics, four difficulty levels, hints that explain each deduction, a How to play guide and a full worked solution
- Shareable result, light and dark themes, works on mobile and desktop

## Files

Each game lives in its own folder, and everything they share lives in `shared/`.

| File | What it does |
| --- | --- |
| `index.html` | Page structure: header, game and mode tabs, every game's screen, dialogs |
| `shared/style.css` | All styling, including dark mode and mobile layout |
| `shared/calendar.js` | Dates and puzzle numbers, the same for every game |
| `shared/shell.js` | Trusted clock, storage, sharing, navigation, the archive list, the statistics dialog and start-up |
| `algebra/engine.js` | The algebra puzzle engine: templates, seeding and daily puzzle selection |
| `algebra/app.js` | The algebra screen: answer checking, hints, timer, statistics, sharing |
| `lattice/engine.js` | The Lattice engine: generator, uniqueness solver, hint and solution steps |
| `lattice/app.js` | The Lattice screen: grid, keypad, checking, hints, statistics |
| `countdown/engine.js` | The Countdown engine: seeded draw, solver, target choice and answer checker |
| `countdown/app.js` | The Countdown screen: Start, 60-second clock, tiles and symbol keys, statistics, sharing |
| `tests/algebra.test.js` | Checks that algebra puzzles and their worked solutions are correct |
| `tests/lattice.test.js` | Checks that every Lattice puzzle has exactly one solution and correct steps |
| `tests/countdown.test.js` | Checks ten years of Countdown puzzles and the answer checker's rules |
| `images/` | Icons and the link-preview image |
| `wrangler.jsonc`, `.assetsignore` | Cloudflare Workers settings, and the files Cloudflare shouldn't publish |

There's no build step and no dependencies.

### Adding a game

1. Create a folder for it, such as `countdown/`, with an `engine.js` for the puzzles and an `app.js` for the screen.
2. In `app.js`, call `XolveShell.register()` with the game's screen, levels and functions. The comment at the top of `shared/shell.js` lists what the shell expects, and `lattice/app.js` is a complete example.
3. Add the game's screen and a tab button (`<button class="game" data-game="...">`) to `index.html`, and its two `<script>` tags after the existing games.
4. Add a test file to `tests/`.

## Running it locally

Opening `index.html` directly works, but the clock check needs the page to be served over HTTP. From the project folder:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Deploying

The site runs on Cloudflare Workers, connected to this GitHub repository. Pushing to `main` updates https://xolve.games. With preview URLs turned on, pushing to any other branch (such as `dev`) builds a preview version with its own link, which doesn't affect the live site.

## How puzzles are made

Each equation is built **backwards**. The generator picks the answer first, then wraps operations around it and calculates the other side. For example, choose x = 5, add 4, multiply by 7 and the result is `7(x + 4) = 63`. That way every puzzle has a known whole-number answer, and the worked solution comes from the same numbers.

- **Templates** are the shapes of equations, such as `a(x − b) + c = d`. There are 29 across the four levels.
- **Daily selection:** the date is turned into a seed, so the same date always produces the same puzzle for everyone. No puzzle list is stored.
- **No back-to-back repeats:** templates are dealt like a shuffled deck. Within each level, every template is used once before any comes round again, and the same one never appears twice in a row.
- **Time zones:** the date comes from the web server's clock (the `Date` header of the page), read in the player's own time zone. Changing the device clock doesn't unlock the next puzzle.

### Changing the generator

- **Launch date:** `LAUNCH_EPOCH_DAY` at the top of `shared/calendar.js` sets the date of puzzle #1. It's shared by every game.
- **Adding templates:** add a function to the right level in `TEMPLATES`, following the existing pattern, then run the tests.
- **After launch, any change to an engine also changes past puzzles in the archive**, because they're regenerated from the date each time. Make template changes before you share the game.

## How Lattice puzzles are made

| Level | Grid | Digits hidden | Hints | "Try the options" steps allowed |
| --- | --- | --- | --- | --- |
| Easy | 3-digit × 2-digit | 9 of 22 | 3 | 0 |
| Medium | 4-digit × 3-digit | 18 of 38 | 4 | 0 |
| Hard | 4-digit × 3-digit | 24 of 38 | 5 | 1 |
| Extreme | 4-digit × 3-digit | 29 of 38 | 6 | 2 |

The daily lattice follows the week like the algebra puzzle: easy on Monday, medium Tuesday and Wednesday, hard Thursday and Friday, extreme at the weekend. These settings live in `LEVELS` at the top of `lattice/engine.js`.

The generator picks two numbers (digits 1–9, with no leading zero in the product) and fills the whole lattice. It then hides digits one at a time, trying digits of the two numbers first, then cells and product digits. After each removal a solver checks the puzzle still has exactly one solution. It stops when it reaches the level's number of hidden digits.

The same deduction engine powers the hints and the worked solution. It looks for, in order: a digit of either number pinned down by nearby cells, a cell whose row and column digits are known, a cell worked back from a product digit, and a product digit from a finished diagonal. If none of those apply, it tries each option for a digit and keeps the only one that fits. Puzzles needing more of those steps than the level allows are thrown away.

## Tests

```
node tests/algebra.test.js
node tests/lattice.test.js
node tests/countdown.test.js
```

This generates thousands of puzzles from every template, plus five years of daily puzzles. It checks every line of every worked solution, makes sure each equation has one whole-number answer, and confirms no template repeats on back-to-back days.

## Known limitations

- Statistics are stored per browser (localStorage), so they don't carry across devices.
- Because the generator runs in the browser, someone reading the code could work out future puzzles. Hiding them fully needs a server that only hands out the current day's puzzle.

## Roadmap

- Classic mode: show each algebra step, not just the final answer
- Hints with a time or score penalty
- Fractional, decimal and negative answers
- Simultaneous equations and multiple variables
- Backend (Java and Spring Boot) for accounts, cloud statistics and a daily leaderboard

# XOLVE

**One equation. Every day. Actually solve it.**

XOLVE is a Wordle-style daily algebra puzzle. Everyone gets the same equation each day, and the job is to solve it for *x*. You get 6 attempts, a timer, a streak, and the worked solution once you finish.

## Features

- A new puzzle every day at midnight in the player's time zone
- Difficulty rises through the week: easy on Monday, medium Tuesday and Wednesday, hard Thursday and Friday, expert at the weekend
- Worked solution after every puzzle, one step at a time
- Streaks and statistics, saved in the player's browser
- Archive of past puzzles (these don't affect the streak or statistics)
- Practice mode with unlimited puzzles at any level
- Shareable result, light and dark themes, works on mobile and desktop

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page structure: header, tabs, equation area, archive list, dialogs |
| `style.css` | All styling, including dark mode and mobile layout |
| `generator.js` | The puzzle engine: templates, seeding and daily puzzle selection |
| `app.js` | The game: answer checking, timer, statistics, archive, sharing |
| `tests/generator.test.js` | Checks that generated puzzles and their worked solutions are correct |

There's no build step and no dependencies.

## Running it locally

Opening `index.html` directly works, but the clock check needs the page to be served over HTTP. From the project folder:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Deploying to GitHub Pages

1. Push these files to the root of a GitHub repository.
2. Go to **Settings → Pages**, set the source to **Deploy from a branch**, and choose `main` and `/ (root)`.
3. After a minute or so, the site will be at `https://<username>.github.io/<repo>/`.

## How puzzles are made

Each equation is built **backwards**. The generator picks the answer first, then wraps operations around it and calculates the other side. For example, choose x = 5, add 4, multiply by 7 and the result is `7(x + 4) = 63`. That way every puzzle has a known whole-number answer, and the worked solution comes from the same numbers.

- **Templates** are the shapes of equations, such as `a(x − b) + c = d`. There are 29 across the four levels.
- **Daily selection:** the date is turned into a seed, so the same date always produces the same puzzle for everyone. No puzzle list is stored.
- **No back-to-back repeats:** templates are dealt like a shuffled deck. Within each level, every template is used once before any comes round again, and the same one never appears twice in a row.
- **Time zones:** the date comes from the web server's clock (the `Date` header of the page), read in the player's own time zone. Changing the device clock doesn't unlock the next puzzle.

### Changing the generator

- **Launch date:** `LAUNCH_EPOCH_DAY` at the top of `generator.js` sets the date of puzzle #1. Set it earlier if you want the archive to have puzzles in it at launch.
- **Adding templates:** add a function to the right level in `TEMPLATES`, following the existing pattern, then run the tests.
- **After launch, any change to the generator also changes past puzzles in the archive**, because they're regenerated from the date each time. Make template changes before you share the game.

## Tests

```
node tests/generator.test.js
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

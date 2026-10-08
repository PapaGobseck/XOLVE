/*
 * XOLVE server script (Cloudflare Worker).
 *
 * Every file in the repo is served as-is by Cloudflare's static assets, and this script
 * only runs for addresses that aren't a file, such as /lattice and /countdown.
 * For those it sends the same index.html as the home page, with that game's title,
 * description and link-preview image swapped in, so a shared link shows the right
 * card in Discord, WhatsApp and so on. The page then opens the game from the address
 * (see PATHS in shared/shell.js; keep the two lists in step).
 */
const SITE = 'https://xolve.games';

const PAGES = {
  '/lattice': {
    title: 'XOLVE Lattice: a daily multiplication puzzle',
    ogTitle: 'XOLVE Lattice: daily multiplication puzzles',
    description: "Fill in the missing digits of today's lattice multiplication grid. A new puzzle every day, with hints that explain each step and streaks.",
    image: '/images/og-lattice.png',
    imageAlt: 'XOLVE Lattice: a lattice multiplication grid for 47 × 36',
  },
  '/countdown': {
    title: 'XOLVE Countdown: a daily numbers puzzle',
    ogTitle: 'XOLVE Countdown: daily numbers puzzles',
    description: "Reach today's target with six numbers and + − × ÷ in 60 seconds, like the numbers round on Countdown. A new puzzle every day, with streaks.",
    image: '/images/og-countdown.png',
    imageAlt: 'XOLVE Countdown: the target 341 above six number tiles',
  },
};

/* Sets one attribute on every element the selector matches. */
const setAttr = (attr, value) => ({ element(el) { el.setAttribute(attr, value); } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    const bare = path.replace(/\/+$/, '');

    if (PAGES[bare]) {
      // One address per game: /Countdown/ and friends go to /countdown.
      if (url.pathname !== bare) return Response.redirect(SITE + bare + url.search, 301);

      const page = PAGES[bare];
      const home = await env.ASSETS.fetch(new Request(new URL('/', url), { method: request.method, headers: request.headers }));
      if (!home.ok) return home;
      const full = SITE + bare;
      return new HTMLRewriter()
        .on('title', { element(el) { el.setInnerContent(page.title); } })
        .on('meta[name="description"]', setAttr('content', page.description))
        .on('link[rel="canonical"]', setAttr('href', full))
        .on('meta[property="og:url"]', setAttr('content', full))
        .on('meta[property="og:title"]', setAttr('content', page.ogTitle))
        .on('meta[property="og:description"]', setAttr('content', page.description))
        .on('meta[property="og:image"]', setAttr('content', SITE + page.image))
        .on('meta[property="og:image:alt"]', setAttr('content', page.imageAlt))
        .transform(home);
    }

    // Anything else that isn't a file: Cloudflare's usual not-found response.
    return env.ASSETS.fetch(request);
  },
};

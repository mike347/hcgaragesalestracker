# CLAUDE.md

Project notes for anyone (human or AI) working on this repo. Read this before changing things.

## What this is

A public map of upcoming garage/yard sales in Highlands County, FL. Three pieces:

- `scrape.mjs`: Node 18+, **no dependencies**. Reads the county's listing, geocodes addresses, writes `data.js`.
- `GarageSalesTracker.html`: the entire front end. **One static file, no build step, no framework**, vanilla JS plus Leaflet 1.9.4 from unpkg (keep it pinned). Loads `data.js` with a plain `<script>` tag so it also works opened from disk.
- `deploy/*.sh`: Linux server automation (see Deployment).

The page is **public**. Never add personal locations, secrets or private network details to any committed file.

## Data source and scraper

- The county site fills its table with a WordPress "WP Data Access" DataTables call. The scraper POSTs to `https://www.hctaxcollector.com/wp-admin/admin-ajax.php` with `action=wpda_datatables`, `pubid=1`, the usual DataTables paging/column fields (columns named `StartDate, EndDate, Address, City, Zipcode, SalesDesc, wpda_hyperlink_0`) and a `wpnonce`. It pages 100 rows at a time.
- **The nonce** expires after about a day. It is read from the listing page: it is the last quoted 10-character hex argument of the inline `wpda_datatables_ajax_call(...)` line. If the site changes this, run with `WPNONCE=<value>` to override, and fix `getNonce()`. On failure the script saves `page-debug.html` to `STATE_DIR` and prints where "nonce" appears.
- Response rows are `[start, end, address, city, zip, items, mapLinkHtml]`; dates look like `October 1, 2026`. Ended sales are dropped (today is computed in `America/New_York`).
- Geocoding: US Census `onelineaddress` first, then Nominatim (1.1 s delay between calls). **Only successes are cached** (`geocode-cache.json` in `STATE_DIR`), so misses are retried next run. Addresses that never resolve go in `unmapped` and show as links in the list.
- Env vars: `OUT_DIR` (where `data.js`/`sales.json` go; default `./public`), `STATE_DIR` (cache and debug output; default next to the script), `WPNONCE`.
- `data.js` is `window.GARAGE_DATA = { updated, sales: [{start,end,address,city,zip,items[],mapUrl,lat,lon}], unmapped: [...] }`. Dates are ISO `YYYY-MM-DD`. Keep this shape stable; the page depends on it.

## Front end behavior (don't break these)

- **Colors:** green = on today, orange = overlaps the current/upcoming Saturday+Sunday (on Sat/Sun, the weekend underway), blue = later. `statusOf()` and `FILTERS` share `weekendRange()`.
- **Basemaps:** Satellite (Esri imagery plus two transparent Esri label layers) is the default; Street is OpenStreetMap over http(s). OSM blocks tile requests with no referrer, so on `file://` Street falls back to Esri street tiles. CARTO's free tiles now need an API key; don't use them. The visitor's choice is saved in `localStorage` (`gst-basemap`). If the imagery fails to load at all (4 errors, none loaded) the page falls back to Street.
- **Search:** space-separated words, all must match somewhere in address/city/zip/items; combined with the date filter. The list, map pins and counts all derive from the same filtered set in `render()`.
- **Location:** uses `watchPosition`, asked on load unless the Permissions API says it was already denied (then only a button is offered). Needs HTTPS or localhost. The map only moves on the first fix (and not at all on an automatic fix if the visitor is more than 40 miles from every sale) or when "Recenter" is tapped. Distances refresh in place via `refreshDistances()` at most every 10 s and only after 50 m of movement, so an open popup is never closed. Tracking stops while the tab is hidden.
- **Navigation links** use the street address, not coordinates: iPhone gets Apple Maps, Android a `geo:` link, everything else Google Maps.
- **Layout:** desktop is a sidebar plus map. Phone portrait (`max-width:720px` and `min-height:521px`) is a compact header, map first, and a draggable bottom sheet (`#sheet`, pointer events on `#sheetBar`, `touch-action:none`). Short viewports (`max-height:520px`, phone landscape) use a slim one-row header. A `ResizeObserver` calls `map.invalidateSize()`.
- **Security:** all data is interpolated into HTML through `esc()`. Keep it that way; the data comes from an outside source.
- **CSS gotcha:** an element given an author `display` value ignores the `hidden` attribute. `#locate[hidden]{display:none}` exists for that reason.
- The footer (`.legal`) holds the copyright and a link to the county listing. Set `REPO_URL` near the top of the script to show the "Source on GitHub" link.

## Deployment (Linux VM behind a TLS-terminating reverse proxy)

- Checkout lives in `/opt/garage-sales` (outside the web root). The web root for the tracker is `/var/www/garagesales`, served by a dedicated Apache virtual host so nothing else on the server is exposed. Geocode cache lives in `/var/lib/garage-sales`.
- `/usr/local/bin/garage-sales-deploy` runs from `/etc/cron.d` every 10 minutes (under `flock`): `git fetch`, `git reset --hard origin/main`, then copy **only** `GarageSalesTracker.html` into the web root if it changed.
- `/etc/cron.daily/garage-sales-update` runs the scraper as `www-data` from the checkout with `OUT_DIR` and `STATE_DIR` set.
- **Rules:** the deploy script must never touch `data.js`, and nobody should `git pull` inside the web root. The deploy script is a root-owned copy installed once, so root never executes code that came from GitHub; after editing `deploy/*.sh`, re-install them by hand (commands are in the README). Never commit `data.js`, `sales.json`, `geocode-cache.json` or `page-debug.html` (they are in `.gitignore`).
- Pull-based on purpose: the server only makes outbound requests, so nothing is exposed for webhooks.

## Checking changes

There is no test suite. Before committing:

1. `node --check scrape.mjs`
2. Parse the page's inline script: `node -e "const h=require('fs').readFileSync('GarageSalesTracker.html','utf8'); new Function(h.match(/<script>([\s\S]*?)<\/script>/)[1])"`
3. Load the page in headless Chromium (`playwright-core`) served from a local static server, with a sample `data.js`, stubbed tile requests, and Leaflet from `node_modules` instead of unpkg. Check at 390x844 (portrait phone), 844x390 (landscape) and desktop width. There should be no horizontal scroll and no page errors.
4. For location behavior use the browser context's `geolocation` and `setGeolocation`; for the bottom sheet use real touch events via CDP (`Input.dispatchTouchEvent`), not just `tap()`.
5. For the scraper, run `node --import mock.mjs scrape.mjs` where `mock.mjs` replaces `globalThis.fetch` with fake responses for the listing page, the AJAX endpoint and the geocoder. Not every environment can reach the county site.
6. For deploy changes, test against a local bare git repo with `REPO_DIR`, `WEB_DIR` and `WEB_USER` overridden.

## License

MIT, Copyright (c) 2026 Michael Taylor (kovarid@gmail.com). Listing data belongs to the Highlands County Tax Collector; map data and imagery are credited on the map.

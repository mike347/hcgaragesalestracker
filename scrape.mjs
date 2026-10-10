#!/usr/bin/env node
// Highlands County garage/yard sale scraper + geocoder.
// Copyright (c) 2026 Zen. Released under the MIT License (see LICENSE in the source repository).
//
// Usage:   node scrape.mjs            (Node 18+, no dependencies)
// Folders (all optional environment variables):
//   OUT_DIR    where data.js and sales.json are written. Default: an ATSPlugins folder next to this script.
//   STATE_DIR  where the geocode cache (and debug output) live. Default: next to this script.
//              When deployed from a git checkout, point this somewhere outside the checkout.
// Output:  ATSPlugins/data.js and ATSPlugins/sales.json, in a folder next to this script
//          (override the folder with the OUT_DIR environment variable).
//          GarageSalesTracker.html lives in that same folder and loads data.js.
//
// If the script can't auto-detect the site's security nonce, grab a fresh
// "wpnonce" value from the F12 Network tab and run:
//   WPNONCE=xxxxxxxxxx node scrape.mjs        (macOS/Linux/Git Bash)
//   $env:WPNONCE="xxxxxxxxxx"; node scrape.mjs  (PowerShell)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
// Public output folder. With the script in /var/www/html this resolves to /var/www/html/ATSPlugins.
const OUT_DIR = process.env.OUT_DIR || path.join(DIR, "ATSPlugins");
const PAGE_URL = "https://www.hctaxcollector.com/garagesales/";
const AJAX_URL = "https://www.hctaxcollector.com/wp-admin/admin-ajax.php";
const STATE_DIR = process.env.STATE_DIR || DIR;
const CACHE_FILE = path.join(STATE_DIR, "geocode-cache.json");
const UA = "Mozilla/5.0 (personal garage-sale map script)";
const COLUMNS = ["StartDate", "EndDate", "Address", "City", "Zipcode", "SalesDesc", "wpda_hyperlink_0"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. Get the nonce ----------
async function getNonce() {
  if (process.env.WPNONCE) return process.env.WPNONCE;
  const res = await fetch(PAGE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Page request failed: HTTP ${res.status}`);
  const html = await res.text();
  const patterns = [
    /wpnonce["']?\s*[:=]\s*["']([a-zA-Z0-9]+)["']/i,
    /["']wpnonce["']\s*,\s*["']([a-zA-Z0-9]+)["']/i,
    /wpnonce=([a-zA-Z0-9]+)/i,
    /data-wpnonce=["']([a-zA-Z0-9]+)["']/i,
  ];
  // The plugin passes the nonce as a positional argument near the end of
  // wpda_datatables_ajax_call( ..., "<nonce>", "" ). WordPress nonces are 10 hex characters.
  const call = html.match(/wpda_datatables_ajax_call\s*\(([\s\S]*?)\)\s*;\s*\}\s*\)/);
  if (call) {
    const hexArgs = [...call[1].matchAll(/["']([a-f0-9]{10})["']/gi)];
    if (hexArgs.length) return hexArgs[hexArgs.length - 1][1];
  }
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  // Diagnostics: save what we received and show every place the word "nonce" appears.
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(path.join(STATE_DIR, "page-debug.html"), html);
  console.error(`\nDebug: page returned HTTP ${res.status}, ${html.length} characters (saved to page-debug.html).`);
  const hits = [...html.matchAll(/nonce/gi)].slice(0, 8);
  if (hits.length) {
    console.error("Places the word 'nonce' appears:");
    for (const h of hits) console.error("  ..." + html.slice(Math.max(0, h.index - 60), h.index + 100).replace(/\s+/g, " ") + "...");
  } else {
    console.error("The word 'nonce' does not appear anywhere in the page HTML.");
  }
  if (/wpda/i.test(html)) console.error("The page does mention 'wpda' (WP Data Access).");
  throw new Error(
    "Couldn't find the wpnonce in the page HTML. Copy the current wpnonce value from the " +
      "F12 Network tab and rerun with the WPNONCE environment variable set."
  );
}

// ---------- 2. Pull every page of the table ----------
function buildBody(nonce, start, length, draw) {
  const p = new URLSearchParams();
  p.set("draw", String(draw));
  COLUMNS.forEach((name, i) => {
    p.set(`columns[${i}][data]`, String(i));
    p.set(`columns[${i}][name]`, name);
    p.set(`columns[${i}][searchable]`, "true");
    p.set(`columns[${i}][orderable]`, "true");
    p.set(`columns[${i}][search][value]`, "");
    p.set(`columns[${i}][search][regex]`, "false");
  });
  p.set("order[0][column]", "0");
  p.set("order[0][dir]", "asc");
  p.set("order[1][column]", "2");
  p.set("order[1][dir]", "asc");
  p.set("start", String(start));
  p.set("length", String(length));
  p.set("search[value]", "");
  p.set("search[regex]", "false");
  p.set("action", "wpda_datatables");
  p.set("wpnonce", nonce);
  p.set("pubid", "1");
  p.set("filter_field_name", "");
  p.set("filter_field_value", "");
  p.set("nl2br", "");
  return p.toString();
}

async function fetchAllRows(nonce) {
  const rows = [];
  let start = 0;
  let total = Infinity;
  for (let draw = 1; start < total && draw <= 200; draw++) {
    const res = await fetch(AJAX_URL, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: PAGE_URL,
      },
      body: buildBody(nonce, start, 100, draw),
    });
    if (!res.ok) throw new Error(`Data request failed: HTTP ${res.status} (nonce may have expired)`);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Data request didn't return JSON (nonce may be invalid). Got: " + text.slice(0, 120));
    }
    if (json.error) throw new Error("Server error: " + json.error);
    total = json.recordsFiltered;
    if (!json.data || json.data.length === 0) break;
    rows.push(...json.data);
    start += json.data.length;
  }
  return rows;
}

// ---------- 3. Clean up rows ----------
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
function toIso(label) {
  const m = String(label).match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseRow(r) {
  const [startLabel, endLabel, address, city, zip, items] = r;
  const start = toIso(startLabel);
  const end = toIso(endLabel) || start;
  const query = `${address.trim()}, ${city.trim()}, FL ${String(zip).trim()}`;
  return {
    start,
    end,
    address: address.trim(),
    city: city.trim(),
    zip: String(zip).trim(),
    items: String(items || "").split(",").map((s) => s.trim()).filter(Boolean),
    query,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
  };
}

// ---------- 4. Geocode (with cache) ----------
async function loadCache() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function censusGeocode(q) {
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const json = await res.json();
  const hit = json?.result?.addressMatches?.[0];
  return hit ? { lat: hit.coordinates.y, lon: hit.coordinates.x } : null;
}

async function nominatimGeocode(q) {
  await sleep(1100); // Nominatim allows 1 request/second
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const json = await res.json();
  return json[0] ? { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) } : null;
}

async function geocode(q, cache) {
  if (cache[q]) return cache[q];
  let hit = null;
  try {
    hit = await censusGeocode(q);
    await sleep(150);
  } catch {}
  if (!hit) {
    try {
      hit = await nominatimGeocode(q);
    } catch {}
  }
  if (hit) cache[q] = hit; // only cache successes so misses get retried next run
  return hit;
}

// ---------- main ----------
async function main() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  console.log("Getting nonce...");
  const nonce = await getNonce();

  console.log("Fetching listings...");
  const raw = await fetchAllRows(nonce);
  console.log(`  ${raw.length} rows returned`);

  const sales = raw.map(parseRow).filter((s) => s.start && s.end >= today);
  console.log(`  ${sales.length} still upcoming or in progress`);

  const cache = await loadCache();
  const mapped = [];
  const unmapped = [];
  let lookups = 0;
  for (const s of sales) {
    const wasCached = Boolean(cache[s.query]);
    const hit = await geocode(s.query, cache);
    if (!wasCached) lookups++;
    const { query, ...rest } = s;
    if (hit) mapped.push({ ...rest, lat: hit.lat, lon: hit.lon });
    else unmapped.push(rest);
  }
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1));
  console.log(`  ${lookups} new addresses geocoded, ${unmapped.length} could not be located`);

  const out = { updated: new Date().toISOString(), sales: mapped, unmapped };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "sales.json"), JSON.stringify(out, null, 1));
  // data.js lets the page work when opened straight from disk (browsers block fetch() on file://)
  await writeFile(path.join(OUT_DIR, "data.js"), "window.GARAGE_DATA = " + JSON.stringify(out) + ";\n");
  console.log(`Done. ${mapped.length} sales on the map. Wrote ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("\nFAILED: " + err.message);
  process.exit(1);
});

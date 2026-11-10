#!/usr/bin/env node
/* Smoke test for the built file.

   Loads dist/soundclash-visualizer.html from file:// in headless Chrome or Edge, with a fake audio
   input that plays the synthesized drum loop (tools/make-drum-loop.js). Clicks Start, watches the
   console, takes screenshots, and compares the hit counts in window.__scv.DET with what the loop
   actually contains. Then it exercises the controls.

   usage: node tools/verify.js [--file=path.html] [--browser=chrome|msedge|bundled|path.exe]
                               [--seconds=8] [--md] [--no-worklet] [--https] [--headed] [--size=1280x720]

   --md          leaves the MilkDrop layer on while measuring. Headless Chrome without a GPU renders
                 that layer at a few frames per second, so it is off by default here.
   --no-worklet  forces the main-thread fallback detector.
   --https       serves the same file from a pretend https origin instead of file://, to exercise
                 the code paths that differ there (the worklet loads from a Blob URL).

   This cannot check a real line-in feed, real video files, or frame rate on a real GPU.          */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright-core");
const drum = require("./make-drum-loop.js");

const args = {};
for(const a of process.argv.slice(2)){ const m = a.match(/^--([^=]+)(?:=(.*))?$/); if(m) args[m[1]] = m[2] === undefined ? true : m[2]; }

const root = path.join(__dirname, "..");
const file = path.resolve(args.file || path.join(root, "dist", "soundclash-visualizer.html"));
const outDir = path.join(root, "test-output");
const [vw, vh] = String(args.size || "1280x720").split("x").map(Number);
const WARMUP_MS = 2500, LOOP_MS = drum.PATTERN.loopSec * 1000, WINDOW_MS = (Number(args.seconds) || drum.PATTERN.loopSec) * 1000;

const results = [];
const check = (name, ok, detail) => { results.push({name, ok}); console.log((ok ? "  ok    " : "  FAIL  ") + name + (detail ? "  (" + detail + ")" : "")); };
const section = name => console.log("\n" + name);

async function launch(wav){
  const flags = [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--use-file-for-fake-audio-capture=" + wav,
    "--enable-unsafe-swiftshader",                 // WebGL 2 without a GPU
    "--ignore-gpu-blocklist",
  ];
  const tries = args.browser ? [String(args.browser)] : ["chrome", "msedge", "bundled"];
  let last;
  for(const b of tries){
    const opt = {headless: !args.headed, args: flags};
    if(/[\\/]/.test(b)) opt.executablePath = b; else if(b !== "bundled") opt.channel = b;
    try{ return {browser: await chromium.launch(opt), name: b}; }catch(e){ last = e; }
  }
  throw new Error("Could not launch Chrome or Edge. Pass --browser=<path to chrome.exe>.\n" + (last && last.message));
}

/* Count hits per zone over a window, timed inside the page. stall = [busyMs, everyMs] blocks the main thread on a cycle. */
function countHits(page, ms, stall){
  return page.evaluate(({ms, stall}) => new Promise(res => {
    const D = window.__scv.DET, a = D.map(d => d.count), t = performance.now(); let frames = 0, on = true, timer;
    const tick = () => { if(on){ frames++; requestAnimationFrame(tick); } }; requestAnimationFrame(tick);
    if(stall) timer = setInterval(() => { const end = performance.now() + stall[0]; while(performance.now() < end){} }, stall[1]);
    setTimeout(() => { on = false; clearInterval(timer); const el = performance.now() - t;
      res({names: D.map(d => d.en), counts: D.map((d, i) => d.count - a[i]), elapsed: el, fps: frames / el * 1000}); }, ms);
  }), {ms, stall});
}
function compare(m, label){
  m.names.forEach((n, i) => {
    const per = drum.PATTERN[n.toLowerCase()];
    if(per === undefined) return;
    const want = per * m.elapsed / LOOP_MS, tol = 1 + want * 0.05;
    check((label || "") + n.padEnd(5) + " counted " + String(m.counts[i]).padStart(3) + ", loop contains " + want.toFixed(1), Math.abs(m.counts[i] - want) <= tol);
  });
}

async function main(){
  if(!fs.existsSync(file)) throw new Error("Missing " + file + ". Run `npm run build` first.");
  const wav = drum.generate();                      // always regenerated, so the test is repeatable
  fs.mkdirSync(outDir, {recursive: true});

  const {browser, name} = await launch(wav);
  console.log("browser: " + name + " " + browser.version() + (args.headed ? "" : " (headless)"));
  console.log("page:    " + file);
  const page = await browser.newPage({viewport: {width: vw, height: vh}});

  const errors = [], external = [];
  page.on("console", m => { if(m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e && e.message || e)));
  page.on("request", r => { const u = r.url(); if(!/^(file|blob|data|about):/i.test(u) && !(args.https && u === "https://scv.test/index.html")) external.push(u); });

  if(args["no-worklet"]) await page.addInitScript(() => { window.__scvNoWorklet = true; });
  const FAKE = "https://scv.test/";               // never reaches the network: the request is answered from disk
  if(args.https){
    await page.route(FAKE + "**", r => r.fulfill({path: file, contentType: "text/html; charset=utf-8"}));
    await page.goto(FAKE + "index.html");
  }else await page.goto(pathToFileURL(file).href);
  if(!args.md) await page.evaluate(() => { const el = document.getElementById("mdOn"); el.checked = false; el.dispatchEvent(new Event("change")); });

  section("start");
  await page.click("#goMic");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("start")).display === "none" || document.getElementById("err").textContent, null, {timeout: 15000});
  const err = await page.evaluate(() => document.getElementById("err").textContent);
  check("Start with audio input opens the show", !err, err || "");
  if(err){ await browser.close(); return finish(errors, external); }

  const info = await page.evaluate(() => {
    let gpu = "unknown";
    try{ const gl = document.createElement("canvas").getContext("webgl2"), x = gl.getExtension("WEBGL_debug_renderer_info"); if(x) gpu = gl.getParameter(x.UNMASKED_RENDERER_WEBGL); }catch(e){ gpu = "no WebGL 2"; }
    return {gpu, features: {zones: !!document.getElementById("zones")}};
  });
  console.log("  WebGL renderer: " + info.gpu);

  /* ---------- hit detection ---------- */
  await page.waitForTimeout(WARMUP_MS);
  const {mode, via, why} = await page.evaluate(() => ({mode: window.__scv.detMode || "interval", via: window.__scv.detVia || "", why: window.__scv.detError || ""}));
  const m = await countHits(page, WINDOW_MS);
  section("hit detection over " + (m.elapsed / 1000).toFixed(2) + " s, MilkDrop " + (args.md ? "on" : "off") + ", detector: " + mode + ", " + m.fps.toFixed(0) + " frames per second");
  compare(m);
  if(info.features.zones){
    check("detector runs in " + (args["no-worklet"] ? "the main-thread fallback" : "an AudioWorklet"), mode === (args["no-worklet"] ? "interval" : "worklet"), mode + (via ? ", loaded from a " + via + " URL" : "") + (why ? ", " + why : ""));
    if(mode === "worklet") check("worklet loaded from a " + (args.https ? "Blob" : "data:") + " URL on " + (args.https ? "https" : "file://"), via === (args.https ? "blob" : "data"), via);
  }

  await page.screenshot({path: path.join(outDir, "verify.png")});

  if(mode === "worklet"){
    /* the point of the worklet: a main thread that is blocked most of the time must not lose hits */
    const st = await countHits(page, WINDOW_MS, [400, 500]);
    section("same again with the main thread blocked 400 ms out of every 500 (" + st.fps.toFixed(0) + " frames per second)");
    compare(st);
  }

  if(info.features.zones) await zones(page);
  await hotkeys(page);

  section("storage");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check("settings are saved under the scv_ prefix", keys.length > 0 && keys.every(k => k.startsWith("scv_")), keys.length + " keys");

  await browser.close();
  finish(errors, external, {...m, mode});
}

/* ---------- hit zone editor ---------- */
async function zones(page){
  section("hit zones");
  const det = () => page.evaluate(() => window.__scv.DET.map(d => ({id: d.id, en: d.en, lo: d.lo, hi: d.hi, custom: !!d.custom})));
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("scv_zones") || "null"));
  const setHz = async (row, which, value) => { const el = page.locator("#zones .zone").nth(row).locator(".zhz").nth(which); await el.fill(String(value)); await el.press("Enter"); };
  await page.mouse.move(vw - 60, vh / 2); await page.mouse.move(vw - 80, vh / 2 + 5);        // wake the drawer
  await page.locator("#zoneAdd").scrollIntoViewIfNeeded();

  check("three built-in zones to start", (await det()).map(d => d.id).join() === "kick,snare,hat");

  /* point KICK at the hat range: it should now count hats, which proves edits reach the detector */
  await setHz(0, 0, 7000); await setHz(0, 1, 14000);
  let d = await det();
  check("editing KICK to 7000-14000 Hz updates the zone", d[0].lo === 7000 && d[0].hi === 14000, d[0].lo + "-" + d[0].hi);
  await page.waitForTimeout(1500);
  const m = await countHits(page, 4000);
  const wantHat = drum.PATTERN.hat * m.elapsed / LOOP_MS;
  check("KICK zone on the hat range counts hats: " + m.counts[0] + ", loop contains " + wantHat.toFixed(1), Math.abs(m.counts[0] - wantHat) <= 2);

  /* swapped and out-of-range values are fixed up */
  await setHz(0, 0, 99999);
  d = await det();
  check("a low value past the top is clamped and pushes the high value", d[0].lo === 19990 && d[0].hi === 20000, d[0].lo + "-" + d[0].hi);
  await setHz(0, 1, 5);
  d = await det();
  check("a high value under the bottom is clamped and pushes the low value", d[0].lo === 20 && d[0].hi === 30, d[0].lo + "-" + d[0].hi);

  await page.click("#zoneAdd");
  d = await det();
  check("Add zone appends a custom zone", d.length === 4 && d[3].custom, d.map(z => z.en).join(" "));
  const nameBox = page.locator("#zones .zone").nth(3).locator(".zname");
  await nameBox.fill("clap"); await nameBox.press("Enter");
  await setHz(3, 0, 900); await setHz(3, 1, 1600);
  d = await det();
  check("custom zone can be renamed and ranged", d[3].en === "CLAP" && d[3].lo === 900 && d[3].hi === 1600, d[3].en + " " + d[3].lo + "-" + d[3].hi);
  const s = await saved();
  check("zones are saved", Array.isArray(s) && s.length === 4 && s[3].name === "CLAP");
  await page.screenshot({path: path.join(outDir, "verify-panel.png")});

  for(let i = 0; i < 6; i++) if(await page.locator("#zoneAdd").isEnabled()) await page.click("#zoneAdd");
  d = await det();
  check("zone list stops at 8", d.length === 8 && !(await page.locator("#zoneAdd").isEnabled()), d.length + " zones");

  await page.locator("#zones .zone").nth(3).locator("button").click();
  d = await det();
  check("a custom zone can be removed", d.length === 7 && d.every(z => z.en !== "CLAP"));
  check("built-in zones have no remove button", await page.locator("#zones .zone").nth(0).locator("button").count() === 0);

  await page.click("#zoneReset");
  d = await det();
  check("Reset zones restores the defaults", d.length === 3 && d[0].lo === 40 && d[0].hi === 120 && d[1].lo === 1800 && d[2].hi === 14000, d.map(z => z.lo + "-" + z.hi).join(" "));
  await page.waitForTimeout(3000);
  compare(await countHits(page, 4000), "after reset: ");
}

/* ---------- every hotkey must keep working: F H N V S G M Space ---------- */
async function hotkeys(page){
  section("hotkeys");
  const state = () => page.evaluate(() => {
    const $ = id => document.getElementById(id);
    return {hud: $("hudOn").checked, graph: $("graph").value, md: $("mdOn").checked, lock: $("lock").checked, preset: $("preset").value,
            panel: $("panel").classList.contains("show"), fs: !!document.fullscreenElement};
  });
  const press = async (key, field, label) => {
    const a = await state(); await page.keyboard.press(key); await page.waitForTimeout(150);
    const b = await state(); check(label, a[field] !== b[field], a[field] + " -> " + b[field]);
  };
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await press("s", "hud", "S toggles the graph");            await page.keyboard.press("s");
  await press("g", "graph", "G switches bars/curve");        await page.keyboard.press("g");
  await press("m", "md", "M toggles MilkDrop");              await page.keyboard.press("m");
  await press("Space", "lock", "Space locks the preset");    await page.keyboard.press("Space");
  await press("n", "preset", "N loads the next preset");
  await press("h", "panel", "H toggles the controls");
  await press("f", "fs", "F toggles fullscreen");            await page.keyboard.press("f");
  /* V (next clip) needs clips in the list; it is checked with the clip tests when there are any */
  const v = await page.evaluate(() => { try{ window.dispatchEvent(new KeyboardEvent("keydown", {key: "v"})); return true; }catch(e){ return String(e); } });
  check("V with an empty clip list does nothing and does not throw", v === true, v === true ? "" : v);
  await page.waitForTimeout(150);
}

function finish(errors, external, m){
  section("page");
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("no network requests", external.length === 0, external.slice(0, 3).join(" | "));
  if(m) console.log("\nRESULT " + JSON.stringify({counts: Object.fromEntries(m.names.map((n, i) => [n, m.counts[i]])), seconds: +(m.elapsed / 1000).toFixed(2), fps: +m.fps.toFixed(1), mode: m.mode}));
  const bad = results.filter(r => !r.ok).length;
  console.log(bad ? "\n" + bad + " check(s) failed" : "\nall " + results.length + " checks passed");
  process.exitCode = bad ? 1 : 0;
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; });

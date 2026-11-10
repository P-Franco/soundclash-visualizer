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
    return {gpu, features: {zones: !!document.getElementById("zones"), clipState: typeof window.__scv.clipState === "function"}};
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
  if(info.features.clipState) await clipTests(page);
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

/* ---------- video clips ---------- */
/* No media is kept in the repo, so the page records its own short clips: a coloured canvas with a
   running clock, captured with MediaRecorder. They are real WebM files as far as <video> can tell,
   but they say nothing about how large real-world files decode. */
const CLIP_SEC = 6;
async function makeClips(page, n){
  await page.evaluate(async ({n, secs}) => {
    const colors = ["#7a1022", "#104a7a", "#1f6b2a", "#6b5a10"];
    const rec = async k => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180; const g = c.getContext("2d");
      const t0 = performance.now(); let on = true;
      const draw = () => { if(!on) return; const t = (performance.now() - t0) / 1000;
        g.fillStyle = colors[k % 4]; g.fillRect(0, 0, 320, 180); g.fillStyle = "#fff"; g.font = "52px monospace";
        g.fillText("clip " + (k + 1), 28, 78); g.fillText(t.toFixed(1) + " s", 28, 146); requestAnimationFrame(draw); };
      draw();
      const mr = new MediaRecorder(c.captureStream(30), {mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 300000});
      const chunks = []; mr.ondataavailable = e => chunks.push(e.data);
      const done = new Promise(r => { mr.onstop = r; });
      mr.start(); await new Promise(r => setTimeout(r, secs * 1000)); mr.stop(); await done; on = false;
      return new File(chunks, "test-clip-" + (k + 1) + ".webm", {type: "video/webm"});
    };
    window.__testClips = await Promise.all(Array.from({length: n}, (_, k) => rec(k)));
  }, {n, secs: CLIP_SEC});
}

async function clipTests(page){
  section("video clips (synthetic, recorded in the page)");
  const st = () => page.evaluate(() => window.__scv.clipState());
  const set = (id, value) => page.evaluate(({id, value}) => {
    const el = document.getElementById(id);
    if(el.type === "checkbox") el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(el.type === "range" ? "input" : "change"));
  }, {id, value});
  /* move the front video to `back` seconds before its end */
  const nearEnd = back => page.evaluate(back => { const s = window.__scv.clipState(), v = document.querySelectorAll("#vids video")[s.front]; v.currentTime = Math.max(0, v.duration - back); }, back);
  const wait = ms => page.waitForTimeout(ms);
  const fr = s => s.els[s.front], bk = s => s.els[1 - s.front];
  await page.evaluate(() => document.activeElement && document.activeElement.blur());

  await makeClips(page, 3);
  await set("xfade", 1); await set("xfadeLoop", true); await set("loopMode", "cycle");
  await page.evaluate(() => window.__scv.addClips(window.__testClips));
  await wait(700);
  let a = await st(); await wait(500); let b = await st();
  check("three clips load and the first one plays", b.idx === 0 && !fr(b).paused && fr(b).t > fr(a).t && isFinite(fr(b).dur), "clip length " + fr(b).dur.toFixed(2) + " s");
  check("the next clip waits, loaded and paused, in the hidden video", bk(b).clip === "test-clip-2.webm" && bk(b).ready && bk(b).paused, bk(b).clip + (bk(b).ready ? " ready" : " not ready"));

  /* crossfade on V */
  await page.keyboard.press("v"); await wait(450);
  a = await st();
  check("V starts a crossfade to the next clip", a.idx === 1 && a.fading && a.mix > 0.05 && a.mix < 0.95 && !a.els[0].paused && !a.els[1].paused, "mix " + a.mix.toFixed(2) + " at 0.45 s of 1 s");
  await page.screenshot({path: path.join(outDir, "verify-crossfade.png")});
  await wait(900);
  a = await st();
  check("the fade ends with one video playing and the other paused", !a.fading && (a.mix === 0 || a.mix === 1) && !fr(a).paused && bk(a).paused && fr(a).clip === "test-clip-2.webm");

  /* hard cut when the crossfade is off */
  await set("xfade", 0);
  await page.keyboard.press("v"); await wait(200);
  a = await st();
  check("with crossfade off, V is a hard cut", a.idx === 2 && !a.fading && !fr(a).paused && fr(a).clip === "test-clip-3.webm");

  /* end of clip, each mode */
  await nearEnd(0.4); await wait(1000);
  a = await st();
  check("cycle: the end of a clip starts the next one", a.idx === 0 && !fr(a).paused && fr(a).t < 1.5, "now on clip " + (a.idx + 1));

  await set("loopMode", "one"); await wait(100);
  a = await st();
  check("loop one without crossfade uses the browser's seamless loop", fr(a).loop === true);
  await nearEnd(0.4); await wait(1000);
  a = await st();
  check("loop one: the clip starts over", a.idx === 0 && !fr(a).paused && fr(a).t < 1.5, "at " + fr(a).t.toFixed(2) + " s");

  await set("xfade", 1); await wait(300);
  a = await st();
  check("loop one with crossfade keeps a second copy of the clip ready", bk(a).clip === fr(a).clip && bk(a).ready && fr(a).loop === false);
  await nearEnd(1.5); await wait(1000);
  a = await st();
  check("loop one: the clip crossfades into its own start", a.idx === 0 && a.fading && a.els[0].clip === a.els[1].clip, "mix " + a.mix.toFixed(2));
  await wait(1000);
  a = await st();
  check("and carries on from the start", a.idx === 0 && !a.fading && !fr(a).paused && fr(a).t < 2.5, "at " + fr(a).t.toFixed(2) + " s");

  await set("xfadeLoop", false); await wait(200);
  a = await st();
  check("\"crossfade when one clip loops\" off goes back to the seamless loop", fr(a).loop === true);
  await set("xfadeLoop", true);

  await set("loopMode", "cycle"); await wait(300);
  await nearEnd(1.6); await wait(1100);
  a = await st();
  check("cycle with crossfade: the fade starts before the clip runs out", a.idx === 1 && a.fading, "mix " + a.mix.toFixed(2));
  await wait(900);

  await set("loopMode", "shuffle"); await set("xfade", 0); await wait(200);
  let moved = 0, prev = (await st()).idx;
  for(let i = 0; i < 6; i++){ await page.keyboard.press("v"); await wait(120); const s = await st(); if(s.idx !== prev) moved++; prev = s.idx; }
  check("shuffle always moves to a different clip", moved === 6, moved + " of 6");
  await set("loopMode", "cycle");

  /* speed applies to both videos */
  await set("rate", 1.5); await wait(100);
  a = await st();
  check("clip speed reaches both videos", a.els[0].rate === 1.5 && a.els[1].rate === 1.5);
  await set("rate", 1);

  /* the kick punch scales the box that holds both videos */
  await set("punch", 1);
  const tf = await page.evaluate(() => new Promise(res => { let n = 0, hit = false; const t = () => { if(/scale/.test(document.getElementById("vids").style.transform)) hit = true; if(++n < 90 && !hit) requestAnimationFrame(t); else res(hit); }; t(); }));
  check("video punch still zooms on the kick", tf === true);
  await set("punch", 0.4);

  /* a file the browser cannot decode */
  await page.evaluate(() => window.__scv.addClips([new File([new Uint8Array(2000)], "broken.webm", {type: "video/webm"})]));
  await page.evaluate(() => document.querySelectorAll("#clips li")[3].click());
  await wait(900);
  a = await st();
  const marks = await page.evaluate(() => Array.from(document.querySelectorAll("#clips li span")).map(s => s.textContent));
  check("a clip that cannot be decoded is marked and skipped", marks[3].startsWith("[can't play]") && fr(a).clip !== "broken.webm" && !fr(a).paused, marks[3]);

  /* removing clips */
  const before = (await st()).idx;
  await page.evaluate(i => document.querySelectorAll("#clips li button")[i].click(), before);
  await wait(400);
  a = await st();
  const left = await page.evaluate(() => window.__scv.clips.length);
  check("removing the playing clip moves on to another", left === 3 && a.idx >= 0 && !fr(a).paused);
  for(let i = 0; i < 3; i++){ await page.evaluate(() => document.querySelector("#clips li button").click()); await wait(120); }
  a = await st();
  check("removing every clip hides the video", a.idx === -1 && a.els.every(e => !e.shown && e.clip === null));

  /* leave three clips playing for the rest of the run */
  await set("xfade", 1);
  await page.evaluate(() => window.__scv.addClips(window.__testClips));
  await wait(600);
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

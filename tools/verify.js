#!/usr/bin/env node
/* Smoke test for the built file.

   Loads dist/soundclash-visualizer.html from file:// in headless Chrome or Edge, with a fake audio
   input that plays the synthesized drum loop (tools/make-drum-loop.js). Clicks Start, watches the
   console, takes screenshots, and compares the hit counts in window.__scv.DET with what the loop
   actually contains. Then it exercises the controls.

   usage: node tools/verify.js [--file=path.html] [--browser=chrome|msedge|bundled|path.exe]
                               [--seconds=8] [--md] [--no-worklet] [--https] [--headed] [--size=1280x720]
                               [--only=hits,stall,zones,clips,cuts,regions,folder,frame,presets,hotkeys]

   --md          leaves the MilkDrop layer on while measuring. Headless Chrome without a GPU renders
                 that layer at a few frames per second, so it is off by default here.
   --no-worklet  forces the main-thread fallback detector.
   --only        runs just the named sections (a quick check while working on one feature).
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

const only = args.only ? String(args.only).split(",") : null;
const run = name => !only || only.includes(name);

/* everything printed also goes to test-output/verify-last.txt, so a failed run can be read without running it again */
const printed = [], print = console.log;
console.log = (...a) => { printed.push(a.join(" ")); print(...a); };
process.on("exit", () => { try{ fs.mkdirSync(outDir, {recursive: true}); fs.writeFileSync(path.join(outDir, "verify-last.txt"), printed.join("\n") + "\n"); }catch(e){} });

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
    return {gpu, features: {zones: !!document.getElementById("zones"), clipState: typeof window.__scv.clipState === "function", cuts: !!document.getElementById("cutOn"), regions: !!document.getElementById("setIn"), folder: !!document.getElementById("openFolder"), frame: !!document.getElementById("frame"), presets: typeof window.__scv.presetState === "function"}};
  });
  console.log("  WebGL renderer: " + info.gpu);

  /* ---------- hit detection ---------- */
  await page.waitForTimeout(run("hits") ? WARMUP_MS : 600);
  const {mode, via, why} = await page.evaluate(() => ({mode: window.__scv.detMode || "interval", via: window.__scv.detVia || "", why: window.__scv.detError || ""}));
  let m = null;
  if(run("hits")){
  m = await countHits(page, WINDOW_MS);
  section("hit detection over " + (m.elapsed / 1000).toFixed(2) + " s, MilkDrop " + (args.md ? "on" : "off") + ", detector: " + mode + ", " + m.fps.toFixed(0) + " frames per second");
  compare(m);
  if(info.features.zones){
    check("detector runs in " + (args["no-worklet"] ? "the main-thread fallback" : "an AudioWorklet"), mode === (args["no-worklet"] ? "interval" : "worklet"), mode + (via ? ", loaded from a " + via + " URL" : "") + (why ? ", " + why : ""));
    if(mode === "worklet") check("worklet loaded from a " + (args.https ? "Blob" : "data:") + " URL on " + (args.https ? "https" : "file://"), via === (args.https ? "blob" : "data"), via);
  }

  await page.screenshot({path: path.join(outDir, "verify.png")});
  }

  if(mode === "worklet" && run("stall")){
    /* the point of the worklet: a main thread that is blocked most of the time must not lose hits */
    const st = await countHits(page, WINDOW_MS, [400, 500]);
    section("same again with the main thread blocked 400 ms out of every 500 (" + st.fps.toFixed(0) + " frames per second)");
    compare(st);
  }

  if(info.features.zones && run("zones")) await zones(page);
  if(info.features.clipState && run("clips")) await clipTests(page);
  if(info.features.cuts && run("cuts")) await cutTests(page);
  if(info.features.regions && run("regions")) await regionTests(page);
  if(info.features.folder && run("folder")) await folderTests(page);
  if(info.features.frame && run("frame")) await frameTests(page);
  if(info.features.presets && run("presets")) await presetTests(page);
  if(run("hotkeys")) await hotkeys(page);

  section("storage");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check("settings are saved under the scv_ prefix", keys.length > 0 && keys.every(k => k.startsWith("scv_")), keys.length + " keys");

  await browser.close();
  finish(errors, external, m && {...m, mode});
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

/* Sections that need clips call this first, so each one can also run on its own (--only). */
async function ensureClips(page){
  if(!(await page.evaluate(() => !!window.__testClips))) await makeClips(page, 3);
  if(await page.evaluate(() => window.__scv.clips.length === 0)){
    await page.evaluate(() => window.__scv.addClips(window.__testClips));
    await page.waitForTimeout(700);
  }
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

/* ---------- beat-synced cuts (the loop has two kicks a second) ---------- */
async function cutTests(page){
  section("beat cuts");
  await ensureClips(page);
  const st = () => page.evaluate(() => window.__scv.clipState());
  const set = (id, value) => page.evaluate(({id, value}) => {
    const el = document.getElementById(id);
    if(el.type === "checkbox") el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(el.type === "range" ? "input" : "change"));
  }, {id, value});
  const wait = ms => page.waitForTimeout(ms);
  const fr = s => s.els[s.front], bk = s => s.els[1 - s.front];
  /* watch for a while: how many cuts, how many clip changes, and whether a fade was ever seen */
  const watch = ms => page.evaluate(ms => new Promise(res => {
    const s0 = window.__scv.clipState(); let changes = 0, prev = s0.idx, faded = false, jumps = 0, lastT = null;
    const t0 = performance.now();
    const tick = () => {
      const s = window.__scv.clipState(), t = s.els[s.front].t;
      if(s.idx !== prev){ changes++; prev = s.idx; }
      if(s.fading) faded = true;
      if(lastT !== null && Math.abs(t - lastT) > 0.4) jumps++;
      lastT = t;
      if(performance.now() - t0 < ms) requestAnimationFrame(tick); else res({cuts: s.cuts - s0.cuts, changes, faded, jumps});
    };
    tick();
  }), ms);

  await set("loopMode", "cycle"); await set("xfade", 1); await set("cutOn", false);
  let w = await watch(1500);
  check("off by default: no cuts", w.cuts === 0);

  await set("cutMode", "clip"); await set("cutEvery", 2); await set("cutGap", 0.5); await set("cutOn", true);
  await wait(300);
  let a = await st();
  check("the clip a cut will jump to is preloaded", bk(a).ready && bk(a).clip !== fr(a).clip, bk(a).clip);
  w = await watch(4200);
  check("every 2 kicks: about one cut a second, each to another clip", w.cuts >= 3 && w.cuts <= 5 && w.changes === w.cuts, w.cuts + " cuts in 4.2 s");
  check("beat cuts are hard cuts even with a 1 s crossfade set", w.faded === false);

  await set("cutGap", 3); await wait(200);
  w = await watch(6400);
  check("a 3 s minimum gap holds the cuts back", w.cuts >= 1 && w.cuts <= 3, w.cuts + " cuts in 6.4 s");

  await set("cutMode", "point"); await set("cutGap", 0.5); await wait(1200);
  a = await st();
  check("random-point mode parks a second copy of the clip at the jump target", bk(a).clip === fr(a).clip && typeof a.planAt === "number", "target " + (a.planAt === null || a.planAt === undefined ? "none" : a.planAt.toFixed(2) + " s"));
  w = await watch(4200);
  check("random point: cuts stay inside the same clip and the picture jumps", w.cuts >= 3 && w.changes === 0 && w.jumps >= 3, w.cuts + " cuts, " + w.jumps + " jumps, " + w.changes + " clip changes");

  /* one clip only: "another clip" has nowhere to go, so it falls back to a random point */
  await set("cutMode", "clip");
  await page.evaluate(() => { while(window.__scv.clips.length > 1){ const s = window.__scv.clipState(), b = document.querySelectorAll("#clips li button"); b[s.idx === 0 ? 1 : 0].click(); } });
  await wait(900);
  w = await watch(3200);
  check("with a single clip, a cut jumps to a random point in it", w.cuts >= 2 && w.jumps >= 2 && (await st()).idx === 0, w.cuts + " cuts");

  await page.screenshot({path: path.join(outDir, "verify-cuts.png")});
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("c"); await wait(150);
  const off = await page.evaluate(() => document.getElementById("cutOn").checked);
  check("C toggles beat cuts", off === false);
  w = await watch(1500);
  check("and no more cuts once off", w.cuts === 0);

  await page.evaluate(() => window.__scv.addClips(window.__testClips.slice(1)));
  await wait(500);
}

/* ---------- per-clip loop regions ---------- */
async function regionTests(page){
  section("loop regions");
  await ensureClips(page);
  const st = () => page.evaluate(() => window.__scv.clipState());
  const clip = i => page.evaluate(i => { const c = window.__scv.clips[i]; return c ? {name: c.name, in: c.in, out: c.out, key: c.key} : null; }, i);
  const set = (id, value) => page.evaluate(({id, value}) => {
    const el = document.getElementById(id);
    if(el.type === "checkbox") el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(el.type === "range" ? "input" : "change"));
  }, {id, value});
  const click = id => page.evaluate(id => document.getElementById(id).click(), id);
  const seek = t => page.evaluate(t => { const s = window.__scv.clipState(), v = document.querySelectorAll("#vids video")[s.front]; v.currentTime = t; }, t);
  const wait = ms => page.waitForTimeout(ms);
  const fr = s => s.els[s.front];
  /* follow the front video for a while: lowest and highest position, loop count, clip changes, fades seen */
  const watch = ms => page.evaluate(ms => new Promise(res => {
    const s0 = window.__scv.clipState(); let lo = 1e9, hi = -1, wraps = 0, last = null, changes = 0, prev = s0.idx, faded = false;
    const t0 = performance.now();
    const tick = () => {
      const s = window.__scv.clipState(), e = s.els[s.front];
      if(s.idx !== prev){ changes++; prev = s.idx; }
      if(s.fading) faded = true;
      if(e.ready && !s.pending){ const t = e.t; lo = Math.min(lo, t); hi = Math.max(hi, t); if(last !== null && t < last - 0.3) wraps++; last = t; }
      if(performance.now() - t0 < ms) requestAnimationFrame(tick); else res({lo, hi, wraps, changes, faded});
    };
    tick();
  }), ms);

  await set("cutOn", false); await set("loopMode", "one"); await set("xfade", 0);
  await page.evaluate(() => document.querySelector("#clips li").click());
  await wait(500);

  /* the position slider seeks */
  let a = await st();
  await set("pos", 2 / fr(a).dur); await wait(250);
  a = await st();
  check("the position slider seeks the clip", Math.abs(fr(a).t - 2.2) < 0.4, "asked for 2.00 s, now at " + fr(a).t.toFixed(2) + " s");

  /* set in at about 2 s, out at about 3.5 s */
  await click("setIn"); await wait(1400); await click("setOut"); await wait(200);
  let c = await clip(0);
  a = await st();
  check("Set in and Set out mark a region on the playing clip", c.in > 1.8 && c.in < 2.8 && c.out > c.in + 1 && c.out < c.in + 2, "in " + c.in + " s, out " + c.out + " s");
  check("after Set out, playback returns to the in point", Math.abs(fr(a).t - c.in) < 0.5 && !fr(a).paused, "at " + fr(a).t.toFixed(2) + " s");
  const text = await page.evaluate(() => document.getElementById("regionV").textContent + " | " + (document.querySelector("#clips li .tag") ? "tag" : "no tag"));
  check("the region is shown in the drawer and tagged in the list", /to/.test(text) && / \| tag$/.test(text), text);

  let w = await watch(4200);
  check("loop one: playback stays inside the region and loops", w.lo >= c.in - 0.15 && w.hi <= c.out + 0.2 && w.wraps >= 2 && w.changes === 0, "stayed in " + w.lo.toFixed(2) + " to " + w.hi.toFixed(2) + " s, " + w.wraps + " loops");

  /* crossfaded loop of the region */
  await set("xfade", 0.5); await wait(300);
  w = await watch(4200);
  check("with a crossfade, the region loop dissolves into its own start", w.faded && w.lo >= c.in - 0.15 && w.hi <= c.out + 0.2 && w.changes === 0, "stayed in " + w.lo.toFixed(2) + " to " + w.hi.toFixed(2) + " s");
  await set("xfade", 0);

  /* beat cuts to a random point stay inside the region */
  await set("cutMode", "point"); await set("cutEvery", 1); await set("cutGap", 0.5); await set("cutOn", true);
  await wait(400);
  const targets = [];
  for(let i = 0; i < 8; i++){ const s = await st(); if(typeof s.planAt === "number") targets.push(s.planAt); await wait(300); }
  check("random-point beat cuts aim inside the region", targets.length >= 4 && targets.every(t => t >= c.in - 0.01 && t <= c.out), targets.length + " targets between " + Math.min(...targets).toFixed(2) + " and " + Math.max(...targets).toFixed(2) + " s");
  await set("cutOn", false); await set("cutMode", "clip"); await set("cutEvery", 16); await set("cutGap", 4);

  /* cycle: the out point ends the clip */
  await set("loopMode", "cycle"); await wait(100);
  await seek(c.in);
  w = await watch((c.out - c.in) * 1000 + 900);
  a = await st();
  check("cycle: the out point moves on to the next clip", a.idx === 1 && w.changes === 1, "now on clip " + (a.idx + 1));

  /* saved, and restored when the page is opened again with the same files */
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("scv_regions") || "{}"));
  check("the region is saved under the file's name and size", Array.isArray(saved[c.key]) && saved[c.key][0] === c.in && saved[c.key][1] === c.out, c.key);
  /* Keep the recorded files across a reload (IndexedDB), and plant a region that cannot fit clip 2,
     as if some other file had the same name and size. */
  const c2 = await clip(1);
  await page.evaluate(async key => {
    const r = JSON.parse(localStorage.getItem("scv_regions")); r[key] = [50, 60]; localStorage.setItem("scv_regions", JSON.stringify(r));
    const files = window.__scv.clips.map(c => window.__testClips.find(f => f.name === c.name));
    await new Promise((res, rej) => { const q = indexedDB.open("scv-verify", 1); q.onupgradeneeded = () => q.result.createObjectStore("f"); q.onerror = () => rej(q.error);
      q.onsuccess = () => { const tx = q.result.transaction("f", "readwrite"); tx.objectStore("f").put(files, "clips"); tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; });
  }, c2.key);
  await page.reload();
  await page.evaluate(() => { const el = document.getElementById("mdOn"); el.checked = false; el.dispatchEvent(new Event("change")); });
  await page.click("#goMic");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("start")).display === "none", null, {timeout: 15000});
  const planted = await page.evaluate(async () => {
    window.__testClips = await new Promise((res, rej) => { const q = indexedDB.open("scv-verify", 1); q.onerror = () => rej(q.error);
      q.onsuccess = () => { const g = q.result.transaction("f").objectStore("f").get("clips"); g.onsuccess = () => { q.result.close(); res(g.result); }; g.onerror = () => rej(g.error); }; });
    indexedDB.deleteDatabase("scv-verify");
    window.__scv.addClips(window.__testClips);
    return window.__scv.clips[1].in;              // read before the clip has had time to load
  });
  await wait(900);
  const back = await clip(0), fixed = await clip(1);
  a = await st();
  check("after a reload, the same file gets its region back", back.in === c.in && back.out === c.out, back.in + " to " + back.out + " s");
  check("and playback starts inside it", fr(a).t >= c.in - 0.15 && fr(a).t <= c.out + 0.2 && !fr(a).paused, "at " + fr(a).t.toFixed(2) + " s");
  check("a saved region that does not fit the file is dropped when the clip loads", planted === 50 && fixed.in === null && fixed.out === null, "was 50 to 60 s on a " + CLIP_SEC + " s clip");

  /* Clear, then the I and O hotkeys */
  await set("loopMode", "one"); await set("xfade", 0); await wait(200);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await click("clearRegion"); await wait(200);
  c = await clip(0); a = await st();
  check("Clear removes the region and the seamless loop is back", c.in === null && c.out === null && fr(a).loop === true);
  await seek(1.0); await wait(250);
  await page.keyboard.press("i"); await wait(1300); await page.keyboard.press("o"); await wait(200);
  c = await clip(0);
  check("I and O set the in and out points", c.in > 0.8 && c.in < 1.8 && c.out > c.in + 0.9, "in " + c.in + " s, out " + c.out + " s");
  await page.mouse.move(vw - 60, vh / 2); await page.mouse.move(vw - 80, vh / 2 + 5);
  await page.locator("#setIn").scrollIntoViewIfNeeded();
  await wait(200);
  await page.screenshot({path: path.join(outDir, "verify-region.png")});
  await click("clearRegion");
  await set("loopMode", "cycle"); await set("xfade", 1);
  await wait(300);
}

/* ---------- open a folder ---------- */
/* The native folder dialog cannot be driven from a test, so showDirectoryPicker is replaced. First with a
   stand-in folder (checks the reading: subfolders, sort order, non-video files), then, where the browser
   allows it on this page, with a real directory handle from its private file system (checks that the
   folder is remembered and reopened after a reload). The dialog itself is not exercised. */
async function folderTests(page){
  section("open folder");
  await ensureClips(page);
  const names = () => page.evaluate(() => window.__scv.clips.map(c => c.name));
  const note = () => page.evaluate(() => document.getElementById("folderV").textContent);
  const wait = ms => page.waitForTimeout(ms);

  await page.evaluate(() => {
    const [a, b, c] = window.__testClips;
    const as = (f, name) => new File([f], name, {type: f.type});
    const file = (name, f) => ({kind: "file", name, getFile: async () => f});
    const dir = (name, kids) => ({kind: "directory", name, queryPermission: async () => "granted", requestPermission: async () => "granted",
      async *entries(){ for(const k of kids) yield [k.name, k]; }});
    window.showDirectoryPicker = async () => dir("party clips", [
      file("b intro.webm", as(b, "b intro.webm")), file("readme.txt", new File(["x"], "readme.txt")), file("a opener.WEBM", as(a, "a opener.WEBM")),
      dir("late night", [file("clip 10.webm", as(c, "clip 10.webm")), file("clip 2.webm", as(a, "clip 2.webm")), file("cover.jpg", new File(["x"], "cover.jpg"))]),
    ]);
  });
  await page.evaluate(() => document.getElementById("openFolder").click());
  await wait(900);
  let n = await names(), s = await page.evaluate(() => window.__scv.clipState());
  check("Open folder replaces the playlist with every video in the folder, subfolders too", n.join(" | ") === "a opener.WEBM | b intro.webm | clip 2.webm | clip 10.webm", n.join(" | "));
  check("sorted by path with numbers in order, other files ignored", n.indexOf("clip 2.webm") < n.indexOf("clip 10.webm") && !n.some(x => /txt|jpg/.test(x)));
  check("the first clip of the folder plays", s.idx === 0 && !s.els[s.front].paused && s.els[s.front].clip === "a opener.WEBM");
  check("the drawer says which folder is loaded", /party clips, 4 clips/.test(await note()), await note());

  /* remembered between launches: needs a real handle */
  const real = await page.evaluate(async () => {
    try{
      const root = await navigator.storage.getDirectory();
      const d = await root.getDirectoryHandle("scv-verify-folder", {create: true});
      const put = async (dirH, name, f) => { const h = await dirH.getFileHandle(name, {create: true}), w = await h.createWritable(); await w.write(f); await w.close(); };
      await put(d, "one.webm", window.__testClips[0]);
      const sub = await d.getDirectoryHandle("more", {create: true});
      await put(sub, "two.webm", window.__testClips[1]);
      window.showDirectoryPicker = async () => d;
      return "ok";
    }catch(e){ return String(e && e.name || e); }
  });
  if(real !== "ok"){
    console.log("  skip  remembered folder: this page cannot get a real folder handle in a test (" + real + ")");
    return;
  }
  await page.evaluate(() => document.getElementById("openFolder").click());
  await wait(900);
  n = await names();
  check("a real folder handle loads the same way", n.join(" | ") === "more/two.webm".split("/").pop() + " | one.webm" || n.join(" | ") === "two.webm | one.webm" || n.join(" | ") === "one.webm | two.webm", n.join(" | "));
  check("and is remembered", /Remembered/.test(await note()) && await page.evaluate(() => !document.getElementById("forgetFolder").hidden), await note());
  await page.reload();
  await wait(1200);
  n = await names();
  check("after a reload the folder opens again by itself", n.length === 2 && n.includes("one.webm") && n.includes("two.webm"), n.join(" | ") + " :: " + await note());
  await page.evaluate(() => document.getElementById("forgetFolder").click());
  await wait(300);
  await page.reload();
  await wait(900);
  n = await names();
  check("Forget folder stops that", n.length === 0, n.length + " clips after reload");
  await page.evaluate(async () => { try{ const root = await navigator.storage.getDirectory(); await root.removeEntry("scv-verify-folder", {recursive: true}); }catch(e){} });
  /* back to a running show for whatever comes next */
  if(!args.md) await page.evaluate(() => { const el = document.getElementById("mdOn"); el.checked = false; el.dispatchEvent(new Event("change")); });
  await page.click("#goMic");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("start")).display === "none", null, {timeout: 15000});
  await ensureClips(page);
}

/* ---------- border ---------- */
async function frameTests(page){
  section("border");
  await ensureClips(page);
  const set = (id, value) => page.evaluate(({id, value}) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event(el.type === "range" ? "input" : "change")); }, {id, value});
  const wait = ms => page.waitForTimeout(ms);
  /* read the border canvas: alpha in the middle and in a corner, how many different colours run along the top
     edge, and a fingerprint of the top strip (to see it move) */
  const look = () => page.evaluate(() => {
    const c = document.getElementById("frame"), g = c.getContext("2d"), W = c.width, H = c.height;
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    const row = g.getImageData(0, 1, W, 1).data, hues = new Set(); let sum = 0;
    for(let x = 0; x < W; x += 4){ const r = row[x*4], gg = row[x*4+1], b = row[x*4+2]; if(Math.max(r, gg, b) - Math.min(r, gg, b) > 60) hues.add((r > 128 ? 4 : 0) + (gg > 128 ? 2 : 0) + (b > 128 ? 1 : 0)); }
    const strip = g.getImageData(0, 0, W, Math.max(1, Math.round(H * 0.05))).data;
    for(let i = 0; i < strip.length; i += 16) sum = (sum + strip[i] * 7 + strip[i+1] * 3 + strip[i+2]) % 1000003;
    return {mid: px(W >> 1, H >> 1)[3], corner: px(3, 3), hues: hues.size, sum, W, H};
  });

  await set("frameStyle", "off"); await wait(150);
  let a = await look();
  check("off: nothing is drawn", a.mid === 0 && a.corner[3] === 0);

  await set("frameX", 8); await set("frameY", 10); await set("frameStyle", "solid"); await wait(150);
  a = await look();
  check("solid: the edges are covered and the middle is clear", a.corner[3] === 255 && a.corner[0] < 30 && a.mid === 0, "corner rgba " + a.corner.join(","));

  await set("frameColor", "rainbow"); await set("frameStyle", "bars"); await wait(400);
  a = await look(); await wait(300); const b = await look();
  check("colour bars: several colours along the edge", a.hues >= 4 && a.mid === 0 && a.corner[3] === 255, a.hues + " colour groups");
  check("colour bars move with the music", a.sum !== b.sum);
  await page.mouse.move(40, 300); await wait(3800);                 // let the drawer slide away for the picture
  await page.screenshot({path: path.join(outDir, "verify-border.png")});

  await set("frameColor", "app"); await wait(300);
  a = await look();
  check("red bars: one colour family", a.hues <= 2 && a.hues >= 1, a.hues + " colour groups");

  await set("frameStyle", "pulse"); await wait(200);
  const lit = await page.evaluate(() => new Promise(res => { const c = document.getElementById("frame"), g = c.getContext("2d"); let n = 0, max = 0;
    const t = () => { const p = g.getImageData(3, 3, 1, 1).data; if(p[0] > max) max = p[0]; if(++n < 80) requestAnimationFrame(t); else res(max); }; t(); }));
  check("pulse: the border lights up on the kick", lit > 60, "red channel peaked at " + lit);

  /* shapes: border widths are 8% and 10% here */
  await set("frameColor", "rainbow"); await set("frameStyle", "solid"); await set("frameShape", "oval"); await wait(250);
  const oval = await page.evaluate(() => {
    const c = document.getElementById("frame"), g = c.getContext("2d"), W = c.width, H = c.height, bx = Math.round(W * 0.08), by = Math.round(H * 0.10);
    const px = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    return {corner: px(2, 2), insideRect: px(bx + 8, by + 8)[3], mid: px(W / 2, H / 2)[3], top: px(W / 2, by + 10)[3]};
  });
  check("oval: pure black outside an oval hole", oval.corner.join(",") === "0,0,0,255" && oval.insideRect === 255 && oval.mid === 0 && oval.top === 0, "corner rgba " + oval.corner.join(","));

  await set("frameStyle", "bars"); await wait(200);
  const ring = await page.evaluate(() => new Promise(res => { const c = document.getElementById("frame"), g = c.getContext("2d"), W = c.width, H = c.height, by = Math.round(H * 0.10); let n = 0, best = 0;
    const t = () => {          /* a strip of pixels just under the bottom of the oval, wide enough to cross a few bars */
      const row = g.getImageData(Math.round(W / 2 - W * 0.06), H - by + Math.round(H * 0.02), Math.round(W * 0.12), 1).data;
      for(let i = 0; i < row.length; i += 4){ const sat = Math.max(row[i], row[i+1], row[i+2]) - Math.min(row[i], row[i+1], row[i+2]); if(sat > best) best = sat; }
      if(++n < 70) requestAnimationFrame(t); else res(best); }; t(); }));
  check("oval: the colour bars stand around the oval", ring > 100, "colour strength " + ring + " just below the oval");

  await set("frameShape", "blob"); await wait(300);
  const blob = await page.evaluate(() => new Promise(res => {
    const c = document.getElementById("frame"), g = c.getContext("2d"), W = c.width, H = c.height, rx = W / 2 - Math.round(W * 0.08), ry = H / 2 - Math.round(H * 0.10);
    const seen = new Set(), sides = new Set(); let n = 0;
    const t = () => {          /* test 24 points a little outside the plain oval: clear there means the blob has grown past it */
      let bits = "";
      for(let i = 0; i < 24; i++){ const th = i / 24 * Math.PI * 2, a = g.getImageData(Math.round(W / 2 + rx * 1.07 * Math.cos(th)), Math.round(H / 2 + ry * 1.07 * Math.sin(th)), 1, 1).data[3]; bits += a < 128 ? "1" : "0"; if(a < 128) sides.add(i >> 2); }
      seen.add(bits);
      if(++n < 200) requestAnimationFrame(t); else res({shapes: seen.size, sides: sides.size});
    }; t();
  }));
  check("blob: the outline keeps changing", blob.shapes >= 4, blob.shapes + " different outlines in 200 frames");
  check("blob: it bulges in different directions on different kicks", blob.sides >= 3, blob.sides + " of 6 directions in about 3 s");
  await page.screenshot({path: path.join(outDir, "verify-blob.png")});
  await set("frameShape", "rect"); await set("frameStyle", "bars");

  /* video zoom: the box that holds both videos is scaled; the kick punch can add up to 5% on top */
  const scale = () => page.evaluate(() => { const m = /scale\(([\d.]+)\)/.exec(document.getElementById("vids").style.transform); return m ? +m[1] : 1; });
  await set("zoom", 1.5); await wait(200);
  let z = await scale();
  check("video zoom enlarges the picture", z >= 1.5 && z <= 1.58, "scale " + z);
  check("the zoom is saved", await page.evaluate(() => localStorage.getItem("scv_zoom")) === "1.5");
  await set("zoom", 1); await wait(200);
  z = await scale();
  check("and back at 100% the picture is its normal size", z <= 1.06, "scale " + z);

  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await set("frameStyle", "off");
  const seen = [];
  for(let i = 0; i < 4; i++){ await page.keyboard.press("b"); await wait(80); seen.push(await page.evaluate(() => document.getElementById("frameStyle").value)); }
  check("B steps through the border styles", seen.join(" ") === "solid bars pulse off", seen.join(" "));
  check("the border style is saved", await page.evaluate(() => localStorage.getItem("scv_frameStyle")) === "off");
}

/* ---------- preset packs and favourites ---------- */
async function presetTests(page){
  section("presets and favourites");
  const ps = () => page.evaluate(() => window.__scv.presetState());
  const set = (id, value) => page.evaluate(({id, value}) => { const el = document.getElementById(id); if(el.type === "checkbox") el.checked = value; else el.value = value; el.dispatchEvent(new Event(el.type === "range" ? "input" : "change")); }, {id, value});
  const wait = ms => page.waitForTimeout(ms);
  const pickPreset = i => set("preset", String(i));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.evaluate(() => localStorage.removeItem("scv_stars"));

  let s = await ps();
  check("presets from all four packs are in the list", s.count >= 350, s.count + " presets, the first pack alone has 100");

  /* star three presets: by button, by button, by hotkey */
  await pickPreset(5); await page.evaluate(() => document.getElementById("star").click());
  await pickPreset(120); await page.evaluate(() => document.getElementById("star").click());
  await pickPreset(300); await page.keyboard.press("k"); await wait(100);
  s = await ps();
  const ui = await page.evaluate(() => ({btn: document.getElementById("star").textContent, opt: document.getElementById("preset").options[300].textContent, saved: JSON.parse(localStorage.getItem("scv_stars") || "[]").length}));
  check("the Star button and K star the current preset", s.stars.length === 3 && ui.btn.startsWith("★") && ui.opt.startsWith("★ "), ui.btn + " | " + ui.opt.slice(0, 30));
  check("stars are saved", ui.saved === 3);

  await set("starList", true);
  const shown = await page.evaluate(() => Array.from(document.getElementById("preset").options).filter(o => !o.hidden).length);
  check("\"List starred presets only\" hides the rest", shown === 3, shown + " shown");
  await set("starList", false);

  /* auto change limited to starred presets: shortest interval is 5 s, so watch two changes */
  await set("mdOn", true); await set("cycle", 5); await set("starOnly", true);
  await pickPreset(10);                                   // start on one that is not starred
  const seen = await page.evaluate(() => new Promise(res => { const names = []; let last = window.__scv.presetState().name; const t0 = performance.now();
    const t = setInterval(() => { const n = window.__scv.presetState().name; if(n !== last){ names.push(n); last = n; } if(performance.now() - t0 > 11500){ clearInterval(t); res(names); } }, 200); }));
  check("with \"starred only\" on, auto change lands only on starred presets", seen.length >= 2 && seen.every(n => s.stars.includes(n)), seen.length + " changes");
  await set("starOnly", false); await set("cycle", 30);
  if(!args.md) await set("mdOn", false);

  await pickPreset(300); await page.keyboard.press("k"); await wait(100);
  s = await ps();
  check("K again removes the star", s.stars.length === 2);
  await page.evaluate(() => localStorage.removeItem("scv_stars"));
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

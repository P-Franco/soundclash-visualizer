#!/usr/bin/env node
/* Smoke test for the built file.

   Loads dist/soundclash-visualizer.html from file:// in headless Chrome or Edge, with a fake audio
   input that plays the synthesized drum loop (tools/make-drum-loop.js). Clicks Start, watches the
   console, takes screenshots, and compares the hit counts in window.__scv.DET with what the loop
   actually contains. Then it exercises the controls.

   usage: node tools/verify.js [--file=path.html] [--browser=chrome|msedge|bundled|path.exe]
                               [--seconds=8] [--md] [--no-worklet] [--https] [--headed] [--size=1280x720]
                               [--only=hits,stall,zones,audio,clips,shuffle,folder,frame,presets,controls,words,show,hotkeys]

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
    return {gpu, features: {zones: !!document.getElementById("zones"), clipState: typeof window.__scv.clipState === "function", folder: !!document.getElementById("openFolder"), frame: !!document.getElementById("frame"), presets: typeof window.__scv.presetState === "function", words: typeof window.__scv.wordsState === "function", show: !!document.getElementById("showOn"), sys: !!document.getElementById("sysBtn")}};
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
  if(info.features.sys && run("audio")) await audioTests(page);
  if(info.features.clipState && run("clips")) await clipTests(page);
  if(info.features.clipState && run("shuffle")) await shuffleTests(page);
  if(info.features.folder && run("folder")) await folderTests(page);
  if(info.features.frame && run("frame")) await frameTests(page);
  if(info.features.presets && run("presets")) await presetTests(page);
  if(info.features.frame && run("controls")) await controlTests(page);
  if(info.features.words && run("words")) await wordTests(page);
  if(info.features.show && run("show")) await showTests(page);
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

/* ---------- sound sources ---------- */
/* The real share window cannot be driven from a test, so getDisplayMedia is replaced with stand-ins:
   one that hands back sound (the fake input again), one with no sound, one that is refused.
   That checks what the app does with each answer, not that a browser really shares system audio. */
async function audioTests(page){
  section("sound sources");
  const wait = ms => page.waitForTimeout(ms);
  const label = () => page.evaluate(() => window.__scv.inputLabel);
  const pick = v => page.evaluate(v => { const el = document.getElementById("device"); el.value = v; el.dispatchEvent(new Event("change")); }, v);
  const sys = () => page.evaluate(() => ({btn: document.getElementById("sysBtn").textContent, note: document.getElementById("sysV").textContent}));
  const stub = kind => page.evaluate(kind => { navigator.mediaDevices.getDisplayMedia = async () => {
    if(kind === "refused"){ const e = new Error("no"); e.name = "NotAllowedError"; throw e; }
    const v = document.createElement("canvas").captureStream(1).getVideoTracks()[0];
    if(kind === "silent") return new MediaStream([v]);
    const mic = await navigator.mediaDevices.getUserMedia({audio: true});
    return new MediaStream([v, mic.getAudioTracks()[0]]); }; }, kind);

  const opts = await page.evaluate(() => Array.from(document.getElementById("device").options).map(o => o.textContent));
  check("the input list offers no input, all inputs together, and each device", opts[0] === "No input device" && opts[1] === "All inputs together" && opts.length >= 3, opts.join(" | "));
  const one = await label();

  await pick("__all"); await wait(1500);
  const all = await label(), n = +((/ALL INPUTS \((\d+)\)/.exec(all) || [0, 0])[1]);
  check("\"All inputs together\" opens every input at once", n >= 2, all);
  let m = await countHits(page, 2500);
  check("and the music is still heard through them", m.counts[0] >= 3, m.counts[0] + " kicks in 2.5 s");

  await stub("sound");
  await page.evaluate(() => document.getElementById("sysBtn").click()); await wait(800);
  let s = await sys();
  check("this computer's sound is added on top of the inputs", /\+ COMPUTER SOUND$/.test(await label()) && /^Stop/.test(s.btn), await label());
  await page.evaluate(() => document.getElementById("sysBtn").click()); await wait(300);
  s = await sys();
  check("the same button stops it again", !/COMPUTER/.test(await label()) && /^Also/.test(s.btn));

  await stub("silent");
  await page.evaluate(() => document.getElementById("sysBtn").click()); await wait(500);
  s = await sys();
  check("a share with no sound is turned down, with a hint to tick the audio box", !/COMPUTER/.test(await label()) && /tick the box/.test(s.note), s.note);
  await stub("refused");
  await page.evaluate(() => document.getElementById("sysBtn").click()); await wait(400);
  s = await sys();
  check("cancelling the share window changes nothing", !/COMPUTER/.test(await label()) && /cancelled/.test(s.note));

  const firstDevice = await page.evaluate(() => document.getElementById("device").options[2].value);
  await pick(firstDevice); await wait(900);
  check("picking one device goes back to just that device", !/ALL INPUTS/.test(await label()) && (await label()).length > 0, await label());

  /* a fresh launch with nothing but this computer's sound */
  await page.reload();
  if(!args.md) await page.evaluate(() => { const el = document.getElementById("mdOn"); el.checked = false; el.dispatchEvent(new Event("change")); });
  await stub("sound");
  await page.click("#goSys");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("start")).display === "none", null, {timeout: 15000});
  await wait(1500);
  m = await countHits(page, 2500);
  check("the show can start from this computer's sound alone", (await label()) === "COMPUTER SOUND" && m.counts[0] >= 3, (await label()) + ", " + m.counts[0] + " kicks in 2.5 s");
  await pick("__all"); await wait(1200);
  check("and inputs can be added to it afterwards", /^ALL INPUTS \(\d+\) \+ COMPUTER SOUND$/.test(await label()), await label());
  await pick("__none"); await wait(400);
  check("\"No input device\" leaves just this computer's sound", (await label()) === "COMPUTER SOUND");
  await pick("__all"); await wait(1200);
  await page.evaluate(() => document.getElementById("sysBtn").click()); await wait(300);
  void one;
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

/* ---------- random order, in rounds ---------- */
async function shuffleTests(page){
  section("random order");
  await ensureClips(page);
  const put = (id, value) => page.evaluate(({id, value}) => { const el = document.getElementById(id);
    if(el.type === "checkbox") el.checked = value; else el.value = value; el.dispatchEvent(new Event(el.type === "range" ? "input" : "change")); }, {id, value});
  const st = () => page.evaluate(() => window.__scv.clipState());
  const wait = ms => page.waitForTimeout(ms);
  /* let the playing clip run out: jump to just before its end and wait for the next one to take over */
  const playOut = async () => {
    const before = (await st()).idx;
    await page.evaluate(() => { const s = window.__scv.clipState(), v = document.querySelectorAll("#vids video")[s.front]; v.currentTime = Math.max(0, v.duration - 0.25); });
    await page.waitForFunction(b => { const s = window.__scv.clipState(); return s.idx !== b && !s.pending && !s.els[s.front].paused; }, before, {timeout: 5000});
    await wait(150);
    return (await st()).idx;
  };
  check("random order is the default for a new browser", await page.evaluate(() => document.getElementById("loopMode").options[0].value === "shuffle" && document.getElementById("loopMode").options[0].defaultSelected));
  check("the randomizer, beat cuts and loop regions are gone: nothing changes inside a clip", await page.evaluate(() => ["randOn", "randEvery", "randPoint", "randClip", "cutOn", "cutMode", "cutEvery", "cutGap", "pos", "setIn", "setOut", "clearRegion"].every(id => !document.getElementById(id))));

  await put("xfade", 0); await put("loopMode", "cycle"); await put("loopMode", "shuffle"); await wait(300);
  const n = await page.evaluate(() => window.__scv.clips.length), start = (await st()).idx, seq = [];
  for(let i = 0; i < n * 3; i++) seq.push(await playOut());
  const rounds = [seq.slice(0, n), seq.slice(n, 2 * n), seq.slice(2 * n)];
  check("each round plays every clip exactly once", rounds.every(r => new Set(r).size === n), rounds.map(r => r.map(i => i + 1).join(" ")).join("  |  "));
  check("the same clip never plays twice in a row, across rounds too", [start, ...seq].every((v, i, a) => i === 0 || v !== a[i - 1]));
  check("clips play from the start, not from a random point", (await page.evaluate(() => { const s = window.__scv.clipState(); return s.els[s.front].t; })) < 1.2);
  const orders = new Set(rounds.map(r => r.join("")));
  console.log("        (" + orders.size + " different orders in 3 rounds of " + n + " clips; with so few clips a repeat order can happen by chance)");

  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const a = (await st()).idx; await page.keyboard.press("r"); await wait(300);
  check("R no longer does anything", (await st()).idx === a);
  const t1 = (await st()).els[(await st()).front].t;
  for(const key of ["c", "i", "o"]) await page.keyboard.press(key);
  await wait(300);
  const s2 = await st();
  check("C, I and O no longer do anything", s2.idx === a && s2.els[s2.front].t > t1 && !s2.els[s2.front].paused);
  await put("loopMode", "cycle"); await put("xfade", 1);
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
  check("a clip from the folder plays (which one is random by default)", s.idx >= 0 && !s.els[s.front].paused && n.includes(s.els[s.front].clip), s.els[s.front].clip);
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
  /* these checks read pixels back; the Japanese text draws on the same canvas, so it is off for the duration */
  await page.evaluate(() => { const el = document.getElementById("wordsOn"); if(el){ el.checked = false; el.dispatchEvent(new Event("change")); } });
  const set = (id, value) => page.evaluate(({id, value}) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event(el.type === "range" ? "input" : "change")); }, {id, value});
  const wait = ms => page.waitForTimeout(ms);
  /* read the border canvas: alpha in the middle and in a corner, how many different colours run along the top
     edge, and a fingerprint of the top strip (to see it move) */
  const look = () => page.evaluate(() => {
    const c = document.getElementById("frame"), g = c.getContext("2d"), W = c.width, H = c.height;
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    const row = g.getImageData(0, 1, W, 1).data, hues = new Set(); let sum = 0;
    for(let x = 0; x < W; x += 4){ const r = row[x*4], gg = row[x*4+1], b = row[x*4+2]; const M = Math.max(r, gg, b), d = M - Math.min(r, gg, b);
      if(d > 60){ let hue = M === r ? ((gg - b) / d) % 6 : M === gg ? (b - r) / d + 2 : (r - gg) / d + 4; hue = (hue * 60 + 360) % 360; hues.add(Math.floor(hue / 30)); } }   // hue in 30 degree steps
    const strip = g.getImageData(0, 0, W, Math.max(1, Math.round(H * 0.05))).data;
    for(let i = 0; i < strip.length; i += 16) sum = (sum + strip[i] * 7 + strip[i+1] * 3 + strip[i+2]) % 1000003;
    return {mid: px(W >> 1, H >> 1)[3], corner: px(3, 3), hues: hues.size, redOnly: Array.from(hues).every(h => h === 0 || h >= 10), sum, W, H};
  });

  await set("frameStyle", "off"); await wait(150);
  let a = await look();
  check("off: nothing is drawn", a.mid === 0 && a.corner[3] === 0);

  /* the status text has its own switch, separate from the graph */
  const hudLook = () => page.evaluate(() => { const c = document.getElementById("hud"), g = c.getContext("2d"), W = c.width, H = c.height;
    const any = (x, y, w, h) => { const d = g.getImageData(x, y, w, h).data; for(let i = 3; i < d.length; i += 4) if(d[i] > 0) return true; return false; };
    return {status: any(20, 20, 200, 60), graph: any(40, H - 120, W - 80, 40)}; });
  const tick = (id, on) => page.evaluate(({id, on}) => { const el = document.getElementById(id); el.checked = on; el.dispatchEvent(new Event("change")); }, {id, on});
  await tick("hudOn", true); await tick("statusOn", true); await wait(120);
  let h = await hudLook();
  check("graph and status text both showing", h.status && h.graph);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("t"); await wait(120);
  h = await hudLook();
  check("T hides the status text and leaves the graph", !h.status && h.graph);
  await tick("hudOn", false); await tick("statusOn", true); await wait(120);
  h = await hudLook();
  check("the graph can be hidden with the status text still showing", h.status && !h.graph);
  await tick("hudOn", true); await tick("statusOn", false); await wait(120);

  await set("frameX", 8); await set("frameY", 10); await set("frameStyle", "solid"); await wait(150);
  a = await look();
  check("solid: the edges are covered and the middle is clear", a.corner[3] === 255 && a.corner[0] < 30 && a.mid === 0, "corner rgba " + a.corner.join(","));

  await set("frameStyle", "bars"); await wait(400);
  a = await look(); await wait(300); const b = await look();
  check("bars: drawn along the edge, all in the app's red to pink, nothing in the middle", a.redOnly && a.hues >= 1 && a.mid === 0 && a.corner[3] === 255, a.hues + " hue step(s)");
  check("bars move with the music", a.sum !== b.sum);
  check("there is no Colours option any more", await page.evaluate(() => document.getElementById("frameColor") === null));
  await page.mouse.move(40, 300); await wait(3800);                 // let the drawer slide away for the picture
  await page.screenshot({path: path.join(outDir, "verify-border.png")});


  await set("frameStyle", "pulse"); await wait(200);
  const lit = await page.evaluate(() => new Promise(res => { const c = document.getElementById("frame"), g = c.getContext("2d"); let n = 0, max = 0;
    const t = () => { const p = g.getImageData(3, 3, 1, 1).data; if(p[0] > max) max = p[0]; if(++n < 80) requestAnimationFrame(t); else res(max); }; t(); }));
  check("pulse: the border lights up on the kick", lit > 60, "red channel peaked at " + lit);

  /* shapes: border widths are 8% and 10% here */
  await tick("hudOn", false);                                  // the bare shape first, without the graph
  await set("frameStyle", "solid"); await set("frameShape", "oval"); await wait(250);
  const oval = await page.evaluate(() => {
    const c = document.getElementById("frame"), g = c.getContext("2d"), W = c.width, H = c.height, bx = Math.round(W * 0.08), by = Math.round(H * 0.10);
    const px = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    return {corner: px(2, 2), insideRect: px(bx + 8, by + 8)[3], mid: px(W / 2, H / 2)[3], top: px(W / 2, by + 40)[3]};       // 40 px in: past the soft dark rim just inside the edge
  });
  check("oval: pure black outside an oval hole", oval.corner.join(",") === "0,0,0,255" && oval.insideRect === 255 && oval.mid === 0 && oval.top === 0, "corner rgba " + oval.corner.join(","));

  /* the graph on an oval: nothing rectangular on the graph canvas, a curved graph on the border canvas instead */
  const inside = () => page.evaluate(() => { const c = document.getElementById("frame"), g = c.getContext("2d"), W = c.width, H = c.height, by = Math.round(H * 0.10);
    const d = g.getImageData(Math.round(W / 2 - W * 0.05), H - by - Math.round(H * 0.06), Math.round(W * 0.10), Math.round(H * 0.04)).data; let n = 0;
    for(let i = 3; i < d.length; i += 4) if(d[i] > 40) n++; return n; });
  const names = () => page.evaluate(() => Array.from(document.getElementById("graph").options).map(o => o.textContent).join(" | "));
  const bare = await inside();
  await tick("hudOn", true); await set("graph", "bars"); await wait(300);
  h = await hudLook();
  const leds = await inside();
  check("oval: the rectangular graph is gone and the spectrum curve runs round the inside of the edge", !h.graph && leds > bare + 50, leds + " graph pixels just inside the bottom edge, " + bare + " without the graph");
  check("oval: one graph only, so the style list is hidden", await page.evaluate(() => document.getElementById("graph").closest("label").hidden));
  await set("graph", "curve"); await wait(400);
  h = await hudLook();
  check("oval: choosing the other style changes nothing there (no LED bars inside)", !h.graph && (await inside()) > bare + 50);
  await page.screenshot({path: path.join(outDir, "verify-ring-curve.png")});
  await set("graph", "bars");

  await set("frameStyle", "bars"); await wait(200);
  const ring = await page.evaluate(() => new Promise(res => { const c = document.getElementById("frame"), g = c.getContext("2d"), W = c.width, H = c.height, by = Math.round(H * 0.10); let n = 0, best = 0;
    const t = () => {          /* a strip of pixels just under the bottom of the oval, wide enough to cross a few bars */
      const row = g.getImageData(Math.round(W / 2 - W * 0.06), H - by + Math.round(H * 0.02), Math.round(W * 0.12), 1).data;
      for(let i = 0; i < row.length; i += 4){ const sat = Math.max(row[i], row[i+1], row[i+2]) - Math.min(row[i], row[i+1], row[i+2]); if(sat > best) best = sat; }
      if(++n < 70) requestAnimationFrame(t); else res(best); }; t(); }));
  check("oval: the bars stand around the oval", ring > 100, "colour strength " + ring + " just below the oval");

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
  const fx = await page.evaluate(() => new Promise(res => { let sparks = 0, rings = 0, n = 0;
    const t = () => { const s = window.__scv.frameState(); sparks = Math.max(sparks, s.sparks); rings = Math.max(rings, s.ripples); if(++n < 150) requestAnimationFrame(t); else res({sparks, rings}); }; t(); }));
  check("blob: a kick throws sparks and sends out a ring", fx.sparks > 0 && fx.rings > 0, "up to " + fx.sparks + " sparks and " + fx.rings + " rings at once");
  await page.waitForFunction(() => { const s = window.__scv.frameState(); return s.sparks > 12 && s.ripples > 0; }, null, {timeout: 5000});   // catch a kick for the picture
  await page.screenshot({path: path.join(outDir, "verify-blob.png")});
  await tick("fx", false); await wait(200);
  const quiet = await page.evaluate(() => window.__scv.frameState());
  check("sparks and ripples can be switched off", quiet.sparks === 0 && quiet.ripples === 0);
  await tick("fx", true);
  await tick("glow", false); await wait(200);
  const plain = await look();
  await tick("glow", true); await wait(200);
  check("glow can be switched off and on without breaking the border", plain.corner[3] === 255 && (await look()).corner[3] === 255 && await page.evaluate(() => localStorage.getItem("scv_glow")) === "1");
  await set("frameShape", "rect"); await set("frameStyle", "bars"); await wait(200);
  h = await hudLook();
  check("rectangle: the rectangular graph and its style list are back", h.graph && /light up on hits/.test(await names()) && await page.evaluate(() => !document.getElementById("graph").closest("label").hidden));

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
  await tick("statusOn", true);
  await page.evaluate(() => { const el = document.getElementById("wordsOn"); if(el){ el.checked = true; el.dispatchEvent(new Event("change")); } });
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

/* ---------- only controls that do something are on screen ---------- */
async function controlTests(page){
  section("controls shown");
  const put = (id, value) => page.evaluate(({id, value}) => { const el = document.getElementById(id);
    if(el.type === "checkbox") el.checked = value; else el.value = value; el.dispatchEvent(new Event(el.type === "range" ? "input" : "change")); }, {id, value});
  /* is the control (its label or row) showing? */
  const on = ids => page.evaluate(ids => ids.map(id => { const el = document.getElementById(id); return !(el.closest("label") || el.closest(".row") || el).hidden; }), ids);
  const all = a => a.every(Boolean), none = a => a.every(v => !v);
  const before = await page.evaluate(() => Object.fromEntries(["frameStyle", "frameShape", "mdOn", "hudOn", "statusOn", "graph", "xfade"].map(id => { const el = document.getElementById(id); return [id, el.type === "checkbox" ? el.checked : el.value]; })));

  await put("frameStyle", "off");
  check("border off: only the style and the zoom are left", none(await on(["frameShape", "fx", "frameX", "frameY"])) && all(await on(["frameStyle", "zoom"])));
  await put("frameShape", "rect"); await put("frameStyle", "solid");
  check("rectangle: no sparks option (they come from the oval or blob)", none(await on(["fx"])) && all(await on(["frameShape", "frameX", "frameY"])));
  await put("frameStyle", "solid"); await put("frameShape", "oval");
  check("oval: the sparks option appears", all(await on(["fx"])));

  await put("mdOn", false);
  check("MilkDrop off: its preset and blend controls are hidden", none(await on(["preset", "rand", "lock", "starOnly", "starList", "cycle", "op", "blend"])) && all(await on(["mdOn"])));
  await put("mdOn", true);
  check("MilkDrop on: they are back", all(await on(["preset", "rand", "lock", "cycle", "op", "blend"])));

  await put("frameStyle", "off"); await put("hudOn", false); await put("statusOn", false);
  check("graph and status both off: no graph style, language or glow options", none(await on(["graph", "jp", "glow"])));
  await put("statusOn", true);
  check("status text on: the language option is back", all(await on(["jp"])) && none(await on(["graph"])));
  await put("hudOn", true);
  await put("xfade", 0);
  check("crossfade off: the loop crossfade option is hidden", none(await on(["xfadeLoop"])));
  await put("xfade", 1);
  check("crossfade on: it is back", all(await on(["xfadeLoop"])));

  for(const [id, v] of Object.entries(before)) await put(id, v);
}

/* ---------- Japanese text over the picture ---------- */
async function wordTests(page){
  section("Japanese text");
  await ensureClips(page);
  const put = (id, value) => page.evaluate(({id, value}) => { const el = document.getElementById(id);
    if(el.type === "checkbox") el.checked = value; else el.value = value; el.dispatchEvent(new Event(el.type === "range" ? "input" : "change")); }, {id, value});
  const wait = ms => page.waitForTimeout(ms);
  /* collect every label seen over a while, with the canvas size */
  const gather = ms => page.evaluate(ms => new Promise(res => { const seen = new Map(), t0 = performance.now(); let most = 0;
    const t = () => { const now = window.__scv.wordsState(); most = Math.max(most, now.length); for(const L of now) seen.set(L.txt + "@" + Math.round(L.x) + "," + Math.round(L.y), L);
      if(performance.now() - t0 < ms) requestAnimationFrame(t); else { const c = document.getElementById("hud"); res({items: Array.from(seen.values()), most, W: c.width, H: c.height}); } }; t(); }), ms);
  const JP = /[\u3040-\u30ff\u4e00-\u9fff]/, NOTE = /^[ハニホヘトイロ]#?-\d$/;

  await put("wordsOn", false); await wait(100);               // off while the layout changes, so no label is left from the old one
  await put("statusOn", true); await put("hudOn", true); await put("graph", "bars");
  await put("frameShape", "rect"); await put("frameStyle", "solid"); await put("frameX", 8); await put("frameY", 10);
  await put("wordsKind", "both"); await put("wordsAmount", 3); await put("wordsSize", 15); await put("wordsOn", true);
  let g = await gather(4000);
  const bx = g.W * 0.08, by = g.H * 0.10;
  check("labels appear with the kicks", g.items.length >= 8 && g.most >= 3, g.items.length + " labels in 4 s, up to " + g.most + " on screen");
  check("every label is Japanese text", g.items.every(L => JP.test(L.txt)), g.items.slice(0, 6).map(L => L.txt).join("  "));
  check("both kinds show: note names and words", g.items.some(L => NOTE.test(L.txt)) && g.items.some(L => !NOTE.test(L.txt)));
  const out = g.items.find(L => !(L.x >= bx && L.x + L.w <= g.W - bx && L.y >= by && L.y + L.h <= g.H * 0.62));
  check("all inside the border, above the graph", !out, out ? out.txt + " at " + Math.round(out.x) + "," + Math.round(out.y) + " size " + Math.round(out.w) + "x" + Math.round(out.h) + "; border " + Math.round(bx) + "," + Math.round(by) + "; look " + JSON.stringify(await page.evaluate(() => { const L = window.__scv.lookState(); return [L.x, L.y, L.sq, L.graph]; })) : "");
  const ls = await page.evaluate(() => parseFloat(document.getElementById("labelSize").value));
  check("none over the status text", g.items.every(L => !(L.x < bx + 612 * ls && L.y < by + 184 * ls)), "status block is the top left " + Math.round(612 * ls) + " x " + Math.round(184 * ls) + " at label size " + Math.round(ls * 100) + "%");
  /* the label size slider scales the status block */
  const statusWidth = () => page.evaluate(() => { const c = document.getElementById("hud"), g2 = c.getContext("2d"), y = Math.round(c.height * 0.10) + 40, d = g2.getImageData(0, y, c.width, 1).data; let last = 0; for(let x = 0; x < c.width; x++) if(d[x*4+3] > 0) last = x; return last; });
  await put("wordsOn", false); await wait(250);
  await put("labelSize", 0.5); await wait(150); const small = await statusWidth();
  await put("labelSize", 1.5); await wait(150); const big = await statusWidth();
  check("the label size slider shrinks and grows the status text", big > small * 1.5, "status block reaches " + small + " px across at 50% and " + big + " px at 150%");
  await put("labelSize", ls); await put("wordsOn", true);
  await page.mouse.move(40, 300); await wait(3600);
  await page.screenshot({path: path.join(outDir, "verify-words.png")});

  await put("wordsKind", "notes"); await wait(4200);          // let the earlier labels fade out first
  g = await gather(2500);
  check("\"note names\" shows only note names, in イロハ", g.items.length >= 2 && g.items.every(L => NOTE.test(L.txt)), g.items.slice(0, 6).map(L => L.txt).join("  "));
  await put("wordsKind", "words"); await wait(4200);
  g = await gather(2500);
  check("\"words\" shows no note names", g.items.length >= 2 && g.items.every(L => !NOTE.test(L.txt)), g.items.slice(0, 6).map(L => L.txt).join("  "));

  await put("wordsKind", "both"); await put("frameShape", "oval"); await put("statusOn", false); await wait(4200);
  g = await gather(3000);
  const rx = g.W / 2 - bx, ry = g.H / 2 - by;
  check("on an oval, every label is inside the oval", g.items.length >= 4 && g.items.every(L => [[L.x, L.y], [L.x + L.w, L.y], [L.x, L.y + L.h], [L.x + L.w, L.y + L.h]].every(([x, y]) => Math.pow((x - g.W / 2) / rx, 2) + Math.pow((y - g.H / 2) / ry, 2) < 1)), g.items.length + " labels");
  await page.screenshot({path: path.join(outDir, "verify-words-oval.png")});

  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("j"); await wait(200);
  check("J turns it off and clears the screen", (await page.evaluate(() => window.__scv.wordsState().length)) === 0 && !(await page.evaluate(() => document.getElementById("wordsOn").checked)));
  g = await gather(1500);
  check("and nothing appears while it is off", g.items.length === 0);
  await put("wordsOn", true); await put("frameShape", "rect"); await put("frameStyle", "off"); await put("statusOn", true); await put("wordsAmount", 2);
}

/* ---------- show mode ---------- */
async function showTests(page){
  section("show mode");
  await ensureClips(page);
  const put = (id, value) => page.evaluate(({id, value}) => { const el = document.getElementById(id);
    if(el.type === "checkbox") el.checked = value; else el.value = value; el.dispatchEvent(new Event(el.type === "range" ? "input" : "change")); }, {id, value});
  const wait = ms => page.waitForTimeout(ms);
  const look = () => page.evaluate(() => window.__scv.lookState());
  /* jump to a point in the show and let the picture settle there at once */
  const settle = async sec => { await page.evaluate(sec => { window.__scv.showSeek(sec); window.__scv.snapLook(); }, sec); await wait(120); return look(); };
  /* follow the look frame by frame for a while */
  const follow = ms => page.evaluate(ms => new Promise(res => { const rows = [], t0 = performance.now();
    const t = () => { const L = window.__scv.lookState(); rows.push([L.sq, L.y, L.graph]); if(performance.now() - t0 < ms) requestAnimationFrame(t); else res(rows); }; t(); }), ms);
  const LEN = 10;

  /* your own settings, which the show must leave alone */
  await put("wordsOn", false);
  await put("frameShape", "rect"); await put("frameStyle", "bars"); await put("frameX", 6); await put("frameY", 6);
  await put("zoom", 1.3); await put("hudOn", true); await put("graph", "bars");
  await put("showLen", LEN); await put("showOn", true);
  const SHOW = await page.evaluate(() => JSON.parse(JSON.stringify(window.__scv.SHOW)));

  /* every scene, sampled at its middle */
  let t = 0; const seen = [];
  for(const s of SHOW.scenes){ seen.push({s, L: await settle(t + s.length * LEN / 2)}); t += s.length * LEN; }
  const total = t;
  const fits = ({s, L}) => L.on === 1 && L.x === s.x && L.y === s.y && L.sq === (s.shape === "rect" ? 1 : 0) && L.blob === (s.shape === "blob" ? 1 : 0) && L.bars === (s.style === "bars" ? 1 : 0) && L.pulse === (s.style === "pulse" ? 1 : 0);
  check("the show reaches every scene in its table, with that scene's shape, style and widths", seen.every(fits), seen.length + " scenes; one loop is " + total + " s at " + LEN + " s a scene");
  const has = (shape, style, x, y) => SHOW.scenes.some(s => s.shape === shape && s.style === style && s.x === x && s.y === y);
  check("rectangle: solid only, 14% left and right, 15% top and bottom", has("rect", "solid", 14, 15) && !SHOW.scenes.some(s => s.shape === "rect" && s.style !== "solid"));
  check("oval: solid, bars and pulse, 14% left and right, 10% top and bottom", ["solid", "bars", "pulse"].every(st => has("oval", st, 14, 10)));
  const blobs = SHOW.scenes.filter(s => s.shape === "blob");
  check("blob: 19% left and right, 18% top and bottom", blobs.length > 0 && blobs.every(s => s.x === 19 && s.y === 18), blobs.map(s => s.style).join(", "));
  check("video zoom is 100% all through the show", seen.every(({L}) => L.zoom === 1));

  /* the graph schedule, read off the show's own clock in quarter-second steps */
  const plan = await page.evaluate(({total, morph}) => {
    const rows = []; for(let t = 0; t < total; t += 0.25){ const a = window.__scv.showAt(t); rows.push({i: a.index, shape: a.scene.shape, g: a.graph, st: a.gstyle}); }
    let clear = true; rows.forEach((r, k) => { const first = k === 0 || rows[k-1].i !== r.i; if(first) for(let j = k; j < rows.length && j < k + morph * 4; j++) if(rows[j].g) clear = false; });
    return {rows, clear};
  }, {total, morph: SHOW.morph});
  const ups = {};
  plan.rows.forEach((p, k) => { if(p.g && !(k && plan.rows[k-1].g)){ const key = p.shape + " " + (p.shape === "rect" ? p.st : "curve"); ups[key] = (ups[key] || 0) + 1; } });
  const rectRows = plan.rows.filter(r => r.i === 0), mid = Math.floor(rectRows.length / 2);
  check("the rectangle has two graphs, half its time each: LED bars, then the curve", rectRows.slice(0, mid - 1).every(r => r.st === "bars") && rectRows.slice(mid + 1).every(r => r.st === "curve"), "bars for " + (rectRows.filter(r => r.st === "bars").length * 0.25) + " s, curve for " + (rectRows.filter(r => r.st === "curve").length * 0.25) + " s");
  const swaps = plan.rows.filter((r, k) => r.st !== plan.rows[(k + plan.rows.length - 1) % plan.rows.length].st).length;
  check("on the oval and the blob the curve runs the whole way through, with no changes", plan.rows.filter(r => r.i > 0).every(r => r.st === "curve" && r.g === 1) && swaps === 2, swaps + " graph changes in a whole loop: bars to curve, and back to bars when the loop restarts");
  /* how long the graph is ever asked to be away, anywhere in the loop (the end of the loop runs into its start) */
  let longest = 0, run = 0;
  for(const r of plan.rows.concat(plan.rows)){ run = r.g ? 0 : run + 1; if(run > longest) longest = run; }
  const upShare = plan.rows.filter(r => r.g).length / plan.rows.length;
  check("the show never asks for the graph to be away", longest === 0 && upShare === 1);
  check("the graph stays up while the border changes", plan.rows.some((r, k) => k > 0 && plan.rows[k-1].i !== r.i && r.g === 1));

  /* one border turning into the next: the end of the rectangle scene into the oval */
  const first = SHOW.scenes[0].length * LEN;
  await settle(first - 0.3);
  const rows = await follow(3800);
  const sq = rows.map(r => r[0]), ys = rows.map(r => r[1]);
  const between = sq.filter(v => v > 0.05 && v < 0.95).length, step = Math.max(...sq.map((v, k) => k ? Math.abs(v - sq[k-1]) : 0));
  check("a border turns into the next gradually: the rectangle rounds off into the oval", between >= 20 && step < 0.12 && sq.every((v, k) => !k || v <= sq[k-1] + 1e-9) && sq[sq.length - 1] < 0.1, between + " in-between frames, biggest step " + step.toFixed(3));
  check("and the widths glide with it", ys.filter(v => v > 10.3 && v < 14.7).length >= 10 && ys[ys.length - 1] < 10.6, "top and bottom from 15% to " + ys[ys.length - 1].toFixed(1) + "%");
  await settle(first - 0.3); await wait(1150);
  await page.screenshot({path: path.join(outDir, "verify-show-morph.png")});
  await wait(1600);
  const after = await look();
  check("the curve is already up on the oval a few seconds into the change", after.graph > 0.9 && after.sq < 0.2, "graph " + after.graph.toFixed(2) + " with the picture " + Math.round((1 - after.sq) * 100) + "% rounded");
  /* across a change of border style on the oval (solid to bars), and from the oval to the blob, the curve must not dip */
  const stay = [];
  for(const at of [first + LEN, first + 3 * LEN]){ await settle(at - 0.5); stay.push(Math.min(...(await follow(2200)).map(r => r[2]))); }
  check("the curve does not dip when the oval changes style or turns into the blob", stay.every(v => v > 0.97), "lowest it got: " + stay.map(v => v.toFixed(2)).join(" and "));

  /* the graph fading in: first slot of the rectangle scene, LED bars */
  const upAt = style => plan.rows.findIndex(r => r.i === 0 && r.g && r.st === style) * 0.25;     // when that graph first comes up, from the schedule
  const want = SHOW.scenes[0].graphs;
  await settle(upAt(want[1]) - 1.6);                       // just before LED bars hand over to the curve
  const g = (await follow(3200)).map(r => r[2]);
  const low = g.filter(v => v < 0.1).length, firstLow = g.findIndex(v => v < 0.5), lastLow = g.length - 1 - g.slice().reverse().findIndex(v => v < 0.5);
  check("one graph hands over to the next in about a second", g[0] > 0.9 && low >= 3 && low <= 75 && g[g.length - 1] > 0.9, "under 10% for " + low + " frames (about " + (low / 60).toFixed(1) + " s), half-down to half-up in " + ((lastLow - firstLow) / 60).toFixed(1) + " s");
  const up = g.slice(g.indexOf(Math.min(...g)));           // from the bottom of the dip onward
  check("and it fades rather than popping", up.filter(v => v > 0.05 && v < 0.95).length >= 8 && Math.max(...g.map((v, k) => k ? Math.abs(v - g[k-1]) : 0)) < 0.25, up.filter(v => v > 0.05 && v < 0.95).length + " in-between frames on the way back up");
  const a = await settle(upAt(want[0]) + 0.6), b = await settle(upAt(want[1]) + 0.6);
  check("the rectangle shows LED bars, then the spectrum curve", a.graph === 1 && a.gstyle === SHOW.scenes[0].graphs[0] && b.graph === 1 && b.gstyle === SHOW.scenes[0].graphs[1], a.gstyle + " then " + b.gstyle);

  /* controls */
  const shown = ids => page.evaluate(ids => ids.map(id => { const el = document.getElementById(id); return !(el.closest("label") || el.closest(".row") || el).hidden; }), ids);
  check("while the show runs, the controls it has taken over are hidden", (await shown(["frameStyle", "frameShape", "frameX", "frameY", "zoom", "hudOn", "graph"])).every(v => !v) && (await shown(["showOn", "showLen", "fx", "glow"])).every(Boolean));

  await put("showOn", false); await wait(150);
  const back = await look();
  check("turning the show off puts your own border, graph and zoom straight back", back.x === 6 && back.y === 6 && back.sq === 1 && back.bars === 1 && back.zoom === 1.3 && back.graph === 1, "border " + back.x + "%/" + back.y + "%, zoom " + back.zoom);
  check("and your controls return, with the scene length hidden", (await shown(["frameStyle", "frameShape", "zoom", "hudOn"])).every(Boolean) && (await shown(["showLen"])).every(v => !v));

  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("x"); await wait(120);
  const onNow = await page.evaluate(() => document.getElementById("showOn").checked);
  await page.keyboard.press("x"); await wait(120);
  check("X turns the show on and off", onNow === true && !(await page.evaluate(() => document.getElementById("showOn").checked)));

  await put("frameStyle", "off"); await put("zoom", 1); await put("showLen", 30); await put("wordsOn", true);
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

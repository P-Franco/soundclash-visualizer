#!/usr/bin/env node
/* Smoke test for the built file.

   Loads dist/soundclash-visualizer.html from file:// in headless Chrome or Edge, with a fake audio
   input that plays the synthesized drum loop (tools/make-drum-loop.js). Clicks Start, watches the
   console, takes one screenshot, and compares the hit counts in window.__scv.DET with what the loop
   actually contains.

   usage: node tools/verify.js [--file=path.html] [--browser=chrome|msedge|bundled|path.exe]
                               [--seconds=8] [--md] [--headed] [--size=1280x720]

   --md leaves the MilkDrop layer on while measuring. Headless Chrome without a GPU renders that
   layer at a few frames per second, which starves the main thread, so it is off by default here.

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
const WARMUP_MS = 2500, WINDOW_MS = (Number(args.seconds) || drum.PATTERN.loopSec) * 1000;

const results = [];
const check = (name, ok, detail) => { results.push({name, ok, detail}); console.log((ok ? "  ok    " : "  FAIL  ") + name + (detail ? "  (" + detail + ")" : "")); };

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
  page.on("request", r => { if(!/^(file|blob|data|about):/i.test(r.url())) external.push(r.url()); });

  await page.goto(pathToFileURL(file).href);
  if(!args.md) await page.evaluate(() => { const el = document.getElementById("mdOn"); el.checked = false; el.dispatchEvent(new Event("change")); });

  console.log("\nstart");
  await page.click("#goMic");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("start")).display === "none" || document.getElementById("err").textContent, null, {timeout: 15000});
  const err = await page.evaluate(() => document.getElementById("err").textContent);
  check("Start with audio input opens the show", !err, err || "");
  if(err){ await browser.close(); return finish(errors, external); }

  /* hit counts over one window, timed inside the page */
  await page.waitForTimeout(WARMUP_MS);
  const m = await page.evaluate(ms => new Promise(res => {
    const D = window.__scv.DET, a = D.map(d => d.count), t = performance.now(); let frames = 0, on = true;
    const tick = () => { if(on){ frames++; requestAnimationFrame(tick); } }; requestAnimationFrame(tick);
    setTimeout(() => { on = false; const el = performance.now() - t;
      res({names: D.map(d => d.en), counts: D.map((d, i) => d.count - a[i]), elapsed: el, fps: frames / el * 1000, mode: window.__scv.detMode || "interval"}); }, ms);
  }), WINDOW_MS);

  const gpu = await page.evaluate(() => { try{ const gl = document.createElement("canvas").getContext("webgl2"), x = gl.getExtension("WEBGL_debug_renderer_info"); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : "unknown"; }catch(e){ return "no WebGL 2"; } });
  console.log("\nWebGL renderer: " + gpu);
  console.log("hit detection over " + (m.elapsed / 1000).toFixed(2) + " s, MilkDrop " + (args.md ? "on" : "off") + ", detector: " + m.mode + ", " + m.fps.toFixed(0) + " frames per second");
  m.names.forEach((n, i) => {
    const per = drum.PATTERN[n.toLowerCase()];
    if(per === undefined) return;
    const want = per * m.elapsed / (drum.PATTERN.loopSec * 1000), tol = 1 + want * 0.05;
    check(n.padEnd(5) + " counted " + String(m.counts[i]).padStart(3) + ", loop contains " + want.toFixed(1), Math.abs(m.counts[i] - want) <= tol);
  });

  const shot = path.join(outDir, "verify.png");
  await page.screenshot({path: shot});
  console.log("\nscreenshot: " + shot);

  await hotkeys(page);

  const keys = await page.evaluate(() => Object.keys(localStorage));
  console.log("");
  check("settings are saved under the scv_ prefix", keys.length > 0 && keys.every(k => k.startsWith("scv_")), keys.length + " keys");

  await browser.close();
  finish(errors, external, m);
}

/* Every hotkey must keep working: F H N V S G M Space. */
async function hotkeys(page){
  console.log("\nhotkeys");
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
  console.log("");
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("no network requests", external.length === 0, external.slice(0, 3).join(" | "));
  if(m) console.log("\nRESULT " + JSON.stringify({counts: Object.fromEntries(m.names.map((n, i) => [n, m.counts[i]])), seconds: +(m.elapsed / 1000).toFixed(2), fps: +m.fps.toFixed(1), mode: m.mode}));
  const bad = results.filter(r => !r.ok).length;
  console.log(bad ? "\n" + bad + " check(s) failed" : "\nall checks passed");
  process.exitCode = bad ? 1 : 0;
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; });

#!/usr/bin/env node
/* Offline test of the hit detection math in src/js/detect-core.js. No browser needed.
   Checks the FFT against a plain DFT, then runs the detector over the synthesized drum loop
   the same way the AudioWorklet does (128-sample blocks) and compares the hit counts.

   usage: node tools/test-detect.js                                                           */
const path = require("path");
const esbuild = require("esbuild");
const drum = require("./make-drum-loop.js");

/* the core is an ES module; bundle it to CommonJS in memory so this runs on any Node version */
const code = esbuild.buildSync({entryPoints: [path.join(__dirname, "..", "src", "js", "detect-core.js")], bundle: true, format: "cjs", write: false}).outputFiles[0].text;
const mod = {exports: {}}; new Function("module", "exports", code)(mod, mod.exports);
const { HitEngine, ZoneDetector, makeFft, FFT_SIZE, HOP } = mod.exports;

let failed = 0;
const check = (name, ok, detail) => { if(!ok) failed++; console.log((ok ? "  ok    " : "  FAIL  ") + name + (detail ? "  (" + detail + ")" : "")); };

const ZONES = [
  {id: "kick", lo: 40, hi: 120, cool: 150},
  {id: "snare", lo: 1800, hi: 5000, cool: 130},
  {id: "hat", lo: 7000, hi: 14000, cool: 70},
];

/* 1. FFT against a direct DFT */
{
  const n = 256, fft = makeFft(n), re = new Float32Array(n), im = new Float32Array(n), x = new Float32Array(n);
  for(let i = 0; i < n; i++) x[i] = Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.91) + ((i * 7919) % 13) / 13 - 0.5;
  re.set(x); fft(re, im);
  let worst = 0;
  for(let k = 0; k < n; k++){
    let a = 0, b = 0;
    for(let i = 0; i < n; i++){ a += x[i] * Math.cos(2 * Math.PI * k * i / n); b -= x[i] * Math.sin(2 * Math.PI * k * i / n); }
    worst = Math.max(worst, Math.abs(a - re[k]), Math.abs(b - im[k]));
  }
  check("FFT matches a direct DFT", worst < 1e-3, "worst error " + worst.toExponential(1));
}

/* 2. the drum loop, three passes, counting the last two */
function run(sampleRate, gain){
  const loop = drum.render(), eng = new HitEngine(sampleRate);
  eng.setZones(ZONES); eng.setSens(0.6);
  const counts = [0, 0, 0], block = new Float32Array(128); let pos = 0, total = 0;
  const from = loop.length, to = loop.length * 3;
  const onHop = (n, fired) => { if(total >= from) for(let j = 0; j < n; j++) counts[fired[j]]++; };
  while(total < to){
    for(let i = 0; i < 128; i++){ block[i] = loop[pos] * gain; pos = (pos + 1) % loop.length; }
    eng.feed(block, 128, onHop); total += 128;
  }
  return counts;
}
{
  const want = [drum.PATTERN.kick * 2, drum.PATTERN.snare * 2, drum.PATTERN.hat * 2];
  const got = run(drum.SAMPLE_RATE, 1.5);
  ["KICK", "SNARE", "HAT"].forEach((n, i) => check(n.padEnd(5) + " counted " + got[i] + " over two loops, loop contains " + want[i], got[i] === want[i]));
  const quiet = run(drum.SAMPLE_RATE, 0.0005);
  check("nothing fires on a near-silent input", quiet.every(c => c === 0), quiet.join("/"));
}

/* 3. zone handling */
{
  const zd = new ZoneDetector(48000);
  zd.setZones([{id: "thin", lo: 50, hi: 60, cool: 100}, {id: "top", lo: 15000, hi: 20000, cool: 100}]);
  check("a zone narrower than one bin still gets a bin", zd.zones[0].k0 === zd.zones[0].k1 && zd.zones[0].k0 >= 1, "bin " + zd.zones[0].k0);
  check("a zone above 14 kHz is analysed", zd.zones[1].k1 > zd.zones[1].k0 && zd.zones[1].k1 <= FFT_SIZE / 2 - 1, "bins " + zd.zones[1].k0 + " to " + zd.zones[1].k1);
  zd.zones[0].avg = 0.5; zd.zones[1].avg = 0.25;
  zd.setZones([{id: "thin", lo: 50, hi: 900, cool: 100}, {id: "top", lo: 15000, hi: 20000, cool: 100}]);
  check("a zone that moved starts with a fresh average", zd.zones[0].avg === 0);
  check("a zone that did not move keeps its average", zd.zones[1].avg === 0.25);
}

console.log("hop " + HOP + " samples, window " + FFT_SIZE);
console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
process.exitCode = failed ? 1 : 0;

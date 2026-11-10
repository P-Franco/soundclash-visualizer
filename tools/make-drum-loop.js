#!/usr/bin/env node
/* Synthesizes the drum loop used by tools/verify.js and writes it as a WAV file.
   The output is generated on demand and is never committed (see .gitignore).

   Pattern: 120 BPM, 4 bars of 4/4 = 8 seconds, seamless when looped.
     kick   on every beat            16 per loop   sine sweep 130 -> 48 Hz
     snare  on beats 2 and 4          8 per loop   band-passed noise + 185 Hz body
     hat    on every 8th note        32 per loop   high-passed noise above 7 kHz
     bass   off-beat 8ths, soft attack              sits in the kick zone on purpose, as a distractor

   usage: node tools/make-drum-loop.js [out.wav]                                                */
const fs = require("fs");
const path = require("path");

const SR = 48000, BPM = 120, BARS = 4;
const BEAT = 60 / BPM, LOOP_SEC = BARS * 4 * BEAT, LEN = Math.round(LOOP_SEC * SR);

/* What one pass of the loop contains. verify.js compares hit counts against this. */
const PATTERN = { bpm: BPM, loopSec: LOOP_SEC, kick: BARS * 4, snare: BARS * 2, hat: BARS * 8 };

/* small deterministic PRNG so every run writes the same file */
function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* RBJ biquad, applied in place */
function biquad(buf, type, f, q){
  const w = 2 * Math.PI * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2; const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  if(type === "highpass"){ b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else if(type === "lowpass"){ b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else { b0 = al; b1 = 0; b2 = -al; }                       // bandpass, 0 dB peak
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for(let i = 0; i < buf.length; i++){
    const x = buf[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y; buf[i] = y;
  }
  return buf;
}

function noise(seconds, seed){
  const r = mulberry32(seed), n = new Float32Array(Math.round(seconds * SR));
  for(let i = 0; i < n.length; i++) n[i] = r() * 2 - 1;
  return n;
}

function kick(){
  const n = new Float32Array(Math.round(0.34 * SR)); let ph = 0;
  for(let i = 0; i < n.length; i++){
    const t = i / SR, f = 48 + 82 * Math.exp(-t / 0.035);
    ph += 2 * Math.PI * f / SR;
    n[i] = Math.sin(ph) * Math.min(1, t / 0.003) * Math.exp(-t / 0.11) * 0.85;
  }
  return n;
}
function snare(seed){
  const n = biquad(biquad(noise(0.22, seed), "highpass", 1500, 0.7), "lowpass", 6000, 0.7);
  for(let i = 0; i < n.length; i++){
    const t = i / SR;
    n[i] = n[i] * Math.min(1, t / 0.001) * Math.exp(-t / 0.05) * 0.5 + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.04) * 0.25;
  }
  return n;
}
function hat(seed){
  const n = biquad(biquad(noise(0.09, seed), "highpass", 8000, 0.8), "highpass", 8000, 0.8);
  for(let i = 0; i < n.length; i++){ const t = i / SR; n[i] *= Math.min(1, t / 0.0008) * Math.exp(-t / 0.018) * 0.3; }
  return n;
}
function bass(freq, seconds){
  const n = new Float32Array(Math.round(seconds * SR));
  for(let i = 0; i < n.length; i++){
    const t = i / SR, env = Math.min(1, t / 0.03) * Math.min(1, (seconds - t) / 0.03);
    n[i] = (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(4 * Math.PI * freq * t)) * env * 0.16;
  }
  return n;
}

function render(){
  const mix = new Float32Array(LEN);
  const add = (buf, at) => { const o = Math.round(at * SR); for(let i = 0; i < buf.length; i++) mix[(o + i) % LEN] += buf[i]; };   // tails wrap, so the loop is seamless
  const K = kick();
  const bassLine = [55, 55, 65.41, 49, 55, 55, 73.42, 65.41];                 // A1 A1 C2 G1 A1 A1 D2 C2, one note per beat
  for(let beat = 0; beat < BARS * 4; beat++){
    const t = beat * BEAT;
    add(K, t);
    if(beat % 4 === 1 || beat % 4 === 3) add(snare(1000 + beat), t);
    add(hat(2000 + beat * 2), t);
    add(hat(2001 + beat * 2), t + BEAT / 2);
    add(bass(bassLine[beat % bassLine.length], BEAT / 2 - 0.02), t + BEAT / 2);
  }
  let peak = 0; for(let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const g = peak > 0.89 ? 0.89 / peak : 1;                                    // leave headroom, never clip
  for(let i = 0; i < LEN; i++) mix[i] *= g;
  return mix;
}

function writeWav(file, mono){
  const ch = 2, bytes = mono.length * ch * 2, b = Buffer.alloc(44 + bytes);
  b.write("RIFF", 0); b.writeUInt32LE(36 + bytes, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(bytes, 40);
  for(let i = 0; i < mono.length; i++){
    const v = Math.max(-32768, Math.min(32767, Math.round(mono[i] * 32767)));
    b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4);
  }
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, b);
}

const DEFAULT_OUT = path.join(__dirname, "..", "test-output", "drum-loop.wav");
function generate(file = DEFAULT_OUT){ writeWav(file, render()); return file; }

module.exports = { generate, render, PATTERN, DEFAULT_OUT, SAMPLE_RATE: SR };

if(require.main === module){
  const out = generate(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT);
  console.log("wrote " + out);
  console.log("one loop = " + LOOP_SEC + " s at " + BPM + " BPM: " + PATTERN.kick + " kicks, " + PATTERN.snare + " snares, " + PATTERN.hat + " hats");
}

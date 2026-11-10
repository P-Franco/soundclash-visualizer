/* Hit detectors: the zone list, and the detector that runs over it.

   Zones are frequency ranges, not real instrument recognition: anything loud and sudden in
   40 to 120 Hz counts as a "kick". The math is in detect-core.js.

   Detection runs in an AudioWorklet (detect.worklet.js) so slow frames cannot starve it. If the
   browser has no AudioWorklet, the same math runs on a 12 ms timer on the main thread instead. */
import { S } from "./state.js";
import { store } from "./store.js";
import { ZoneDetector, FFT_SIZE } from "./detect-core.js";
import workletSrc from "./detect.worklet.js";      // a string: the build bundles the worklet to text

const BUILTIN = [
  {id:"kick",  en:"KICK",  jp:"キック", lo:40,   hi:120,   cool:150},
  {id:"snare", en:"SNARE", jp:"スネア", lo:1800, hi:5000,  cool:130},
  {id:"hat",   en:"HAT",   jp:"ハット", lo:7000, hi:14000, cool:70},
];
export const MAX_ZONES = 8, HZ_MIN = 20, HZ_MAX = 20000;

/* The live zone list. Always the same array (edited in place); the kick zone is always DET[0].
   Each entry: {id, en, jp, lo, hi, cool, custom, env, flux, count, last}. */
export const DET = [];
export let detMode = "off";                        // "worklet" | "interval" once running
export let detVia = "";                            // how the worklet was loaded: "blob" | "data"
export let detError = "";                          // why the worklet was not used, when it was not

const MIN_WIDTH = 10;                              // Hz
const clampHz = v => Math.max(HZ_MIN, Math.min(HZ_MAX, Math.round(Number(v)) || 0));
/* Keep lo and hi inside the limits and at least MIN_WIDTH apart. The value the user just typed
   (edited: "lo" or "hi") wins and the other end moves out of its way. */
function fixRange(lo, hi, edited){
  lo = clampHz(lo); hi = clampHz(hi);
  if(hi - lo < MIN_WIDTH){
    if(edited === "hi"){ hi = Math.max(hi, HZ_MIN + MIN_WIDTH); lo = hi - MIN_WIDTH; }
    else { lo = Math.min(lo, HZ_MAX - MIN_WIDTH); hi = lo + MIN_WIDTH; }
  }
  return {lo, hi};
}
const fixName = (s, fallback) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 6).toUpperCase() || fallback;
/* minimum gap between hits for a custom zone: low zones ring longer, so they wait longer */
const coolFor = (lo, hi) => { const c = Math.sqrt(lo * hi); return c < 300 ? 150 : c > 6000 ? 70 : 130; };
const makeZone = z => ({...z, env: 0, flux: 0, count: 0, last: 0});

function loadZones(){
  let saved = [];
  try{ const v = JSON.parse(store.get("zones", "[]")); if(Array.isArray(v)) saved = v.filter(z => z && typeof z.id === "string"); }catch(e){}
  DET.length = 0;
  for(const b of BUILTIN){
    const s = saved.find(z => z.id === b.id);
    DET.push(makeZone({...b, ...(s ? fixRange(s.lo, s.hi) : {}), custom: false}));
  }
  for(const s of saved){
    if(BUILTIN.some(b => b.id === s.id) || DET.some(d => d.id === s.id) || DET.length >= MAX_ZONES) continue;
    const r = fixRange(s.lo, s.hi), name = fixName(s.name, "ZONE");
    DET.push(makeZone({id: s.id, en: name, jp: name, ...r, cool: coolFor(r.lo, r.hi), custom: true}));
  }
}
function saveZones(){
  store.set("zones", JSON.stringify(DET.map(d => d.custom ? {id: d.id, name: d.en, lo: d.lo, hi: d.hi} : {id: d.id, lo: d.lo, hi: d.hi})));
}
loadZones();

/* ---------- editing ---------- */
export function setZoneRange(id, lo, hi, edited){
  const d = DET.find(z => z.id === id); if(!d) return null;
  const r = fixRange(lo, hi, edited); d.lo = r.lo; d.hi = r.hi;
  if(d.custom) d.cool = coolFor(d.lo, d.hi);
  saveZones(); syncZones();
  return r;
}
export function renameZone(id, name){
  const d = DET.find(z => z.id === id); if(!d || !d.custom) return d ? d.en : "";
  d.en = d.jp = fixName(name, d.en);
  saveZones();
  return d.en;
}
export function addZone(){
  if(DET.length >= MAX_ZONES) return null;
  let n = 1; while(DET.some(d => d.en === "Z" + n)) n++;
  const d = makeZone({id: "z" + Date.now().toString(36) + n, en: "Z" + n, jp: "Z" + n, lo: 200, hi: 800, cool: coolFor(200, 800), custom: true});
  DET.push(d); saveZones(); syncZones();
  return d;
}
export function removeZone(id){
  const i = DET.findIndex(z => z.id === id); if(i < 0 || !DET[i].custom) return;
  DET.splice(i, 1); saveZones(); syncZones();
}
export function resetZones(){
  DET.length = 0;
  for(const b of BUILTIN) DET.push(makeZone({...b, custom: false}));
  saveZones(); syncZones();
}

/* ---------- hits ---------- */
const hitFns = [];
/* fn(zone, index, ageSeconds) runs on the main thread for every hit. */
export function onHit(fn){ hitFns.push(fn); }

function fire(i, age){
  const d = DET[i]; if(!d) return;
  d.count++; d.last = performance.now() - age * 1000;
  /* a hit that sat in the queue during a stalled frame arrives late: show it already faded, not fresh */
  d.env = Math.max(d.env, age < 0.05 ? 1 : Math.exp(-age / 0.14));
  for(const fn of hitFns) fn(d, i, age);
}

/* ---------- detector ---------- */
let ctx = null, node = null, rev = 0;
let fast = null, zd = null, ff, mag, fired, lastD = 0;    // main-thread fallback only

const zoneConfig = () => DET.map(d => ({id: d.id, lo: d.lo, hi: d.hi, cool: d.cool}));

/* Send the zone list to the detector. Messages still in flight for the old list are dropped by rev. */
function syncZones(){
  rev++;
  if(node) node.port.postMessage({rev, zones: zoneConfig(), sens: S.sens});
  if(zd){ zd.setZones(zoneConfig()); zd.sens = S.sens; }
}
export function syncSens(){
  if(node) node.port.postMessage({sens: S.sens});
  if(zd) zd.sens = S.sens;
}

/* The worklet source is a string inside this file, so there is nothing to fetch and it works offline.
   A Blob URL is the usual way to load such a string, but Chrome and Edge refuse to load a worklet from
   a Blob URL when the page itself was opened from file:// (the blob belongs to an opaque origin the
   worklet may not read). A data: URL loads fine there, so file:// pages use that, and it is also the
   second try anywhere the Blob URL fails. Returns which one worked. */
async function loadWorklet(ctx){
  const dataUrl = () => "data:text/javascript;charset=utf-8," + encodeURIComponent(workletSrc);
  if(location.protocol !== "file:"){
    const url = URL.createObjectURL(new Blob([workletSrc], {type: "text/javascript"}));
    try{ await ctx.audioWorklet.addModule(url); return "blob"; }
    catch(e){ /* fall through to the data: URL */ }
    finally{ URL.revokeObjectURL(url); }
  }
  await ctx.audioWorklet.addModule(dataUrl());
  return "data";
}

export async function startDetector(audioCtx, gainNode){
  ctx = audioCtx;
  try{
    if(!ctx.audioWorklet || typeof AudioWorkletNode !== "function" || window.__scvNoWorklet) throw new Error("no AudioWorklet");
    detVia = await loadWorklet(ctx);
    /* input only: this node has no output and is never connected to the speakers */
    node = new AudioWorkletNode(ctx, "scv-hit-detector", {numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers"});
    node.port.onmessage = onWorkletMessage;
    gainNode.connect(node);
    detMode = "worklet";
  }catch(e){
    detError = String(e && e.message || e);
    node = null;
    fast = ctx.createAnalyser(); fast.fftSize = FFT_SIZE; fast.smoothingTimeConstant = 0;   // short window, used only for hit detection
    gainNode.connect(fast);
    zd = new ZoneDetector(ctx.sampleRate);
    ff = new Float32Array(fast.frequencyBinCount); mag = new Float32Array(fast.frequencyBinCount); fired = new Int32Array(64);
    setInterval(detectOnTimer, 12);
    detMode = "interval";
  }
  syncZones();
}

function onWorkletMessage(e){
  const m = e.data;
  if(m.rev !== rev) return;
  for(let i = 0; i < DET.length && i < m.flux.length; i++) DET[i].flux = m.flux[i];
  if(m.hits){ const age = Math.max(0, ctx.currentTime - m.time); for(const i of m.hits) fire(i, age); }
}

function detectOnTimer(){
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastD)/1000 || 0.012); lastD = now;
  fast.getFloatFrequencyData(ff);
  for(let k = 0; k < ff.length; k++) mag[k] = isFinite(ff[k]) ? Math.pow(10, ff[k]/20) : 0;
  const n = zd.step(mag, dt, S.level, now, fired);
  for(let i = 0; i < DET.length; i++) DET[i].flux = zd.zones[i].flux;
  for(let j = 0; j < n; j++) fire(fired[j], 0);
}

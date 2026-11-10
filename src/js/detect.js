/* Hit detectors: positive spectral change (flux) inside a frequency zone, compared with that zone's
   recent average and recent peak. These are frequency zones, not real instrument recognition:
   anything loud and sudden in 40 to 120 Hz counts as a "kick". */
import { S } from "./state.js";
import { ctx, fast } from "./audio.js";

export const DET = [
  {en:"KICK",  jp:"キック", lo:40,   hi:120,   cool:150},
  {en:"SNARE", jp:"スネア", lo:1800, hi:5000,  cool:130},
  {en:"HAT",   jp:"ハット", lo:7000, hi:14000, cool:70},
];
DET.forEach(d => { d.env = 0; d.avg = 0; d.peak = 0; d.last = 0; d.count = 0; d.flux = 0; });

let ff, prevMag, lastD = 0;

/* Runs on its own 12 ms timer (see main.js), separate from the frame loop. */
export function detect(){
  if(!fast) return;
  const now = performance.now();
  if(!ff){ ff = new Float32Array(fast.frequencyBinCount); prevMag = new Float32Array(fast.frequencyBinCount); }
  const dt = Math.min(0.1, (now - lastD)/1000 || 0.012); lastD = now;
  fast.getFloatFrequencyData(ff);
  const binHz = ctx.sampleRate / 2 / ff.length, kMax = Math.min(ff.length - 1, Math.ceil(14000/binHz));
  for(const d of DET){ d.flux = 0; d.n = 0; }
  for(let k=1;k<=kMax;k++){
    const m = isFinite(ff[k]) ? Math.pow(10, ff[k]/20) : 0, df = m - prevMag[k], f = k*binHz; prevMag[k] = m;
    for(const d of DET) if(f >= d.lo && f <= d.hi){ d.n++; if(df > 0) d.flux += df; }
  }
  const a = 1 - Math.exp(-dt/0.5), pk = Math.exp(-dt/2.5);
  for(const d of DET){
    if(d.n) d.flux /= d.n;
    const thr = Math.max(d.avg * (2.6 - 1.4*S.sens), d.peak * (0.75 - 0.6*S.sens));
    if(S.level > 0.001 && d.flux > 1e-7 && d.flux > thr && now - d.last > d.cool){ d.last = now; d.env = 1; d.count++; }
    d.avg += (d.flux - d.avg) * a;
    d.peak = Math.max(d.flux, d.peak * pk);
  }
}

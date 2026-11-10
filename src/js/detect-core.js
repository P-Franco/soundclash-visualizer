/* Hit detection math. Pure code with no DOM and no Web Audio, so the same file runs inside the
   AudioWorklet (detect.worklet.js), in the main-thread fallback (detect.js), and in Node tests.

   A zone fires when the positive spectral change (flux) inside its frequency range beats both the
   zone's running average and a fraction of its recent peak. */

export const FFT_SIZE = 2048;   // analysis window, same as the AnalyserNode this replaced
export const HOP = 512;         // samples between analyses: about 10.7 ms at 48 kHz

/* ---------- zones ---------- */
export class ZoneDetector {
  constructor(sampleRate){
    this.binHz = sampleRate / FFT_SIZE;
    this.nBins = FFT_SIZE / 2;
    this.prev = new Float32Array(this.nBins);
    this.rise = new Float32Array(this.nBins);
    this.zones = [];
    this.sens = 0.6;
  }

  /* list: [{id, lo, hi, cool}] with lo and hi in Hz and cool (minimum gap between hits) in ms.
     A zone whose range did not change keeps its running average and peak. A zone that moved starts
     fresh: its old numbers describe a different part of the spectrum and would block hits for seconds. */
  setZones(list){
    const old = new Map(this.zones.map(z => [z.id, z]));
    this.zones = list.map(c => {
      const top = this.nBins - 1;
      let k0 = Math.max(1, Math.ceil(c.lo / this.binHz)), k1 = Math.min(top, Math.floor(c.hi / this.binHz));
      if(k1 < k0) k0 = k1 = Math.max(1, Math.min(top, Math.round((c.lo + c.hi) / 2 / this.binHz)));   // narrower than one bin: use the nearest
      const o = old.get(c.id), keep = o && o.k0 === k0 && o.k1 === k1;
      return {id: c.id, cool: c.cool, k0, k1, avg: keep ? o.avg : 0, peak: keep ? o.peak : 0, last: o ? o.last : -1e9, flux: 0};
    });
  }

  /* mag[k] is the linear magnitude of bin k on the AnalyserNode scale (Blackman window, |X[k]| / FFT_SIZE).
     dt is seconds since the previous call, level the input RMS, nowMs any steady clock.
     Writes the indexes of the zones that fired into `fired` and returns how many there are. */
  step(mag, dt, level, nowMs, fired){
    const prev = this.prev, rise = this.rise;
    for(let k = 1; k < this.nBins; k++){ const df = mag[k] - prev[k]; rise[k] = df > 0 ? df : 0; prev[k] = mag[k]; }
    const a = 1 - Math.exp(-dt / 0.5), pk = Math.exp(-dt / 2.5), sens = this.sens;
    let n = 0;
    for(let i = 0; i < this.zones.length; i++){
      const z = this.zones[i]; let flux = 0;
      for(let k = z.k0; k <= z.k1; k++) flux += rise[k];
      flux /= (z.k1 - z.k0 + 1);
      z.flux = flux;
      const thr = Math.max(z.avg * (2.6 - 1.4 * sens), z.peak * (0.75 - 0.6 * sens));
      if(level > 0.001 && flux > 1e-7 && flux > thr && nowMs - z.last > z.cool){ z.last = nowMs; fired[n++] = i; }
      z.avg += (flux - z.avg) * a;
      z.peak = Math.max(flux, z.peak * pk);
    }
    return n;
  }
}

/* ---------- spectrum ---------- */
/* In-place radix-2 FFT for a fixed size (a power of two). */
export function makeFft(n){
  const bits = Math.round(Math.log2(n)), rev = new Uint32Array(n), cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for(let i = 0; i < n; i++){ let r = 0; for(let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for(let i = 0; i < n / 2; i++){ cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  return function fft(re, im){
    for(let i = 0; i < n; i++){ const j = rev[i]; if(j > i){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for(let size = 2; size <= n; size <<= 1){
      const half = size >> 1, stride = n / size;
      for(let i = 0; i < n; i += size){
        for(let j = 0, k = 0; j < half; j++, k += stride){
          const wr = cos[k], wi = -sin[k], p = i + j, q = p + half;
          const xr = re[q] * wr - im[q] * wi, xi = re[q] * wi + im[q] * wr;
          re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi;
        }
      }
    }
  };
}

/* The window AnalyserNode uses (Blackman, alpha 0.16). */
export function blackman(n){
  const w = new Float32Array(n);
  for(let i = 0; i < n; i++) w[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / n) + 0.08 * Math.cos(4 * Math.PI * i / n);
  return w;
}

/* ---------- sample stream in, hits out ---------- */
export class HitEngine {
  constructor(sampleRate){
    this.sampleRate = sampleRate;
    this.det = new ZoneDetector(sampleRate);
    this.ring = new Float32Array(FFT_SIZE); this.w = 0; this.since = 0; this.clock = 0;
    this.re = new Float32Array(FFT_SIZE); this.im = new Float32Array(FFT_SIZE); this.mag = new Float32Array(FFT_SIZE / 2);
    this.win = blackman(FFT_SIZE); this.fft = makeFft(FFT_SIZE);
    this.fired = new Int32Array(64);
    this.level = 0;
    this.hopSec = HOP / sampleRate;
    this.levelHold = Math.exp(-this.hopSec / 0.158);      // same decay as the on-screen level meter (x0.9 per frame at 60 fps)
  }
  setZones(list){ this.det.setZones(list); }
  setSens(v){ this.det.sens = v; }
  fluxes(){ return this.det.zones.map(z => z.flux); }

  /* Add n mono samples (block may be null for silence). Calls onHop(count, fired) after every analysis. */
  feed(block, n, onHop){
    const ring = this.ring, mask = FFT_SIZE - 1; let w = this.w, since = this.since;
    for(let i = 0; i < n; i++){
      ring[w] = block ? block[i] : 0; w = (w + 1) & mask;
      if(++since === HOP){ since = 0; this.w = w; this.clock += HOP; onHop(this.analyse(), this.fired); }
    }
    this.w = w; this.since = since;
  }

  analyse(){
    const N = FFT_SIZE, mask = N - 1, re = this.re, im = this.im, ring = this.ring, win = this.win, mag = this.mag, w = this.w;
    let sum = 0;
    for(let i = 0; i < N; i++){ const x = ring[(w + i) & mask]; sum += x * x; re[i] = x * win[i]; im[i] = 0; }   // oldest sample first
    this.fft(re, im);
    for(let k = 0; k < N / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
    this.level = Math.max(Math.sqrt(sum / N), this.level * this.levelHold);
    return this.det.step(mag, this.hopSec, this.level, this.clock / this.sampleRate * 1000, this.fired);
  }
}

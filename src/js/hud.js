/* Graph overlay: spectrum analysis and the 2D canvas drawing (status block, LED bars or spectrum curve).
   Performance notes: target is 60 fps at 1080p. Keep shadowBlur off for anything drawn per bar. */
import { hud } from "./dom.js";
import { S } from "./state.js";
import { ctx, analyser } from "./audio.js";
import { DET } from "./detect.js";
import { presetNames, presetIdx, isStarred } from "./presets.js";
import { clips, clipIdx, cutInfo } from "./clips.js";

const hctx = hud.getContext("2d");

/* ---------- spectrum readout ---------- */
const N = 200, F0 = 40, F1 = 14000, DBMIN = -96, DBMAX = -22;
const cur = new Float32Array(N), raw = new Float32Array(N), hist = [];
export const NB = 56, barV = new Float32Array(NB), barCap = new Float32Array(NB);   // bar levels and falling peaks, also drawn by the border (frame.js)
const barPrev = new Float32Array(NB), barFlash = new Float32Array(NB),
      barLit = new Int16Array(NB), barG = new Float32Array(NB);

/* A bar lights with a zone when any part of the bar's frequency span lies inside that zone. */
const barEdge = new Float32Array(NB + 1);
export function barGlow(b){
  const lo = barEdge[b], hi = barEdge[b+1]; let z = 0;
  for(let i=0;i<DET.length;i++){ const d = DET[i]; if(hi > d.lo && lo < d.hi && d.env > z) z = d.env; }
  return Math.min(1, Math.max(z, barFlash[b] * 0.7));
}
let fd, td;
const labels = [{x:0,y:0,f:0,a:0,txt:"",hz:""},{x:0,y:0,f:0,a:0,txt:"",hz:""}];
const NOTE_EN = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const NOTE_JP = ["ハ","ハ#","ニ","ニ#","ホ","ヘ","ヘ#","ト","ト#","イ","イ#","ロ"];
function noteName(f){
  const m = Math.round(69 + 12*Math.log2(f/440)); if(!isFinite(m)) return "";
  const n = ((m % 12) + 12) % 12, o = Math.floor(m/12) - 1;
  return S.jp ? NOTE_JP[n] + "-" + o : NOTE_EN[n] + o;
}
const fAt = i => F0 * Math.pow(F1/F0, i/(N-1));
for(let b=0;b<=NB;b++) barEdge[b] = fAt(b * N / NB);
function fmtTime(ms){ const s = ms/1000, m = Math.floor(s/60); return String(m).padStart(2,"0") + ":" + (s - m*60).toFixed(2).padStart(5,"0"); }
function clipText(s, n){ return s.length > n ? s.slice(0, n-1) + "…" : s; }

/* Once per frame: read the spectrum into the curve and bar arrays, track the input level, pick peak labels. */
export function analyse(){
  if(!fd){ fd = new Float32Array(analyser.frequencyBinCount); td = new Float32Array(2048); }
  analyser.getFloatFrequencyData(fd);
  const binHz = ctx.sampleRate / 2 / fd.length;
  for(let i=0;i<N;i++){
    const a = fAt(i-0.5)/binHz, b = fAt(i+0.5)/binHz; let v;
    if(b - a < 1.5){ const c = (a+b)/2, k = Math.floor(c), fr = c-k; v = (fd[k]||-200)*(1-fr) + (fd[k+1]||-200)*fr; }
    else { v = -200; for(let k=Math.ceil(a); k<=Math.floor(b) && k<fd.length; k++) if(fd[k] > v) v = fd[k]; }
    if(!isFinite(v)) v = -200;
    v += Math.log2(fAt(i)/1000) * 2.2;                    // gentle tilt so highs stay visible
    const n = Math.max(0, Math.min(1, (v - DBMIN)/(DBMAX - DBMIN)));
    raw[i] = n; cur[i] = cur[i]*0.55 + n*0.45;
  }
  for(let b=0;b<NB;b++){
    const i0 = Math.floor(b*N/NB), i1 = Math.max(i0+1, Math.floor((b+1)*N/NB)); let t = 0;
    for(let i=i0;i<i1;i++) if(raw[i] > t) t = raw[i];
    if(t - barPrev[b] > 0.09 && t > 0.2) barFlash[b] = 1; else barFlash[b] *= 0.86;
    barPrev[b] = t;
    barV[b] = Math.max(t, barV[b]*0.9 - 0.004);
    barCap[b] = Math.max(barV[b], barCap[b] - 0.007);
  }
  analyser.getFloatTimeDomainData(td);
  let s = 0; for(let i=0;i<td.length;i++) s += td[i]*td[i];
  const rms = Math.sqrt(s/td.length); S.level = Math.max(rms, S.level*0.9);
  if(S.frameNo % 3 === 0){ hist.unshift(Float32Array.from(cur)); if(hist.length > 3) hist.pop(); }

  if(S.frameNo % 6 === 0){
    const cand = [];
    for(let i=3;i<N-3;i++){ const c = cur[i]; if(c > 0.3 && c >= cur[i-1] && c > cur[i+1] && c >= cur[i-2] && c > cur[i+2] && c >= cur[i-3]) cand.push(i); }
    cand.sort((p,q) => cur[q]-cur[p]);
    const pick = []; for(const i of cand){ if(pick.every(j => Math.abs(i-j) > N/7)) pick.push(i); if(pick.length === 2) break; }
    pick.sort((p,q) => p-q);
    labels.forEach((L, s) => {
      const i = pick[s];
      if(i === undefined){ L.on = false; return; }
      let k0 = Math.max(1, Math.floor(fAt(i-0.6)/binHz)), k1 = Math.min(fd.length-2, Math.ceil(fAt(i+0.6)/binHz)), km = k0;
      for(let k=k0;k<=k1;k++) if(fd[k] > fd[km]) km = k;
      const y0 = fd[km-1], y1 = fd[km], y2 = fd[km+1], d = (y0 - 2*y1 + y2);
      const off = d ? 0.5*(y0 - y2)/d : 0, f = (km + (isFinite(off) ? Math.max(-0.5, Math.min(0.5, off)) : 0)) * binHz;
      L.on = true; L.ti = i; L.f = f; L.txt = noteName(f); L.hz = Math.round(f) + " Hz";
    });
  }
}

export function drawHud(now){
  const W0 = hud.width, H0 = hud.height;
  const jp = S.jp;
  hctx.setTransform(1,0,0,1,0,0);
  hctx.clearRect(0,0,W0,H0);
  if(!S.hudOn && !S.statusOn) return;                      // the graph and the status text are separate switches
  /* with a border on, everything here is laid out inside it */
  let ox = 0, oy = 0;
  if(S.frameStyle !== "off"){
    ox = Math.round(W0 * S.frameX / 100); oy = Math.round(H0 * S.frameY / 100);
    /* an oval or blob picture: keep to the largest rectangle that fits inside the oval */
    if(S.frameShape !== "rect"){ ox = Math.round(W0 / 2 - (W0 / 2 - ox) * 0.7071); oy = Math.round(H0 / 2 - (H0 / 2 - oy) * 0.7071); }
  }
  const W = W0 - 2*ox, H = H0 - 2*oy;
  hctx.setTransform(1,0,0,1,ox,oy);
  const dpr = W0 / innerWidth, s = dpr * Math.max(0.75, Math.min(1.6, Math.min(innerWidth/1280, innerHeight/720)));
  const FONT = '"MS Gothic","Osaka-Mono","DotGothic16",Consolas,"Courier New",monospace';
  const x0 = 26*s, x1 = W - 26*s, yB = H - 46*s, hS = H * 0.36, yT = yB - hS;
  const X = i => x0 + (x1-x0) * i/(N-1), Y = v => yB - v*hS;
  const fx = f => x0 + (x1-x0) * Math.log(f/F0)/Math.log(F1/F0);

  hctx.shadowColor = "rgba(0,0,0,.85)"; hctx.shadowBlur = 0;
  if(S.hudOn){                                             // a soft dark fade behind the graph
    const fade = hctx.createLinearGradient(0, yT - 40*s, 0, H); fade.addColorStop(0, "rgba(12,3,4,0)"); fade.addColorStop(1, "rgba(12,3,4,.7)");
    hctx.fillStyle = fade; hctx.fillRect(0, yT - 40*s, W, H - yT + 40*s);
  }

  if(S.statusOn){
  /* status text: input, preset, clip, time, level, hit pads */
  hctx.font = (17*s) + "px " + FONT; hctx.textBaseline = "top"; hctx.textAlign = "left";
  const cut = cutInfo();                                   // beat cuts armed: show the count toward the next cut
  const cutTxt = cut ? "  " + (jp ? "カット " : "CUT ") + String(cut.kicks).padStart(2,"0") + "/" + String(cut.every).padStart(2,"0") : "";
  const rows = [
    [jp ? "入力" : "INPUT", clipText(S.inputLabel || "-", 46)],
    [jp ? "プリセット" : "PRESET", S.mdOn ? clipText((isStarred() ? "★ " : "") + (presetNames[presetIdx] || "-"), 46) + (S.locked ? (jp ? "  [固定]" : "  [LOCKED]") : "") : (jp ? "オフ" : "off")],
    [jp ? "映像" : "CLIP", clipIdx >= 0 ? String(clipIdx+1).padStart(2,"0") + "/" + String(clips.length).padStart(2,"0") + "  " + clipText(clips[clipIdx].name, cut ? 26 : 36) + cutTxt : (jp ? "なし" : "none")],
    [jp ? "時間" : "TIME", fmtTime(now - S.t0)],
  ];
  const lx = 26*s, vx = lx + (jp ? 112 : 92)*s; let ly = 24*s;
  hctx.shadowBlur = 0;
  hctx.fillStyle = "rgba(12,3,4,.62)"; hctx.fillRect(12*s, 12*s, Math.min(W - 24*s, 600*s), 172*s);
  hctx.shadowBlur = 6*s;
  for(const [k,v] of rows){ hctx.fillStyle = "#d9667e"; hctx.fillText(k, lx, ly); hctx.fillStyle = "#f3e9ea"; hctx.fillText(v, vx, ly); ly += 25*s; }
  /* level meter */
  hctx.fillStyle = "#d9667e"; hctx.fillText(jp ? "レベル" : "LEVEL", lx, ly);
  const db = 20*Math.log10(S.level + 1e-6), segs = 24, lit = Math.round(Math.max(0, Math.min(1, (db + 54)/54)) * segs);
  for(let i=0;i<segs;i++){ hctx.fillStyle = i < lit ? (i > segs-4 ? "#ffffff" : "#d9667e") : "rgba(217,102,126,.22)"; hctx.fillRect(vx + i*9*s, ly + 2*s, 6*s, 14*s); }
  hctx.fillStyle = "#f3e9ea"; hctx.fillText((db < -90 ? "-inf" : db.toFixed(0)) + " dB", vx + segs*9*s + 10*s, ly);
  /* hit pads */
  ly += 26*s;
  hctx.fillStyle = "#d9667e"; hctx.fillText(jp ? "ヒット" : "HITS", lx, ly);
  hctx.font = (13*s) + "px " + FONT; hctx.textAlign = "center";
  /* one pad per zone; with more than five zones the pads narrow so they still fit the status block */
  const padRoom = 12*s + Math.min(W - 24*s, 600*s) - vx - 6*s, padStep = Math.min(92*s, padRoom / DET.length);
  DET.forEach((d, i) => {
    const px = vx + i*padStep, pw = padStep - 8*s, ph = 19*s;
    hctx.fillStyle = "rgba(255,225,232," + (0.92*d.env).toFixed(3) + ")"; hctx.fillRect(px, ly, pw, ph);
    hctx.strokeStyle = "#d9667e"; hctx.lineWidth = 1.2*s; hctx.strokeRect(px, ly, pw, ph);
    hctx.fillStyle = d.env > 0.5 ? "#1a0508" : "#f3e9ea"; hctx.fillText(jp ? d.jp : d.en, px + pw/2, ly + 3*s, pw - 4*s);
  });
  hctx.textAlign = "left";
  }
  if(!S.hudOn){ hctx.shadowBlur = 0; return; }

  /* frequency grid */
  hctx.shadowBlur = 0;
  hctx.font = (14*s) + "px " + FONT; hctx.textAlign = "center"; hctx.textBaseline = "top";
  hctx.strokeStyle = "rgba(217,102,126,.16)"; hctx.lineWidth = 1*s;
  for(const [f,t] of [[50,"50"],[100,"100"],[200,"200"],[500,"500"],[1000,"1.0k"],[2000,"2.0k"],[5000,"5.0k"],[10000,"10k"]]){
    const x = fx(f); hctx.beginPath(); hctx.moveTo(x, yT); hctx.lineTo(x, yB); hctx.stroke();
    hctx.fillStyle = "rgba(243,233,234,.6)"; hctx.fillText(t, x, yB + 10*s);
  }
  hctx.beginPath(); hctx.moveTo(x0, yB); hctx.lineTo(x1, yB); hctx.strokeStyle = "rgba(217,102,126,.35)"; hctx.stroke();

  if(S.graph === "bars"){
    /* LED bars: dim grid, lit segments, falling peak caps; a zone turns white when its hit detector fires */
    const SEG = 24, pitch = hS/SEG, sh = pitch*0.64, bw = (x1-x0)/NB, w = bw*0.74, off = (bw-w)/2;
    hctx.fillStyle = "rgba(217,102,126,.12)";
    for(let b=0;b<NB;b++){
      const n = barLit[b] = Math.min(SEG, Math.round(barV[b]*SEG)), x = x0 + b*bw + off; barG[b] = barGlow(b);
      for(let j=n;j<SEG;j++) hctx.fillRect(x, yB - (j+1)*pitch + (pitch-sh), w, sh);
    }
    hctx.globalCompositeOperation = "lighter";
    if(S.glow){
      /* soft glow: two wider, faint columns behind each lit bar, added like light (no shadowBlur per bar) */
      hctx.fillStyle = "rgba(217,102,126,.09)";
      for(let b=0;b<NB;b++){
        const n = barLit[b]; if(!n) continue; const x = x0 + b*bw + off;
        hctx.fillRect(x - w*0.6, yB - (n+1)*pitch, w*2.2, (n+1)*pitch);
        hctx.fillRect(x - w*0.2, yB - (n+0.4)*pitch, w*1.4, (n+0.4)*pitch);
      }
    }
    for(let b=0;b<NB;b++){
      const g = barG[b], n = barLit[b]; if(g < 0.04 || !n) continue;
      hctx.fillStyle = "rgba(255,150,175," + (0.32*g).toFixed(3) + ")";
      hctx.fillRect(x0 + b*bw, yB - (n+1.5)*pitch, bw, (n+1.5)*pitch);
    }
    hctx.globalCompositeOperation = "source-over";
    for(let b=0;b<NB;b++){
      const g = barG[b], n = barLit[b], x = x0 + b*bw + off;
      hctx.fillStyle = "rgb(" + Math.round(217+38*g) + "," + Math.round(102+153*g) + "," + Math.round(126+129*g) + ")";
      for(let j=0;j<n;j++) hctx.fillRect(x, yB - (j+1)*pitch + (pitch-sh), w, sh);
      const c = Math.min(SEG-1, Math.round(barCap[b]*SEG));
      if(c >= n && c > 0){ hctx.fillStyle = "rgba(243,233,234,.92)"; hctx.fillRect(x, yB - (c+1)*pitch + (pitch-sh), w, sh); }
    }
    return;
  }
  /* curve style: soft glow in a zone when its hit detector fires */
  for(const d of DET){
    if(d.env < 0.03) continue;
    const zx0 = Math.max(x0, fx(d.lo)), zx1 = Math.min(x1, fx(d.hi));
    if(zx1 <= zx0) continue;                                // zone lies outside the 40 Hz to 14 kHz graph
    const zg = hctx.createLinearGradient(0, yT, 0, yB);
    zg.addColorStop(0, "rgba(255,170,190,0)"); zg.addColorStop(1, "rgba(255,170,190," + (0.3*d.env).toFixed(3) + ")");
    hctx.fillStyle = zg; hctx.fillRect(zx0, yT, zx1 - zx0, yB - yT);
  }

  /* filled body + ghost trails + main line */
  const path = arr => { hctx.beginPath(); hctx.moveTo(X(0), Y(arr[0])); for(let i=1;i<N;i++) hctx.lineTo(X(i), Y(arr[i])); };
  path(cur); hctx.lineTo(x1, yB); hctx.lineTo(x0, yB); hctx.closePath();
  const g = hctx.createLinearGradient(0, yT, 0, yB); g.addColorStop(0, "rgba(217,102,126,.34)"); g.addColorStop(1, "rgba(60,20,28,.30)");
  hctx.fillStyle = g; hctx.fill();
  hctx.lineJoin = "round";
  const ghost = ["rgba(217,102,126,.75)","rgba(190,150,158,.45)","rgba(150,150,150,.3)"];
  for(let h=hist.length-1;h>=0;h--){ path(hist[h]); hctx.strokeStyle = ghost[h]; hctx.lineWidth = 1.4*s; hctx.stroke(); }
  hctx.shadowColor = "rgba(0,0,0,.8)"; hctx.shadowBlur = 5*s;
  path(cur); hctx.strokeStyle = "#ffffff"; hctx.lineWidth = 2.6*s; hctx.stroke();

  /* peak labels */
  for(const L of labels){
    const tx = L.on ? X(L.ti) : L.x, ty = L.on ? Y(cur[L.ti]) : L.y;
    if(L.a < 0.02){ L.x = tx; L.y = ty; } else { L.x += (tx - L.x)*0.18; L.y += (ty - L.y)*0.18; }
    L.a += ((L.on ? 1 : 0) - L.a) * 0.12;
    if(L.a < 0.03 || !L.txt) continue;
    const bw = 124*s, bh = 60*s, bx = Math.max(x0, Math.min(x1 - bw, L.x - bw/2)), by = Math.max(yT - bh - 20*s, L.y - bh - 46*s);
    hctx.globalAlpha = L.a;
    hctx.strokeStyle = "#d9667e"; hctx.lineWidth = 1.6*s;
    hctx.beginPath(); hctx.moveTo(L.x, by + bh); hctx.lineTo(L.x, L.y); hctx.stroke();
    hctx.fillStyle = "#d9667e"; hctx.fillRect(L.x - 4*s, L.y - 4*s, 8*s, 8*s);
    hctx.fillStyle = "rgba(40,8,14,.82)"; hctx.fillRect(bx, by, bw, bh); hctx.strokeRect(bx, by, bw, bh);
    hctx.shadowBlur = 0; hctx.textAlign = "center"; hctx.textBaseline = "alphabetic";
    hctx.fillStyle = "#f3e9ea"; hctx.font = (28*s) + "px " + FONT; hctx.fillText(L.txt, bx + bw/2, by + 32*s);
    hctx.fillStyle = "rgba(243,233,234,.7)"; hctx.font = (14*s) + "px " + FONT; hctx.fillText(L.hz, bx + bw/2, by + 51*s);
    hctx.shadowBlur = 5*s; hctx.globalAlpha = 1;
  }
  hctx.globalAlpha = 1; hctx.shadowBlur = 0;
}

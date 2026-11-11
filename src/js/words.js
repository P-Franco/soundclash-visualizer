/* Japanese text over the picture: small labels that appear at random places where the video plays,
   a few on each kick, flash white for a moment and fade out. Modelled on old MIDI player screens.

   Two kinds of label:
   - note names read from the music as it plays (the loudest bumps in the spectrum, in イロハ names like
     ハ-2 or ニ#4), placed left to right by pitch, low notes on the left;
   - words in kanji and katakana to do with sound, some with a live number beside them.

   Drawn on the graph canvas after the graph, kept inside the picture: inside the border, clear of the
   status text and the graph, and well inside the outline of an oval or blob. */
import { hud } from "./dom.js";
import { S } from "./state.js";
import { DET, onHit } from "./detect.js";
import { N, cur, fAt, noteName } from "./hud.js";

const c = hud.getContext("2d");
const FONT = '"MS Gothic","Osaka-Mono","DotGothic16",Consolas,"Courier New",monospace';
const ROSE = "#d9667e", PALE = "#f3e9ea", BLUE = "#7f9be0";
const TAU = Math.PI * 2, MAX = 28;

const WORDS = ["可視化", "周波数", "波形", "音量", "低音", "高音", "重低音", "振動", "共鳴", "残響", "信号", "入力", "出力", "再生",
  "律動", "旋律", "和音", "鼓動", "拍子", "音楽", "電子音", "同期", "映像", "音", "拍", "波",
  "キック", "スネア", "ハット", "ベース", "ドラム", "シンセ", "リバーブ", "コーラス", "レベル", "ビート", "リズム", "サウンド"];

const pool = [];               // {txt, x, y, w, h, px, font, ink, t0, life}

/* the loudest bumps in the spectrum right now, as indexes into the 200-point curve */
function bumps(){
  const out = [];
  for(let i = 2; i < N - 2; i++){ const v = cur[i]; if(v > 0.28 && v >= cur[i-1] && v > cur[i+1] && v >= cur[i-2] && v > cur[i+2]) out.push(i); }
  return out;
}

/* Where the picture is on the canvas, and what in it to keep clear of. */
function picture(){
  const W = hud.width, H = hud.height, border = S.frameStyle !== "off";
  const bx = border ? Math.round(W * S.frameX / 100) : 0, by = border ? Math.round(H * S.frameY / 100) : 0;
  const round = border && S.frameShape !== "rect";
  const s = W / innerWidth * Math.max(0.75, Math.min(1.6, Math.min(innerWidth / 1280, innerHeight / 720)));   // same scale the graph uses
  let status = null;
  if(S.statusOn){                // the status block sits at the top left of the area the graph is laid out in
    const ox = round ? Math.round(W / 2 - (W / 2 - bx) * 0.7071) : bx, oy = round ? Math.round(H / 2 - (H / 2 - by) * 0.7071) : by;
    status = [ox + 6 * s, oy + 6 * s, 612 * s, 184 * s];
  }
  return {W, H, bx, by, round, s, status};
}
const hits = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

/* A free spot for a label w by h. pitch (0..1) fixes how far across it goes; without one, anywhere. */
function place(p, w, h, pitch){
  for(let tries = 0; tries < 12; tries++){
    let x, y;
    if(p.round){
      /* inside the oval, kept in from the edge (further when the curve is drawn round the inside of it) */
      const k = S.hudOn ? 0.62 : 0.8, rx = (p.W / 2 - p.bx) * k, ry = (p.H / 2 - p.by) * k;
      const dy = (Math.random() * 2 - 1) * ry * 0.92, half = rx * Math.sqrt(1 - (dy / ry) * (dy / ry));
      const fx = pitch === undefined ? Math.random() : pitch;
      x = p.W / 2 - half + fx * Math.max(0, 2 * half - w); y = p.H / 2 + dy - h / 2;
    }else{
      const m = Math.min(p.W, p.H) * 0.04, innerH = p.H - 2 * p.by;
      const x0 = p.bx + m, x1 = p.W - p.bx - m - w, y0 = p.by + m;
      const y1 = p.by + innerH * (S.hudOn ? 0.52 : 1) - m - h;          // with the graph on, keep to the part above it
      x = x0 + (pitch === undefined ? Math.random() : pitch) * Math.max(0, x1 - x0); y = y0 + Math.random() * Math.max(0, y1 - y0);
    }
    if(p.status && hits(x, y, w, h, p.status[0], p.status[1], p.status[2], p.status[3])) continue;
    let clear = true;
    for(const L of pool) if(hits(x - 8, y - 4, w + 16, h + 8, L.x, L.y, L.w, L.h)){ clear = false; break; }
    if(clear) return [x, y];
  }
  return null;
}

function spawn(now, p){
  if(pool.length >= MAX) return;
  let txt, pitch;
  const peaks = S.wordsKind === "words" ? [] : bumps();
  if(peaks.length && (S.wordsKind === "notes" || Math.random() < 0.55)){
    const i = peaks[Math.floor(Math.random() * peaks.length)];
    txt = noteName(fAt(i), true); pitch = i / (N - 1);
  }else if(S.wordsKind === "notes") return;                   // nothing loud enough to name
  else{
    txt = WORDS[Math.floor(Math.random() * WORDS.length)];
    const r = Math.random();                                  // now and then a live reading beside the word
    if(r < 0.12) txt = "レベル " + Math.round(20 * Math.log10(S.level + 1e-6));
    else if(r < 0.24 && peaks.length) txt = "周波数 " + Math.round(fAt(peaks[0])) + " Hz";
  }
  if(!txt) return;
  const px = Math.max(8, S.wordsSize * p.s), font = px + "px " + FONT;
  c.font = font;
  const w = c.measureText(txt).width, h = px * 1.15, at = place(p, w, h, pitch);
  if(!at) return;
  const r = Math.random();
  pool.push({txt, x: at[0], y: at[1], w, h, px, font, ink: r < 0.1 ? BLUE : r < 0.4 ? PALE : ROSE, t0: now, life: 2.2 + Math.random() * 1.6});
}

onHit((zone, i, age) => {
  if(i !== 0 || !S.wordsOn || !S.started || age > 0.25) return;   // kicks only, and not ones reported late
  const now = performance.now(), p = picture();
  for(let n = 0; n < S.wordsAmount; n++) spawn(now, p);
});

/* Once per frame, after the graph. */
export function drawWords(now){
  if(!pool.length) return;
  if(!S.wordsOn){ pool.length = 0; return; }
  c.setTransform(1, 0, 0, 1, 0, 0); c.shadowBlur = 0; c.textAlign = "left"; c.textBaseline = "top"; c.lineJoin = "round";
  const kick = DET[0].env; let font = "";
  for(let i = pool.length - 1; i >= 0; i--){
    const L = pool[i], age = (now - L.t0) / 1000;
    if(age >= L.life){ pool.splice(i, 1); continue; }
    if(L.font !== font){ font = L.font; c.font = font; }
    /* quick in, slow out; every label lifts a little on each kick */
    c.globalAlpha = Math.min(1, age / 0.06) * Math.min(1, (L.life - age) / (L.life * 0.45)) * (0.78 + 0.22 * kick);
    c.lineWidth = L.px * 0.22; c.strokeStyle = "rgba(0,0,0,.55)"; c.strokeText(L.txt, L.x, L.y);   // thin dark edge, so it reads over bright video
    c.fillStyle = age < 0.14 ? "#fff" : L.ink;                                                      // white for an instant, like a flash
    c.fillText(L.txt, L.x, L.y);
  }
  c.globalAlpha = 1;
}

/* test hook */
export function wordsState(){ return pool.map(L => ({txt: L.txt, x: L.x, y: L.y, w: L.w, h: L.h})); }

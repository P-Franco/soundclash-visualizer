/* Border: what the app draws around the picture. Clips come with all sorts of borders baked in, and a
   projector throws a plain rectangle; this covers the edges with pure black (no light from a projector)
   and can give the picture another outline altogether.

   Shape of the picture: a rectangle, an oval, or a blob (an oval whose outline drifts slowly and bulges
   out in a different direction on each kick).
   Style: solid, colour bars that move with the music, or a pulse on the kick.

   It has its own canvas, above the video and the MilkDrop layer and below the graph. The rectangle
   only paints its border strips. The oval and blob paint the whole canvas black and cut a hole in it.
   No shadowBlur anywhere: this runs every frame. Glow is built from a few wide, faint strokes instead. */
import { frameCv } from "./dom.js";
import { S } from "./state.js";
import { DET, onHit } from "./detect.js";
import { barV, barCap, barGlow, NB } from "./hud.js";

const g = frameCv.getContext("2d");
const BLACK = "#000", ROSE = "#d9667e", PALE = "#f3e9ea";

export const FRAME_STYLES = ["off", "solid", "bars", "pulse"];

/* one colour per spectrum band, built once: red for the lows round to violet for the highs */
const RAINBOW = Array.from({length: NB}, (_, i) => "hsl(" + Math.round(i / (NB - 1) * 290) + ",95%,58%)");
const barColor = (band, v) => S.frameColor !== "app" ? RAINBOW[band] : (v > 0.8 ? PALE : ROSE);

let drawn = "";      // what is on the canvas now, so a border that does not move is not repainted

/* ---------- colour bars ---------- */
/* Bars are laid out first (where each starts, which way it points, how far it may reach), then painted
   in a few passes, so the canvas state changes a handful of times a frame instead of once per bar. */
const MAXB = 240;
const PX = new Float32Array(MAXB), PY = new Float32Array(MAXB), DX = new Float32Array(MAXB), DY = new Float32Array(MAXB),
      WID = new Float32Array(MAXB), REACH = new Float32Array(MAXB), LVL = new Float32Array(MAXB), PEAK = new Float32Array(MAXB), HIT = new Float32Array(MAXB);
const BAND = new Uint8Array(MAXB), DASH = [0, 0], NO_DASH = [];
let count = 0;
function put(x, y, dx, dy, width, reach, band, lvl, peak, hit){
  if(count >= MAXB) return;
  PX[count] = x; PY[count] = y; DX[count] = dx; DY[count] = dy; WID[count] = width; REACH[count] = reach;
  BAND[count] = band; LVL[count] = lvl; PEAK[count] = peak; HIT[count] = hit; count++;
}
function line(i, from, to){
  g.beginPath(); g.moveTo(PX[i] + DX[i] * from, PY[i] + DY[i] * from); g.lineTo(PX[i] + DX[i] * to, PY[i] + DY[i] * to); g.stroke();
}
function paintBars(){
  const rich = S.glow;
  if(rich){
    /* 1. glow: two wide, faint, round-ended strokes under each bar, added like light: a broad dim one and a
       tighter brighter one, so the light falls off softly. Quiet bars glow little; a zone hit flares it. */
    g.globalCompositeOperation = "lighter"; g.lineCap = "round";
    for(let i = 0; i < count; i++){
      const a = 0.02 + 0.11 * LVL[i] + 0.2 * HIT[i], len = Math.max(2, LVL[i] * REACH[i]);
      g.strokeStyle = barColor(BAND[i], LVL[i]);
      g.globalAlpha = a * 0.55; g.lineWidth = WID[i] * 3.4; line(i, 0, len);
      g.globalAlpha = a; g.lineWidth = WID[i] * 1.9; line(i, 0, len);
    }
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.lineCap = "butt";
  }
  /* 2. the bar itself, cut into LED segments when detail is on */
  let lastW = -1;
  for(let i = 0; i < count; i++){
    if(rich && WID[i] !== lastW){ lastW = WID[i]; DASH[0] = Math.max(3, lastW * 0.45); DASH[1] = DASH[0] * 0.4; g.setLineDash(DASH); }
    g.strokeStyle = barColor(BAND[i], LVL[i]); g.lineWidth = WID[i];
    line(i, 0, Math.max(2, LVL[i] * REACH[i]));
  }
  if(!rich) return;
  g.setLineDash(NO_DASH);
  /* 3. a bright line down the middle of each bar, brighter on a hit */
  g.strokeStyle = "#fff";
  for(let i = 0; i < count; i++){
    g.globalAlpha = 0.2 + 0.6 * HIT[i]; g.lineWidth = Math.max(1, WID[i] * 0.2);
    line(i, 0, Math.max(2, LVL[i] * REACH[i]));
  }
  /* 4. a peak marker that hangs above the bar and falls back slowly */
  g.globalAlpha = 0.75;
  for(let i = 0; i < count; i++){
    const at = Math.max(PEAK[i], LVL[i]) * REACH[i] + WID[i] * 0.4;
    g.lineWidth = WID[i] * 0.8; line(i, at, at + Math.max(2, WID[i] * 0.2));
  }
  g.globalAlpha = 1;
}

/* ---------- rectangle ---------- */
function strips(W, H, bx, by){
  if(by){ g.fillRect(0, 0, W, by); g.fillRect(0, H - by, W, by); }
  if(bx){ g.fillRect(0, by, bx, H - 2*by); g.fillRect(W - bx, by, bx, H - 2*by); }
}
const pair = (arr, band) => arr[band] > arr[band+1] ? arr[band] : arr[band+1];
/* Bars along the four edges, growing from the edge of the screen toward the picture. Each is two
   neighbouring slices of the spectrum (the same levels the LED graph shows).
   Top and bottom: lows in the middle, highs toward the corners. Sides: lows at the bottom. */
function layoutEdges(W, H, bx, by){
  const half = NB / 2; count = 0;
  if(by){
    const pitch = W / NB, w = pitch * 0.74;
    for(let p = 0; p < NB; p++){
      const band = p < half ? (half - 1 - p) * 2 : (p - half) * 2, x = (p + 0.5) * pitch;
      const lvl = pair(barV, band), peak = pair(barCap, band), hit = Math.max(barGlow(band), barGlow(band + 1));
      put(x, 0, 0, 1, w, by, band, lvl, peak, hit); put(x, H, 0, -1, w, by, band, lvl, peak, hit);
    }
  }
  if(bx){
    const room = H - 2*by, pitch = room / half, h = pitch * 0.74;
    for(let q = 0; q < half; q++){
      const band = q * 2, y = by + room - (q + 0.5) * pitch;
      const lvl = pair(barV, band), peak = pair(barCap, band), hit = Math.max(barGlow(band), barGlow(band + 1));
      put(0, y, 1, 0, h, bx, band, lvl, peak, hit); put(W, y, -1, 0, h, bx, band, lvl, peak, hit);
    }
  }
}

/* ---------- oval and blob ---------- */
/* The outline is an oval sampled at PTS angles. edge[i] is how far out the outline sits at angle i,
   as a multiple of the oval's own radius there: 1 everywhere for a plain oval. */
const PTS = 120, TAU = Math.PI * 2;
const edge = new Float32Array(PTS).fill(1), COS = new Float32Array(PTS), SIN = new Float32Array(PTS);
for(let i = 0; i < PTS; i++){ COS[i] = Math.cos(i / PTS * TAU); SIN[i] = Math.sin(i / PTS * TAU); }

/* each kick starts a bulge at a new angle; it swells fast and relaxes over about a second */
const bulges = [];             // {a: angle, t0: performance.now() when it started}
let lastAngle = 0;
onHit((zone, i) => {
  if(i !== 0 || S.frameStyle === "off" || S.frameShape !== "blob") return;
  let a = Math.random() * TAU;
  if(Math.cos(a - lastAngle) > 0.5) a += 2.2;             // not the same side twice running
  lastAngle = a;
  bulges.push({a, t0: performance.now()});
  if(bulges.length > 8) bulges.shift();
});

/* `room` is how far the outline may grow (as a fraction of the radius) and still stay on the screen. */
function shapeEdge(now, room){
  if(S.frameShape !== "blob"){ edge.fill(1); return; }
  while(bulges.length && now - bulges[0].t0 > 2600) bulges.shift();
  const t = now / 1000, n = bulges.length;
  for(let b = 0; b < n; b++){ const age = (now - bulges[b].t0) / 1000; bulges[b].amp = 0.75 * (1 - Math.exp(-age / 0.045)) * Math.exp(-age / 0.42); }
  for(let i = 0; i < PTS; i++){
    const th = i / PTS * TAU;
    let f = 0.25 * (0.5 + 0.3 * Math.sin(2 * th + t * 0.55) + 0.2 * Math.sin(3 * th - t * 0.4));     // slow drift, always there
    for(let b = 0; b < n; b++) f += bulges[b].amp * Math.exp((Math.cos(th - bulges[b].a) - 1) / 0.2);  // a soft bump about 70 degrees wide
    edge[i] = 1 + room * (f < 1 ? f : 1);
  }
}
function edgeAt(th){
  let u = th / TAU * PTS; u = ((u % PTS) + PTS) % PTS;
  const i = u | 0, f = u - i;
  return edge[i] * (1 - f) + edge[(i + 1) % PTS] * f;
}
/* The outline as a path: a true ellipse, or a smooth curve through the blob's points. */
function outline(cx, cy, rx, ry){
  g.beginPath();
  if(S.frameShape !== "blob"){ g.ellipse(cx, cy, rx, ry, 0, 0, TAU); return; }
  let qx = cx + rx * edge[0] * COS[0], qy = cy + ry * edge[0] * SIN[0];
  const lx = cx + rx * edge[PTS-1] * COS[PTS-1], ly = cy + ry * edge[PTS-1] * SIN[PTS-1];
  g.moveTo((lx + qx) / 2, (ly + qy) / 2);
  for(let i = 1; i <= PTS; i++){
    const k = i % PTS, nx = cx + rx * edge[k] * COS[k], ny = cy + ry * edge[k] * SIN[k];
    g.quadraticCurveTo(qx, qy, (qx + nx) / 2, (qy + ny) / 2);
    qx = nx; qy = ny;
  }
  g.closePath();
}
/* Bars all the way round, each standing straight out from the outline: lows at the bottom, highs at
   the top, the same on both sides. */
function ringBar(cx, cy, rx, ry, th, gap, width, reach, band){
  const c = Math.cos(th), s = Math.sin(th), m = edgeAt(th);
  let nx = c / rx, ny = s / ry; const k = 1 / Math.sqrt(nx * nx + ny * ny); nx *= k; ny *= k;
  put(cx + rx * m * c + nx * gap, cy + ry * m * s + ny * gap, nx, ny, width, reach, band, barV[band], barCap[band], barGlow(band));
}
function layoutRing(cx, cy, rx, ry, reach, gap){
  const around = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const width = Math.max(2, around / (2 * NB) * 0.62);
  count = 0;
  for(let j = 0; j < NB; j++){
    const th = Math.PI / 2 - (j + 0.5) * Math.PI / NB;
    ringBar(cx, cy, rx, ry, th, gap, width, reach, j); ringBar(cx, cy, rx, ry, Math.PI - th, gap, width, reach, j);
  }
}

/* ---------- once per frame ---------- */
export function drawFrame(now){
  const W = frameCv.width, H = frameCv.height, style = S.frameStyle, shape = S.frameShape;
  const bx = style === "off" ? 0 : Math.round(W * S.frameX / 100), by = style === "off" ? 0 : Math.round(H * S.frameY / 100);
  const key = [style, shape, bx, by, W, H, S.sizeGen, S.glow].join("|"), changed = key !== drawn;
  if(changed){ drawn = key; g.clearRect(0, 0, W, H); }
  if(style === "off") return;
  if(style === "solid" && shape !== "blob" && !changed) return;      // nothing moves: keep what is drawn
  const lw = Math.max(1, Math.round(W / 960)), kick = style === "pulse" ? DET[0].env : 0;

  if(shape === "rect"){
    if(!bx && !by) return;
    g.fillStyle = BLACK; strips(W, H, bx, by);          // the opaque base is what hides the clip's own border
    if(style === "bars"){ layoutEdges(W, H, bx, by); paintBars(); }
    else if(kick > 0.02){ g.fillStyle = "rgba(217,102,126," + (0.7 * kick).toFixed(3) + ")"; strips(W, H, bx, by); }
    /* a thin line where the border meets the picture */
    g.strokeStyle = "rgba(217,102,126,.6)"; g.lineWidth = lw;
    g.strokeRect(bx - lw / 2, by - lw / 2, W - 2*bx + lw, H - 2*by + lw);
    return;
  }

  /* oval or blob: black everywhere, with a hole the shape of the picture */
  const cx = W / 2, cy = H / 2, rx = Math.max(10, W / 2 - bx), ry = Math.max(10, H / 2 - by);
  shapeEdge(now, Math.min(bx / rx, by / ry));
  g.fillStyle = BLACK; g.fillRect(0, 0, W, H);
  outline(cx, cy, rx, ry);
  g.globalCompositeOperation = "destination-out"; g.fill();
  g.globalCompositeOperation = "source-over";
  if(style === "bars"){ layoutRing(cx, cy, rx, ry, Math.min(bx, by) || Math.min(W, H) * 0.04, lw * 3); paintBars(); }
  /* the outline itself: a soft halo when glow is on, then a thin line that swells on the kick in pulse style */
  outline(cx, cy, rx, ry);
  if(S.glow){
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = "rgba(217,102,126," + (0.09 + 0.2 * kick).toFixed(3) + ")"; g.lineWidth = lw * 12; g.stroke();
    g.strokeStyle = "rgba(217,102,126," + (0.16 + 0.3 * kick).toFixed(3) + ")"; g.lineWidth = lw * 5; g.stroke();
    g.globalCompositeOperation = "source-over";
  }
  g.strokeStyle = "rgba(217,102,126," + (0.6 + 0.4 * kick).toFixed(3) + ")"; g.lineWidth = lw * (1 + 10 * kick);
  g.stroke();
}

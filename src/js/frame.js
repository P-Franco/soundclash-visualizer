/* Border: what the app draws around the picture. Clips come with all sorts of borders baked in, and a
   projector throws a plain rectangle; this covers the edges with pure black (no light from a projector)
   and can give the picture another outline altogether.

   Shape of the picture: a rectangle, an oval, or a blob (an oval whose outline drifts slowly and bulges
   out in a different direction on each kick).
   Style: solid, colour bars that move with the music, or a pulse on the kick.

   It has its own canvas, above the video and the MilkDrop layer and below the graph. The rectangle
   only paints its border strips. The oval and blob paint the whole canvas black and cut a hole in it.
   No shadowBlur anywhere: this runs every frame. */
import { frameCv } from "./dom.js";
import { S } from "./state.js";
import { DET, onHit } from "./detect.js";
import { barV, NB } from "./hud.js";

const g = frameCv.getContext("2d");
const BLACK = "#000", ROSE = "#d9667e", PALE = "#f3e9ea";

export const FRAME_STYLES = ["off", "solid", "bars", "pulse"];

/* one colour per spectrum band, built once: red for the lows round to violet for the highs */
const RAINBOW = Array.from({length: NB}, (_, i) => "hsl(" + Math.round(i / (NB - 1) * 290) + ",95%,58%)");
const barColor = (band, v) => S.frameColor !== "app" ? RAINBOW[band] : (v > 0.8 ? PALE : ROSE);

let drawn = "";      // what is on the canvas now, so a border that does not move is not repainted

/* ---------- rectangle ---------- */
function strips(W, H, bx, by){
  if(by){ g.fillRect(0, 0, W, by); g.fillRect(0, H - by, W, by); }
  if(bx){ g.fillRect(0, by, bx, H - 2*by); g.fillRect(W - bx, by, bx, H - 2*by); }
}

/* Colour bars along the four edges. Each bar is one slice of the spectrum (the same levels the LED graph
   shows) and grows from the edge of the screen toward the picture.
   Top and bottom: lows in the middle, highs toward the corners. Sides: lows at the bottom. */
function edgeBars(W, H, bx, by){
  const half = NB / 2;
  if(by){
    const pitch = W / NB, w = pitch * 0.74, off = (pitch - w) / 2;
    for(let p = 0; p < NB; p++){
      const band = p < half ? (half - 1 - p) * 2 : (p - half) * 2;
      const v = barV[band] > barV[band+1] ? barV[band] : barV[band+1], len = Math.max(2, v * by), x = p * pitch + off;
      g.fillStyle = barColor(band, v);
      g.fillRect(x, 0, w, len); g.fillRect(x, H - len, w, len);
    }
  }
  if(bx){
    const top = by, room = H - 2*by, pitch = room / half, h = pitch * 0.74, off = (pitch - h) / 2;
    for(let q = 0; q < half; q++){
      const band = q * 2;
      const v = barV[band] > barV[band+1] ? barV[band] : barV[band+1], len = Math.max(2, v * bx), y = top + room - (q + 1) * pitch + off;
      g.fillStyle = barColor(band, v);
      g.fillRect(0, y, len, h); g.fillRect(W - len, y, len, h);
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
/* one bar: a short line standing straight out from the outline at angle th */
function ray(cx, cy, rx, ry, th, gap, len){
  const c = Math.cos(th), s = Math.sin(th), m = edgeAt(th), x = cx + rx * m * c, y = cy + ry * m * s;
  let nx = c / rx, ny = s / ry; const k = 1 / Math.sqrt(nx * nx + ny * ny); nx *= k; ny *= k;
  g.moveTo(x + nx * gap, y + ny * gap); g.lineTo(x + nx * (gap + len), y + ny * (gap + len));
}
/* Colour bars all the way round: lows at the bottom, highs at the top, the same on both sides. */
function ringBars(cx, cy, rx, ry, reach, gap){
  const around = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  g.lineWidth = Math.max(2, around / (2 * NB) * 0.62); g.lineCap = "butt";
  for(let j = 0; j < NB; j++){
    const v = barV[j], len = Math.max(3, v * reach), th = Math.PI / 2 - (j + 0.5) * Math.PI / NB;
    g.strokeStyle = barColor(j, v);
    g.beginPath(); ray(cx, cy, rx, ry, th, gap, len); ray(cx, cy, rx, ry, Math.PI - th, gap, len); g.stroke();
  }
}

/* ---------- once per frame ---------- */
export function drawFrame(now){
  const W = frameCv.width, H = frameCv.height, style = S.frameStyle, shape = S.frameShape;
  const bx = style === "off" ? 0 : Math.round(W * S.frameX / 100), by = style === "off" ? 0 : Math.round(H * S.frameY / 100);
  const key = [style, shape, bx, by, W, H, S.sizeGen].join("|"), changed = key !== drawn;
  if(changed){ drawn = key; g.clearRect(0, 0, W, H); }
  if(style === "off") return;
  if(style === "solid" && shape !== "blob" && !changed) return;      // nothing moves: keep what is drawn
  const lw = Math.max(1, Math.round(W / 960)), kick = style === "pulse" ? DET[0].env : 0;

  if(shape === "rect"){
    if(!bx && !by) return;
    g.fillStyle = BLACK; strips(W, H, bx, by);          // the opaque base is what hides the clip's own border
    if(style === "bars") edgeBars(W, H, bx, by);
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
  if(style === "bars") ringBars(cx, cy, rx, ry, Math.min(bx, by) || Math.min(W, H) * 0.04, lw * 3);
  /* the outline itself: thin normally, swelling on the kick in pulse style */
  g.strokeStyle = "rgba(217,102,126," + (0.6 + 0.4 * kick).toFixed(3) + ")"; g.lineWidth = lw * (1 + 10 * kick);
  outline(cx, cy, rx, ry); g.stroke();
}

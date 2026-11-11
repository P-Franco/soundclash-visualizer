/* Border: what the app draws around the picture. Clips come with all sorts of borders baked in, and a
   projector throws a plain rectangle; this covers the edges with pure black (no light from a projector)
   and can give the picture another outline altogether.

   Shape of the picture: a rectangle, an oval, or a blob (an oval whose outline drifts slowly and bulges
   out in a different direction on each kick).
   Style: solid, bars that move with the music, or a pulse on the kick.

   It has its own canvas, above the video and the MilkDrop layer and below the graph. The rectangle
   only paints its border strips. The oval and blob paint the whole canvas black and cut a hole in it.
   No shadowBlur anywhere: this runs every frame. Glow is built from a few wide, faint strokes instead. */
import { frameCv } from "./dom.js";
import { S } from "./state.js";
import { DET, onHit } from "./detect.js";
import { barV, barCap, barGlow, NB, N, cur, hist, labels } from "./hud.js";

const g = frameCv.getContext("2d");
const BLACK = "#000", ROSE = "#d9667e", PALE = "#f3e9ea";

export const FRAME_STYLES = ["off", "solid", "bars", "pulse"];

/* bars are the app's rose, turning pale near the top of their range */
const barInk = v => v > 0.8 ? PALE : ROSE;

let drawn = "";      // what is on the canvas now, so a border that does not move is not repainted

/* ---------- bars ---------- */
/* Bars are laid out first (where each starts, which way it points, how far it may reach), then painted
   in a few passes, so the canvas state changes a handful of times a frame instead of once per bar. */
const MAXB = 240;
const PX = new Float32Array(MAXB), PY = new Float32Array(MAXB), DX = new Float32Array(MAXB), DY = new Float32Array(MAXB),
      WID = new Float32Array(MAXB), REACH = new Float32Array(MAXB), LVL = new Float32Array(MAXB), PEAK = new Float32Array(MAXB), HIT = new Float32Array(MAXB);
const DASH = [0, 0], NO_DASH = [];
let count = 0;
function put(x, y, dx, dy, width, reach, lvl, peak, hit){
  if(count >= MAXB) return;
  PX[count] = x; PY[count] = y; DX[count] = dx; DY[count] = dy; WID[count] = width; REACH[count] = reach;
  LVL[count] = lvl; PEAK[count] = peak; HIT[count] = hit; count++;
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
      const a = 0.02 + LVL[i] * (0.11 + 0.2 * HIT[i]), len = Math.max(2, LVL[i] * REACH[i]);   // a hit flares long bars, not stubs
      g.strokeStyle = barInk(LVL[i]);
      g.globalAlpha = a * 0.55; g.lineWidth = WID[i] * 3.4; line(i, 0, len);
      g.globalAlpha = a; g.lineWidth = WID[i] * 1.9; line(i, 0, len);
    }
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.lineCap = "butt";
  }
  /* 2. the bar itself, cut into LED segments when detail is on */
  let lastW = -1;
  for(let i = 0; i < count; i++){
    if(rich && WID[i] !== lastW){ lastW = WID[i]; DASH[0] = Math.max(3, lastW * 0.45); DASH[1] = DASH[0] * 0.4; g.setLineDash(DASH); }
    g.strokeStyle = barInk(LVL[i]); g.lineWidth = WID[i];
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
      put(x, 0, 0, 1, w, by, lvl, peak, hit); put(x, H, 0, -1, w, by, lvl, peak, hit);
    }
  }
  if(bx){
    const room = H - 2*by, pitch = room / half, h = pitch * 0.74;
    for(let q = 0; q < half; q++){
      const band = q * 2, y = by + room - (q + 0.5) * pitch;
      const lvl = pair(barV, band), peak = pair(barCap, band), hit = Math.max(barGlow(band), barGlow(band + 1));
      put(0, y, 1, 0, h, bx, lvl, peak, hit); put(W, y, -1, 0, h, bx, lvl, peak, hit);
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
const ripples = [];            // start times of the rings that spread out from the outline on a kick
let lastAngle = 0;
let gx = 0, gy = 0, grx = 0, gry = 0;                      // the oval as last drawn, for placing sparks

/* sparks thrown outward on a kick: a small fixed pool, oldest overwritten first */
const SPARKS = 160;
const SX = new Float32Array(SPARKS), SY = new Float32Array(SPARKS), SVX = new Float32Array(SPARKS), SVY = new Float32Array(SPARKS),
      SLIFE = new Float32Array(SPARKS), STTL = new Float32Array(SPARKS);
let sparkNext = 0, sparksAlive = 0, lastNow = 0;
function throwSparks(a){
  if(!grx) return;
  const unit = Math.min(grx, gry);
  for(let n = 0; n < 22; n++){
    const th = a + (Math.random() - 0.5) * 0.8, c = Math.cos(th), s = Math.sin(th), m = edgeAt(th);
    let nx = c / grx, ny = s / gry; const k = 1 / Math.sqrt(nx * nx + ny * ny); nx *= k; ny *= k;
    const v = unit * (0.5 + Math.random() * 0.9), side = (Math.random() - 0.5) * unit * 0.35, i = sparkNext;
    sparkNext = (sparkNext + 1) % SPARKS;
    SX[i] = gx + grx * m * c; SY[i] = gy + gry * m * s; SVX[i] = nx * v - ny * side; SVY[i] = ny * v + nx * side;
    STTL[i] = SLIFE[i] = 0.45 + Math.random() * 0.45;
  }
}
onHit((zone, i) => {
  if(i !== 0 || S.frameStyle === "off" || S.frameShape === "rect") return;
  let a = Math.random() * TAU;
  if(Math.cos(a - lastAngle) > 0.5) a += 2.2;             // not the same side twice running
  lastAngle = a;
  if(S.frameShape === "blob"){ bulges.push({a, t0: performance.now()}); if(bulges.length > 8) bulges.shift(); }
  if(S.fx){ ripples.push(performance.now()); if(ripples.length > 4) ripples.shift(); throwSparks(a); }
});
/* test hook */
export function frameState(){ return {bulges: bulges.length, ripples: ripples.length, sparks: sparksAlive}; }

/* `room` is how far the outline may grow (as a fraction of the radius) and still stay on the screen. */
function shapeEdge(now, room){
  if(S.frameShape !== "blob"){ edge.fill(1); return; }
  while(bulges.length && now - bulges[0].t0 > 2600) bulges.shift();
  const t = now / 1000, n = bulges.length;
  for(let b = 0; b < n; b++){ const age = (now - bulges[b].t0) / 1000; bulges[b].amp = 0.75 * (1 - Math.exp(-age / 0.045)) * Math.exp(-age / 0.42); }
  /* the other zones move it too, more gently: the whole shape breathes with the kick, a snare raises
     five broad lobes, hats put a fine shimmer on the edge */
  const breathe = 0.12 * DET[0].env, snare = DET[1] ? 0.12 * DET[1].env : 0, hat = DET[2] ? 0.07 * DET[2].env : 0;
  for(let i = 0; i < PTS; i++){
    const th = i / PTS * TAU;
    let f = 0.25 * (0.5 + 0.3 * Math.sin(2 * th + t * 0.55) + 0.2 * Math.sin(3 * th - t * 0.4));     // slow drift, always there
    f += breathe + snare * (0.5 + 0.5 * Math.sin(5 * th - t * 3)) + hat * (0.5 + 0.5 * Math.sin(14 * th + t * 11));
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
  /* where the blob has bulged out it has used up some of the border, so the bars there get shorter
     instead of running off the screen */
  const left = Math.max(reach * 0.3, reach - (m - 1) * Math.min(rx, ry));
  put(cx + rx * m * c + nx * gap, cy + ry * m * s + ny * gap, nx, ny, width, left, barV[band], barCap[band], barGlow(band));
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

/* ---------- the graph, in a form that fits an oval or blob ---------- */
/* On a rectangle the graph is a rectangle along the bottom (hud.js). On an oval or blob that looks out
   of place, so the graph drawn here instead is the spectrum curve, running round the inside of the edge
   and following it as the blob moves: lows at the bottom, highs at the top, the same on both sides.
   There are no LED bars inside the shape: the bars outside it are the only bars. */
const FONT = '"MS Gothic","Osaka-Mono","DotGothic16",Consolas,"Courier New",monospace';
const GHOST = ["rgba(217,102,126,.75)", "rgba(190,150,158,.45)", "rgba(150,150,150,.3)"];

/* The spectrum curve as a closed line inside the edge: the louder a frequency, the further it leans in. */
const TH = new Float32Array(N), THC = new Float32Array(N), THS = new Float32Array(N);
for(let i = 0; i < N; i++){ TH[i] = Math.PI / 2 - (i + 0.5) / N * Math.PI; THC[i] = Math.cos(TH[i]); THS[i] = Math.sin(TH[i]); }
let ptx = 0, pty = 0;
function inPoint(cx, cy, rx, ry, c, s, th, inset){
  const m = edgeAt(th); let nx = c / rx, ny = s / ry; const k = inset / Math.sqrt(nx * nx + ny * ny);
  ptx = cx + rx * m * c - nx * k; pty = cy + ry * m * s - ny * k;
}
/* adds one closed loop to the current path: up the right side from the lows to the highs, back down the left */
function loop(arr, cx, cy, rx, ry, gap, depth){
  for(let i = 0; i < N; i++){ inPoint(cx, cy, rx, ry, THC[i], THS[i], TH[i], gap + (arr ? arr[i] * depth : 0)); if(i) g.lineTo(ptx, pty); else g.moveTo(ptx, pty); }
  for(let i = N - 1; i >= 0; i--){ inPoint(cx, cy, rx, ry, -THC[i], THS[i], Math.PI - TH[i], gap + (arr ? arr[i] * depth : 0)); g.lineTo(ptx, pty); }
  g.closePath();
}
function innerCurve(cx, cy, rx, ry, gap, depth, lw, W){
  g.lineJoin = "round";
  g.beginPath(); loop(null, cx, cy, rx, ry, gap, depth); loop(cur, cx, cy, rx, ry, gap, depth);
  g.fillStyle = "rgba(217,102,126,.26)"; g.fill("evenodd");                            // the body, between the edge and the curve
  for(let h = hist.length - 1; h >= 0; h--){ g.beginPath(); loop(hist[h], cx, cy, rx, ry, gap, depth); g.strokeStyle = GHOST[h]; g.lineWidth = lw * 1.4; g.stroke(); }
  g.beginPath(); loop(cur, cx, cy, rx, ry, gap, depth);
  if(S.glow){ g.globalCompositeOperation = "lighter"; g.strokeStyle = "rgba(217,102,126,.22)"; g.lineWidth = lw * 9; g.stroke(); g.globalCompositeOperation = "source-over"; }
  else { g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = lw * 5; g.stroke(); }
  g.strokeStyle = "#fff"; g.lineWidth = lw * 2.4; g.stroke();

  /* the two strongest notes: a dot on the curve and plain text beside it (no boxes), one on each side */
  const f = W / 1280, unit = Math.min(rx, ry);
  g.textAlign = "center"; g.textBaseline = "middle";
  for(let n = 0; n < labels.length; n++){
    const L = labels[n];
    L.ra = (L.ra || 0) + ((L.on ? 1 : 0) - (L.ra || 0)) * 0.12;
    if(L.on) L.ri = (L.ri === undefined || L.ra < 0.05) ? L.ti : L.ri + (L.ti - L.ri) * 0.18;
    if(L.ra < 0.03 || !L.txt || L.ri === undefined) continue;
    const i = Math.max(0, Math.min(N - 1, Math.round(L.ri))), left = n === 0;
    const c = left ? -THC[i] : THC[i], th = left ? Math.PI - TH[i] : TH[i], at = gap + cur[i] * depth;
    inPoint(cx, cy, rx, ry, c, THS[i], th, at); const ax = ptx, ay = pty;
    inPoint(cx, cy, rx, ry, c, THS[i], th, at + unit * 0.13);
    g.globalAlpha = L.ra;
    g.strokeStyle = ROSE; g.lineWidth = lw * 1.4; g.beginPath(); g.moveTo(ax, ay); g.lineTo((ax + ptx) / 2, (ay + pty) / 2); g.stroke();
    g.fillStyle = ROSE; g.beginPath(); g.arc(ax, ay, lw * 4, 0, TAU); g.fill();
    g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 4 * f;
    g.font = (26 * f) + "px " + FONT; g.strokeText(L.txt, ptx, pty); g.fillStyle = PALE; g.fillText(L.txt, ptx, pty);
    g.font = (13 * f) + "px " + FONT; g.strokeText(L.hz, ptx, pty + 22 * f); g.fillStyle = "rgba(243,233,234,.75)"; g.fillText(L.hz, ptx, pty + 22 * f);
  }
  g.globalAlpha = 1;
}

/* rings that spread out from the outline after a kick and fade */
function drawRipples(now, cx, cy, rx, ry, lw){
  while(ripples.length && now - ripples[0] > 900) ripples.shift();
  if(!ripples.length) return;
  g.globalCompositeOperation = "lighter"; g.strokeStyle = ROSE;
  for(let r = 0; r < ripples.length; r++){
    const p = (now - ripples[r]) / 900, grow = 1 + 0.16 * (1 - (1 - p) * (1 - p));
    g.save(); g.translate(cx, cy); g.scale(grow, grow); g.translate(-cx, -cy); outline(cx, cy, rx, ry); g.restore();
    g.globalAlpha = 0.5 * (1 - p) * (1 - p); g.lineWidth = lw * (1 + 5 * (1 - p)); g.stroke();
  }
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
}
function drawSparks(dt, lw){
  sparksAlive = 0;
  g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineWidth = lw * 2.2; g.strokeStyle = PALE;
  const drag = Math.pow(0.045, dt);                       // a spark loses nearly all its speed within a second
  for(let i = 0; i < SPARKS; i++){
    if(SLIFE[i] <= 0) continue;
    SLIFE[i] -= dt; if(SLIFE[i] <= 0) continue;
    SVX[i] *= drag; SVY[i] *= drag; SX[i] += SVX[i] * dt; SY[i] += SVY[i] * dt;
    const a = SLIFE[i] / STTL[i];
    g.globalAlpha = a * a;
    g.beginPath(); g.moveTo(SX[i], SY[i]); g.lineTo(SX[i] - SVX[i] * 0.04, SY[i] - SVY[i] * 0.04); g.stroke();
    sparksAlive++;
  }
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.lineCap = "butt";
}

/* ---------- once per frame ---------- */
export function drawFrame(now){
  const W = frameCv.width, H = frameCv.height, style = S.frameStyle, shape = S.frameShape;
  const bx = style === "off" ? 0 : Math.round(W * S.frameX / 100), by = style === "off" ? 0 : Math.round(H * S.frameY / 100);
  const key = [style, shape, bx, by, W, H, S.sizeGen, S.glow].join("|"), changed = key !== drawn;
  if(changed){ drawn = key; g.clearRect(0, 0, W, H); }
  if(style === "off") return;
  if(!S.fx && (ripples.length || sparksAlive)){ ripples.length = 0; SLIFE.fill(0); sparksAlive = 0; }
  const busy = shape !== "rect" && (ripples.length > 0 || sparksAlive > 0);
  const graphHere = shape !== "rect" && S.hudOn;                      // the curved graph is drawn on this canvas
  if(style === "solid" && shape !== "blob" && !changed && !busy && !graphHere) return;      // nothing moves: keep what is drawn
  if(busy) drawn = "";                                                // repaint once more after the last spark has gone
  const lw = Math.max(1, Math.round(W / 960)), kick = style === "pulse" ? DET[0].env : 0;

  if(shape === "rect"){
    if(!bx && !by) return;
    g.fillStyle = BLACK; strips(W, H, bx, by);          // the opaque base is what hides the clip's own border
    if(style === "bars"){ layoutEdges(W, H, bx, by); paintBars(); }
    else if(kick > 0.02){ g.fillStyle = ROSE; g.globalAlpha = 0.7 * kick; strips(W, H, bx, by); g.globalAlpha = 1; }
    /* a thin line where the border meets the picture, with a soft halo when glow is on */
    const x = bx - lw / 2, y = by - lw / 2, w = W - 2*bx + lw, h = H - 2*by + lw;
    if(S.glow){
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(217,102,126,.09)"; g.lineWidth = lw * 12; g.strokeRect(x, y, w, h);
      g.strokeStyle = "rgba(217,102,126,.16)"; g.lineWidth = lw * 5; g.strokeRect(x, y, w, h);
      g.globalCompositeOperation = "source-over";
    }
    g.strokeStyle = "rgba(217,102,126,.6)"; g.lineWidth = lw; g.strokeRect(x, y, w, h);
    return;
  }

  /* oval or blob: black everywhere, with a hole the shape of the picture */
  const cx = W / 2, cy = H / 2, rx = Math.max(10, W / 2 - bx), ry = Math.max(10, H / 2 - by);
  const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
  gx = cx; gy = cy; grx = rx; gry = ry;
  shapeEdge(now, Math.min(bx / rx, by / ry));
  g.fillStyle = BLACK; g.fillRect(0, 0, W, H);
  outline(cx, cy, rx, ry);
  g.globalCompositeOperation = "destination-out"; g.fill();
  g.globalCompositeOperation = "source-over";
  if(S.glow){
    /* a soft dark rim just inside the edge, so the picture seems to sit behind the border */
    g.strokeStyle = "rgba(0,0,0,.10)"; g.lineWidth = lw * 44; g.stroke();
    g.strokeStyle = "rgba(0,0,0,.14)"; g.lineWidth = lw * 24; g.stroke();
    g.strokeStyle = "rgba(0,0,0,.20)"; g.lineWidth = lw * 10; g.stroke();
  }
  if(style === "bars"){ layoutRing(cx, cy, rx, ry, Math.min(bx, by) || Math.min(W, H) * 0.04, lw * 3); paintBars(); }
  if(graphHere) innerCurve(cx, cy, rx, ry, lw * 14, Math.min(rx, ry) * 0.24, lw, W);
  if(S.fx){ drawRipples(now, cx, cy, rx, ry, lw); drawSparks(dt, lw); }
  /* the outline itself: a soft halo when glow is on, then a line that swells on the kick in pulse style */
  outline(cx, cy, rx, ry);
  g.strokeStyle = ROSE;
  if(S.glow){
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.10 + 0.2 * kick; g.lineWidth = lw * 12; g.stroke();
    g.globalAlpha = 0.18 + 0.3 * kick; g.lineWidth = lw * 5; g.stroke();
    g.globalCompositeOperation = "source-over";
  }
  g.globalAlpha = 0.75 + 0.25 * kick; g.lineWidth = lw * (1.5 + 10 * kick); g.stroke();
  g.globalAlpha = 1;
}

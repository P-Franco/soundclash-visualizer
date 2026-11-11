/* Border: what the app draws around the picture. Clips come with all sorts of borders baked in, and a
   projector throws a plain rectangle; this covers the edges with pure black (no light from a projector)
   and can give the picture another outline altogether.

   Shape of the picture: a rectangle, an oval, or a blob (an oval whose outline drifts slowly and bulges
   out in a different direction on each kick).
   Style: solid, bars that move with the music, or a pulse on the kick.

   What to draw comes from the look (look.js), which holds the shape, the style and the widths as numbers
   that can slide. That is what lets one border turn smoothly into another in show mode: a rectangle
   rounds off into an oval, the widths glide, bars and pulse fade in and out.

   It has its own canvas, above the video and the MilkDrop layer and below the graph. A settled rectangle
   only paints its border strips. Everything else paints the canvas black and cuts a hole in it.
   No shadowBlur anywhere: this runs every frame. Glow is built from a few wide, faint strokes instead. */
import { frameCv } from "./dom.js";
import { S } from "./state.js";
import { L } from "./look.js";
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
/* A is how much of the bars shows, 0..1 (they fade in and out when the show changes style). */
function paintBars(A){
  const rich = S.glow;
  if(rich){
    /* 1. glow: two wide, faint, round-ended strokes under each bar, added like light: a broad dim one and a
       tighter brighter one, so the light falls off softly. Quiet bars glow little; a zone hit flares it. */
    g.globalCompositeOperation = "lighter"; g.lineCap = "round";
    for(let i = 0; i < count; i++){
      const a = (0.02 + LVL[i] * (0.11 + 0.2 * HIT[i])) * A, len = Math.max(2, LVL[i] * REACH[i]);   // a hit flares long bars, not stubs
      g.strokeStyle = barInk(LVL[i]);
      g.globalAlpha = a * 0.55; g.lineWidth = WID[i] * 3.4; line(i, 0, len);
      g.globalAlpha = a; g.lineWidth = WID[i] * 1.9; line(i, 0, len);
    }
    g.globalCompositeOperation = "source-over"; g.lineCap = "butt";
  }
  /* 2. the bar itself, cut into LED segments when detail is on */
  g.globalAlpha = A;
  let lastW = -1;
  for(let i = 0; i < count; i++){
    if(rich && WID[i] !== lastW){ lastW = WID[i]; DASH[0] = Math.max(3, lastW * 0.45); DASH[1] = DASH[0] * 0.4; g.setLineDash(DASH); }
    g.strokeStyle = barInk(LVL[i]); g.lineWidth = WID[i];
    line(i, 0, Math.max(2, LVL[i] * REACH[i]));
  }
  if(!rich){ g.globalAlpha = 1; return; }
  g.setLineDash(NO_DASH);
  /* 3. a bright line down the middle of each bar, brighter on a hit */
  g.strokeStyle = "#fff";
  for(let i = 0; i < count; i++){
    g.globalAlpha = (0.2 + 0.6 * HIT[i]) * A; g.lineWidth = Math.max(1, WID[i] * 0.2);
    line(i, 0, Math.max(2, LVL[i] * REACH[i]));
  }
  /* 4. a peak marker that hangs above the bar and falls back slowly */
  g.globalAlpha = 0.75 * A;
  for(let i = 0; i < count; i++){
    const at = Math.max(PEAK[i], LVL[i]) * REACH[i] + WID[i] * 0.4;
    g.lineWidth = WID[i] * 0.8; line(i, at, at + Math.max(2, WID[i] * 0.2));
  }
  g.globalAlpha = 1;
}

/* ---------- a settled rectangle ---------- */
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

/* ---------- any other shape: oval, blob, and everything on the way between them and a rectangle ---------- */
/* The picture's outline is a "superellipse": one formula that is an oval at one end and a rectangle at the
   other, with a rounded-off rectangle in between. shapeE picks where on that scale it sits:
   1 = oval, toward 0 = toward a rectangle. The outline is sampled at PTS angles.
   UX/UY hold the unit shape at those angles; edge[i] is how far out the outline sits there as a multiple
   of the plain shape (1 everywhere unless the blob is moving it). */
const PTS = 120, TAU = Math.PI * 2;
const edge = new Float32Array(PTS).fill(1), COS = new Float32Array(PTS), SIN = new Float32Array(PTS),
      UX = new Float32Array(PTS), UY = new Float32Array(PTS);
for(let i = 0; i < PTS; i++){ COS[i] = Math.cos(i / PTS * TAU); SIN[i] = Math.sin(i / PTS * TAU); UX[i] = COS[i]; UY[i] = SIN[i]; }
let shapeE = 1;
function setShape(sq){
  shapeE = sq <= 0 ? 1 : 1 / Math.pow(70, sq);                      // squareness 0..1 -> exponent 2 (oval) .. 140 (as good as square)
  for(let i = 0; i < PTS; i++){
    if(shapeE === 1){ UX[i] = COS[i]; UY[i] = SIN[i]; continue; }
    const pc = Math.pow(Math.abs(COS[i]), shapeE), ps = Math.pow(Math.abs(SIN[i]), shapeE);
    UX[i] = COS[i] < 0 ? -pc : pc; UY[i] = SIN[i] < 0 ? -ps : ps;
  }
}
/* The point of the unit shape at the angle whose cosine and sine are c and s, and which way is "out"
   there for an rx by ry picture. Results land in ux, uy (point) and unx, uny (unit normal). */
let ux = 0, uy = 0, unx = 0, uny = 0;
function rim(c, s, rx, ry){
  if(shapeE === 1){ ux = c; uy = s; unx = c / rx; uny = s / ry; }
  else{
    const ac = Math.abs(c), as = Math.abs(s), pc = Math.pow(ac, shapeE), ps = Math.pow(as, shapeE);
    ux = c < 0 ? -pc : pc; uy = s < 0 ? -ps : ps;
    const qc = pc > 0 ? ac * ac / pc : 0, qs = ps > 0 ? as * as / ps : 0;
    unx = (c < 0 ? -qc : qc) / rx; uny = (s < 0 ? -qs : qs) / ry;
  }
  const k = 1 / (Math.sqrt(unx * unx + uny * uny) || 1); unx *= k; uny *= k;
}

/* each kick starts a bulge at a new angle; it swells fast and relaxes over about a second */
const bulges = [];             // {a: angle, t0: performance.now() when it started}
const ripples = [];            // start times of the rings that spread out from the outline on a kick
let lastAngle = 0;
let gx = 0, gy = 0, grx = 0, gry = 0;                      // the picture as last drawn, for placing sparks

/* sparks thrown outward on a kick: a small fixed pool, oldest overwritten first */
const SPARKS = 160;
const SX = new Float32Array(SPARKS), SY = new Float32Array(SPARKS), SVX = new Float32Array(SPARKS), SVY = new Float32Array(SPARKS),
      SLIFE = new Float32Array(SPARKS), STTL = new Float32Array(SPARKS);
let sparkNext = 0, sparksAlive = 0, lastNow = 0;
function throwSparks(a){
  if(!grx) return;
  const unit = Math.min(grx, gry);
  for(let n = 0; n < 22; n++){
    const th = a + (Math.random() - 0.5) * 0.8, m = edgeAt(th);
    rim(Math.cos(th), Math.sin(th), grx, gry);
    const v = unit * (0.5 + Math.random() * 0.9), side = (Math.random() - 0.5) * unit * 0.35, i = sparkNext;
    sparkNext = (sparkNext + 1) % SPARKS;
    SX[i] = gx + grx * m * ux; SY[i] = gy + gry * m * uy; SVX[i] = unx * v - uny * side; SVY[i] = uny * v + unx * side;
    STTL[i] = SLIFE[i] = 0.45 + Math.random() * 0.45;
  }
}
onHit((zone, i) => {
  if(i !== 0 || L.on < 0.5 || L.sq > 0.5) return;        // kicks only, and only on a round picture
  let a = Math.random() * TAU;
  if(Math.cos(a - lastAngle) > 0.5) a += 2.2;             // not the same side twice running
  lastAngle = a;
  if(L.blob > 0.3){ bulges.push({a, t0: performance.now()}); if(bulges.length > 8) bulges.shift(); }
  if(S.fx){ ripples.push(performance.now()); if(ripples.length > 4) ripples.shift(); throwSparks(a); }
});
/* test hook */
export function frameState(){ return {bulges: bulges.length, ripples: ripples.length, sparks: sparksAlive}; }

/* `room` is how far the outline may grow (as a fraction of the radius) and still stay on the screen;
   it is already scaled by how much blob there is. */
function shapeEdge(now, room){
  if(!(room > 0)){ edge.fill(1); return; }
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
/* The outline as a path: a true ellipse when it is one, otherwise a smooth curve through the sampled points. */
function outline(cx, cy, rx, ry){
  g.beginPath();
  if(shapeE === 1 && L.blob <= 0){ g.ellipse(cx, cy, rx, ry, 0, 0, TAU); return; }
  let qx = cx + rx * edge[0] * UX[0], qy = cy + ry * edge[0] * UY[0];
  const lx = cx + rx * edge[PTS-1] * UX[PTS-1], ly = cy + ry * edge[PTS-1] * UY[PTS-1];
  g.moveTo((lx + qx) / 2, (ly + qy) / 2);
  for(let i = 1; i <= PTS; i++){
    const k = i % PTS, nx = cx + rx * edge[k] * UX[k], ny = cy + ry * edge[k] * UY[k];
    g.quadraticCurveTo(qx, qy, (qx + nx) / 2, (qy + ny) / 2);
    qx = nx; qy = ny;
  }
  g.closePath();
}
/* Bars all the way round, each standing straight out from the outline: lows at the bottom, highs at
   the top, the same on both sides. */
function ringBar(cx, cy, rx, ry, th, gap, width, reach, band){
  const m = edgeAt(th);
  rim(Math.cos(th), Math.sin(th), rx, ry);
  /* where the blob has bulged out it has used up some of the border, so the bars there get shorter
     instead of running off the screen */
  const left = Math.max(reach * 0.3, reach - (m - 1) * Math.min(rx, ry));
  put(cx + rx * m * ux + unx * gap, cy + ry * m * uy + uny * gap, unx, uny, width, left, barV[band], barCap[band], barGlow(band));
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

/* ---------- the graph, in a form that fits a round picture ---------- */
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
  const m = edgeAt(th);
  rim(c, s, rx, ry);
  ptx = cx + rx * m * ux - unx * inset; pty = cy + ry * m * uy - uny * inset;
}
/* adds one closed loop to the current path: up the right side from the lows to the highs, back down the left */
function loop(arr, cx, cy, rx, ry, gap, depth){
  for(let i = 0; i < N; i++){ inPoint(cx, cy, rx, ry, THC[i], THS[i], TH[i], gap + (arr ? arr[i] * depth : 0)); if(i) g.lineTo(ptx, pty); else g.moveTo(ptx, pty); }
  for(let i = N - 1; i >= 0; i--){ inPoint(cx, cy, rx, ry, -THC[i], THS[i], Math.PI - TH[i], gap + (arr ? arr[i] * depth : 0)); g.lineTo(ptx, pty); }
  g.closePath();
}
/* A is how visible the graph is, 0..1 (it fades in and out in show mode). */
function innerCurve(cx, cy, rx, ry, gap, depth, lw, W, A){
  g.lineJoin = "round"; g.globalAlpha = A;
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
    const lab = labels[n];
    lab.ra = (lab.ra || 0) + ((lab.on ? 1 : 0) - (lab.ra || 0)) * 0.12;
    if(lab.on) lab.ri = (lab.ri === undefined || lab.ra < 0.05) ? lab.ti : lab.ri + (lab.ti - lab.ri) * 0.18;
    if(lab.ra < 0.03 || !lab.txt || lab.ri === undefined) continue;
    const i = Math.max(0, Math.min(N - 1, Math.round(lab.ri))), left = n === 0;
    const c = left ? -THC[i] : THC[i], th = left ? Math.PI - TH[i] : TH[i], at = gap + cur[i] * depth;
    inPoint(cx, cy, rx, ry, c, THS[i], th, at); const ax = ptx, ay = pty;
    inPoint(cx, cy, rx, ry, c, THS[i], th, at + unit * 0.13);
    g.globalAlpha = lab.ra * A;
    g.strokeStyle = ROSE; g.lineWidth = lw * 1.4; g.beginPath(); g.moveTo(ax, ay); g.lineTo((ax + ptx) / 2, (ay + pty) / 2); g.stroke();
    g.fillStyle = ROSE; g.beginPath(); g.arc(ax, ay, lw * 4, 0, TAU); g.fill();
    g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 4 * f;
    g.font = (26 * f) + "px " + FONT; g.strokeText(lab.txt, ptx, pty); g.fillStyle = PALE; g.fillText(lab.txt, ptx, pty);
    g.font = (13 * f) + "px " + FONT; g.strokeText(lab.hz, ptx, pty + 22 * f); g.fillStyle = "rgba(243,233,234,.75)"; g.fillText(lab.hz, ptx, pty + 22 * f);
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
  const W = frameCv.width, H = frameCv.height, on = L.on > 0.004;
  const bx = on ? Math.round(W * L.x / 100) : 0, by = on ? Math.round(H * L.y / 100) : 0;
  const key = [on, bx, by, W, H, S.sizeGen, S.glow, L.sq, L.blob, L.bars, L.pulse].join("|"), changed = key !== drawn;
  if(changed){ drawn = key; g.clearRect(0, 0, W, H); }
  if(!on) return;
  if(!S.fx && (ripples.length || sparksAlive)){ ripples.length = 0; SLIFE.fill(0); sparksAlive = 0; }
  const plainRect = L.sq === 1 && L.blob === 0;                        // settled on a rectangle: the cheap path
  const busy = !plainRect && (ripples.length > 0 || sparksAlive > 0);
  const round = (1 - L.sq) * (1 - L.sq);                               // how much of the round-picture extras apply
  const graphA = L.graph * Math.max(0, 1 - 2 * L.sq);                  // the curved graph is drawn on this canvas
  if(!changed && !busy && L.bars === 0 && L.pulse === 0 && L.blob === 0 && graphA === 0) return;   // nothing moves: keep what is drawn
  if(busy) drawn = "";                                                // repaint once more after the last spark has gone
  const lw = Math.max(1, Math.round(W / 960)), kick = DET[0].env * L.pulse;

  if(plainRect){
    if(!bx && !by) return;
    g.fillStyle = BLACK; strips(W, H, bx, by);          // the opaque base is what hides the clip's own border
    if(L.bars > 0){ layoutEdges(W, H, bx, by); paintBars(L.bars); }
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

  /* any other shape: black everywhere, with a hole the shape of the picture */
  const cx = W / 2, cy = H / 2, rx = Math.max(10, W / 2 - bx), ry = Math.max(10, H / 2 - by);
  const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
  gx = cx; gy = cy; grx = rx; gry = ry;
  setShape(L.sq);
  shapeEdge(now, Math.min(bx / rx, by / ry) * L.blob);
  g.fillStyle = BLACK; g.fillRect(0, 0, W, H);
  outline(cx, cy, rx, ry);
  g.globalCompositeOperation = "destination-out"; g.fill();
  g.globalCompositeOperation = "source-over";
  if(S.glow && round > 0.004){
    /* a soft dark rim just inside the edge, so the picture seems to sit behind the border */
    g.globalAlpha = round;
    g.strokeStyle = "rgba(0,0,0,.10)"; g.lineWidth = lw * 44; g.stroke();
    g.strokeStyle = "rgba(0,0,0,.14)"; g.lineWidth = lw * 24; g.stroke();
    g.strokeStyle = "rgba(0,0,0,.20)"; g.lineWidth = lw * 10; g.stroke();
    g.globalAlpha = 1;
  }
  if(L.bars * round > 0.004){ layoutRing(cx, cy, rx, ry, Math.min(bx, by) || Math.min(W, H) * 0.04, lw * 3); paintBars(L.bars * round); }
  if(graphA > 0.004) innerCurve(cx, cy, rx, ry, lw * 14, Math.min(rx, ry) * 0.24, lw, W, graphA);
  if(S.fx){ drawRipples(now, cx, cy, rx, ry, lw); drawSparks(dt, lw); }
  /* the outline itself: a soft halo when glow is on, then a line that swells on the kick in pulse style.
     Its weight eases toward the rectangle's thinner line as the picture squares off. */
  outline(cx, cy, rx, ry);
  g.strokeStyle = ROSE;
  if(S.glow){
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.10 - 0.01 * L.sq + 0.2 * kick; g.lineWidth = lw * 12; g.stroke();
    g.globalAlpha = 0.18 - 0.02 * L.sq + 0.3 * kick; g.lineWidth = lw * 5; g.stroke();
    g.globalCompositeOperation = "source-over";
  }
  g.globalAlpha = Math.min(1, 0.75 - 0.15 * L.sq + 0.25 * kick); g.lineWidth = lw * (1.5 - 0.5 * L.sq + 10 * kick); g.stroke();
  g.globalAlpha = 1;
}

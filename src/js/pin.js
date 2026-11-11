/* Corner pin: square the picture up when the projector is not straight in front of the wall.

   A projector hung high, or off to one side, throws a lopsided picture. Instead of a lens, the picture
   is bent the opposite way before it leaves the computer: each of its four corners is moved to where it
   needs to be, and everything in between follows (a "homography"). The whole stage is one element, so one
   CSS matrix3d bends the video, the MilkDrop layer, the border and the graph together, on the GPU.

   Calibration: a grid of true squares and a circle are drawn over the picture, and the four corners can
   be dragged, or picked with 1 to 4 and nudged with the arrow keys, until the grid looks square on the
   wall. The corners are saved (scv_pin), so it is done once per venue.

   Two things software cannot fix: the bent picture uses fewer of the projector's pixels, and at a steep
   angle one side will be a little soft, because a lens focuses at one distance. */
import { $, hud } from "./dom.js";
import { S } from "./state.js";
import { store, bindCheck } from "./store.js";

const stage = $("stage"), ui = $("pinUI"), grid = $("pin");
const START = [[0, 0], [1, 0], [1, 1], [0, 1]];          // top left, top right, bottom right, bottom left, as fractions of the window
let pts = START.map(p => p.slice());
let editing = false, sel = 0;

/* Corners must still make a sensible picture: not folded over itself, not squashed to nothing. */
function usable(q){
  let twice = 0;
  for(let i = 0; i < 4; i++){
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    if((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0.002) return false;     // every corner must still turn the same way
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2 > 0.05;                                                                       // at least a twentieth of the screen
}

/* The CSS matrix that sends the stage's own corners to the four chosen points. */
function matrix(){
  const W = innerWidth, H = innerHeight;
  const x0 = pts[0][0] * W, y0 = pts[0][1] * H, x1 = pts[1][0] * W, y1 = pts[1][1] * H,
        x2 = pts[2][0] * W, y2 = pts[2][1] * H, x3 = pts[3][0] * W, y3 = pts[3][1] * H;
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  if(!det) return "";
  const g = (sx * dy2 - dx2 * sy) / det, h = (dx1 * sy - sx * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  /* matrix3d is written column by column; the third row and column are the unused depth axis */
  const m = [a / W, d / W, 0, g / W,   b / H, e / H, 0, h / H,   0, 0, 1, 0,   x0, y0, 0, 1];
  return "matrix3d(" + m.map(v => +v.toFixed(10)).join(",") + ")";
}

function apply(){
  const moved = pts.some((p, i) => Math.abs(p[0] - START[i][0]) > 1e-6 || Math.abs(p[1] - START[i][1]) > 1e-6);
  const on = S.pinOn && moved;
  stage.style.transformOrigin = "0 0";
  stage.style.transform = on ? matrix() : "";
  document.body.classList.toggle("pinned", on);          // outside the bent picture the page goes pure black: no light from the projector
}

/* ---------- calibration ---------- */
const handles = Array.from(ui.querySelectorAll(".pinH"));
function place(){
  const W = innerWidth, H = innerHeight;
  handles.forEach((el, i) => {
    /* the handle is drawn a little inside the screen so a corner that sits right on the edge can still be grabbed */
    el.style.left = Math.max(24, Math.min(W - 24, pts[i][0] * W)) + "px";
    el.style.top = Math.max(24, Math.min(H - 24, pts[i][1] * H)) + "px";
    el.classList.toggle("sel", i === sel);
  });
}
/* Move corner i by a fraction of the window. A move that would fold or flatten the picture is ignored. */
function move(i, dx, dy){
  const q = pts.map(p => p.slice());
  q[i][0] = Math.max(0, Math.min(1, q[i][0] + dx)); q[i][1] = Math.max(0, Math.min(1, q[i][1] + dy));
  if(!usable(q)) return;
  pts = q;
  store.set("pin", JSON.stringify(pts));
  apply(); place();
}
/* The test pattern. It is drawn on the stage, so it is bent along with everything else: what looks square
   and round on the wall is what the picture will look like. Cells are true squares whatever the window shape. */
function drawGrid(){
  grid.width = hud.width; grid.height = hud.height;
  const c = grid.getContext("2d"), W = grid.width, H = grid.height, u = W / 1280, cell = H / 9;
  c.clearRect(0, 0, W, H);
  c.fillStyle = "rgba(0,0,0,.62)"; c.fillRect(0, 0, W, H);
  c.strokeStyle = "rgba(243,233,234,.5)"; c.lineWidth = 1.5 * u;
  c.beginPath();
  for(let x = W / 2 % cell; x < W; x += cell){ c.moveTo(x, 0); c.lineTo(x, H); }
  for(let y = H / 2 % cell; y < H; y += cell){ c.moveTo(0, y); c.lineTo(W, y); }
  c.stroke();
  c.strokeStyle = "#d9667e"; c.lineWidth = 2.5 * u;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(W, H); c.moveTo(W, 0); c.lineTo(0, H);
  c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
  c.beginPath(); c.arc(W / 2, H / 2, cell * 3.5, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = "#fff"; c.lineWidth = 6 * u; c.strokeRect(3 * u, 3 * u, W - 6 * u, H - 6 * u);
  c.fillStyle = "#fff"; c.font = (44 * u) + 'px "MS Gothic",Consolas,monospace'; c.textBaseline = "middle"; c.textAlign = "center";
  [[1, 1], [W / cell - 1, 1], [W / cell - 1, 8], [1, 8]].forEach((p, i) => c.fillText(String(i + 1), p[0] * cell, p[1] * cell));
}

/* Open or close calibration. With no argument it toggles. */
export function editPin(on){
  editing = on === undefined ? !editing : !!on;
  if(editing && !S.pinOn){ $("pinOn").checked = true; $("pinOn").dispatchEvent(new Event("change")); }
  ui.hidden = !editing;
  grid.style.display = editing ? "block" : "none";
  document.body.classList.toggle("pinning", editing);     // the drawer stays out of the way while the corners are being set
  if(editing){ drawGrid(); place(); }
}
function reset(){
  pts = START.map(p => p.slice());
  store.set("pin", JSON.stringify(pts));
  apply(); place();
}

export function initPin(){
  try{
    const v = JSON.parse(store.get("pin", "null"));
    if(Array.isArray(v) && v.length === 4 && v.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === "number" && n >= 0 && n <= 1)) && usable(v)) pts = v;
  }catch(e){}
  bindCheck("pinOn", "pinOn", v => { S.pinOn = v; apply(); if(!v && editing) editPin(false); });

  $("pinEdit").addEventListener("click", () => editPin(true));
  $("pinDone").addEventListener("click", () => editPin(false));
  $("pinReset").addEventListener("click", reset);
  $("pinReset2").addEventListener("click", reset);

  handles.forEach((el, i) => {
    let last = null;
    el.addEventListener("pointerdown", e => { sel = i; last = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); place(); e.preventDefault(); });
    el.addEventListener("pointermove", e => {
      if(!last) return;
      move(i, (e.clientX - last[0]) / innerWidth, (e.clientY - last[1]) / innerHeight);
      last = [e.clientX, e.clientY];
    });
    const up = () => { last = null; };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  });

  /* keys, only while calibrating: 1 to 4 or Tab pick a corner, arrows nudge it a pixel (ten with Shift), Enter finishes */
  addEventListener("keydown", e => {
    if(!editing || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 10 : 1;
    if(e.key === "ArrowLeft") move(sel, -step / innerWidth, 0);
    else if(e.key === "ArrowRight") move(sel, step / innerWidth, 0);
    else if(e.key === "ArrowUp") move(sel, 0, -step / innerHeight);
    else if(e.key === "ArrowDown") move(sel, 0, step / innerHeight);
    else if(e.key >= "1" && e.key <= "4"){ sel = +e.key - 1; place(); }
    else if(e.key === "Tab"){ sel = (sel + (e.shiftKey ? 3 : 1)) % 4; place(); }
    else if(e.key === "Enter") editPin(false);
    else return;
    e.preventDefault(); e.stopPropagation();
  }, true);

  addEventListener("resize", () => { apply(); if(editing){ drawGrid(); place(); } });
  apply();
}

/* test hook */
export function pinState(){ return {editing, sel, pts: pts.map(p => p.slice())}; }

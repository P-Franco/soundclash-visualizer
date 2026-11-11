/* The look: where the border, the graph and the zoom are right now, as plain numbers.

   Everything that draws the border, the graph, or text over the picture reads L, never the settings
   directly. Out of show mode L simply mirrors the settings, so a change in the drawer shows at once.
   In show mode L slides toward what the current scene asks for, which is what makes one border turn
   smoothly into the next and lets the graph fade in and out.

     on     0..1   how much border there is (0 = none)
     x, y          border width in percent of the screen: left/right, top/bottom
     sq     0..1   squareness of the picture: 1 = rectangle, 0 = oval, in between = rounding off
     blob   0..1   how much the outline drifts and bulges
     bars   0..1   how much of the bar style shows
     pulse  0..1   how much of the pulse style shows
     graph  0..1   how visible the graph is
     gstyle        "bars" | "curve": which graph (it only changes while the graph is out of sight)
     zoom          video zoom, 1 = 100%
     moving        true while anything is still sliding */
import { S } from "./state.js";
import { SHOW, showTarget } from "./show.js";

export const L = {on: 0, x: 0, y: 0, sq: 1, blob: 0, bars: 0, pulse: 0, graph: 1, gstyle: "bars", zoom: 1, moving: false};
const T = {on: 0, x: 0, y: 0, sq: 1, blob: 0, bars: 0, pulse: 0, graph: 1, gstyle: "bars", zoom: 1};
const SLIDE = ["on", "x", "y", "sq", "blob", "bars", "pulse", "zoom"];
let snap = true;

function fromSettings(){
  const on = S.frameStyle !== "off";
  T.on = on ? 1 : 0; T.x = on ? S.frameX : 0; T.y = on ? S.frameY : 0;
  T.sq = !on || S.frameShape === "rect" ? 1 : 0;
  T.blob = on && S.frameShape === "blob" ? 1 : 0;
  T.bars = S.frameStyle === "bars" ? 1 : 0;
  T.pulse = S.frameStyle === "pulse" ? 1 : 0;
  T.graph = S.hudOn ? 1 : 0; T.gstyle = S.graph;
  T.zoom = S.zoom;
}

/* Once per frame, before anything is drawn. dt is seconds since the last frame. */
export function stepLook(now, dt){
  if(S.showOn) showTarget(now, T); else fromSettings();
  if(!S.showOn || snap){
    for(const k of SLIDE) L[k] = T[k];
    L.graph = T.graph; L.gstyle = T.gstyle; L.moving = false; snap = false;
    return;
  }
  /* slide: each value closes a fixed share of the gap per second, so it starts quickly and settles gently */
  const k = 1 - Math.exp(-dt / (SHOW.morph / 3.2)), kg = 1 - Math.exp(-dt / (SHOW.fade / 3.2));
  let moving = false;
  for(const key of SLIDE){
    const d = T[key] - L[key];
    if(Math.abs(d) < (key === "x" || key === "y" ? 0.02 : 0.002)) L[key] = T[key];
    else { L[key] += d * k; moving = true; }
  }
  const dg = T.graph - L.graph;
  if(Math.abs(dg) < 0.004) L.graph = T.graph; else L.graph += dg * kg;
  if(L.graph < 0.02) L.gstyle = T.gstyle;
  L.moving = moving;
}

/* Jump straight to the target on the next frame (used when a test wants a settled picture). */
export function snapLook(){ snap = true; }

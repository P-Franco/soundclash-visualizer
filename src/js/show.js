/* Show mode: the looks play one after another by themselves, forever.

   THE SHOW IS THE TABLE BELOW. To change the show, change the table: reorder scenes, change widths,
   add a scene, drop one. Nothing else in the app needs touching. A new shape or style only has to be
   something the border can draw (frame.js) and something showTarget() below turns into numbers.

   Each scene:
     shape    "rect" | "oval" | "blob"       the shape of the picture
     style    "solid" | "bars" | "pulse"     the border style ("off" works too: no border)
     x, y     border width, percent of the screen: x = left and right, y = top and bottom
     length   how long it lasts, in scene lengths (the Scene length slider sets one length in seconds)
     graphs   which graph styles appear during the scene, in order. Each one fades in, stays, and
              fades out before the next. "bars" = LED bars, "curve" = spectrum curve. A round picture
              only has the curve (drawn round the inside of its edge), so "bars" shows the curve there. */
import { S } from "./state.js";

export const SHOW = {
  zoom: 1,          // video zoom for the whole show: 1 = 100%
  morph: 3,         // seconds one border takes to turn into the next
  fade: 1.5,        // seconds the graph takes to fade in or out
  scenes: [
    {shape: "rect", style: "solid", x: 14, y: 15, length: 2, graphs: ["bars", "curve", "bars", "curve"]},
    {shape: "oval", style: "solid", x: 14, y: 10, length: 1, graphs: ["curve"]},
    {shape: "oval", style: "bars",  x: 14, y: 10, length: 1, graphs: ["curve"]},
    {shape: "oval", style: "pulse", x: 14, y: 10, length: 1, graphs: ["curve"]},
    {shape: "blob", style: "solid", x: 19, y: 18, length: 1, graphs: ["curve"]},
    {shape: "blob", style: "bars",  x: 19, y: 18, length: 1, graphs: ["curve"]},
    {shape: "blob", style: "pulse", x: 19, y: 18, length: 1, graphs: ["curve"]},
  ],
};

let t0 = 0;                    // performance.now() at the moment the show (re)started

export function startShow(now){ t0 = now; }
/* Jump to a point in the show, in seconds from its start. */
export function showSeek(seconds){ t0 = performance.now() - seconds * 1000; }

/* What the show is doing `seconds` into a loop: which scene, and whether a graph is up. */
export function showAt(seconds){
  const unit = S.showLen, sc = SHOW.scenes;
  let total = 0; for(const s of sc) total += s.length * unit;
  let t = ((seconds % total) + total) % total, i = 0;
  while(i < sc.length - 1 && t >= sc[i].length * unit){ t -= sc[i].length * unit; i++; }
  const s = sc[i], n = s.graphs ? s.graphs.length : 0;
  let graph = 0, gstyle = "curve";
  if(n){
    /* The start of a scene belongs to the border: it is still turning into this scene's shape, and the
       graph stays out of sight until that is done. The rest is cut into one slot per graph. A graph
       comes up a little way into its slot and goes down early enough to have faded before the next. */
    const lead = SHOW.morph + 0.5, slot = (s.length * unit - lead) / n;
    if(t >= lead && slot > 0){
      const j = Math.min(n - 1, Math.floor((t - lead) / slot)), v = t - lead - j * slot;
      gstyle = s.graphs[j];
      graph = v > slot * 0.12 && v < slot - Math.max(slot * 0.2, SHOW.fade + 0.3) ? 1 : 0;
    }else gstyle = s.graphs[0];
  }
  return {index: i, scene: s, graph, gstyle};
}

/* Fill a look target (see look.js) from wherever the show is right now. */
export function showTarget(now, T){
  const a = showAt((now - t0) / 1000), s = a.scene, on = s.style !== "off";
  T.on = on ? 1 : 0; T.x = on ? s.x : 0; T.y = on ? s.y : 0;
  T.sq = !on || s.shape === "rect" ? 1 : 0;
  T.blob = on && s.shape === "blob" ? 1 : 0;
  T.bars = s.style === "bars" ? 1 : 0;
  T.pulse = s.style === "pulse" ? 1 : 0;
  T.graph = a.graph; T.gstyle = a.gstyle;
  T.zoom = SHOW.zoom;
}

/* Canvas sizing for the two overlay layers. */
import { stageMd, hud, frameCv } from "./dom.js";
import { S } from "./state.js";
import { resizeViz } from "./presets.js";

export function sizeCanvases(){
  const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  const k = Math.min(1, 1920 / (w * dpr));               // cap the WebGL layer near 1080p for smooth frame rates
  stageMd.width = Math.max(2, Math.round(w * dpr * k)); stageMd.height = Math.max(2, Math.round(h * dpr * k));
  hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr);
  frameCv.width = hud.width; frameCv.height = hud.height;
  S.sizeGen++;                                             // resizing wipes a canvas: tells the border to repaint
  resizeViz(stageMd.width, stageMd.height);
}

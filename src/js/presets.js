/* MilkDrop layer: the Butterchurn visualizer and its preset list.
   Butterchurn and the preset pack are loaded as globals by the two vendor <script> tags. */
import { $, stageMd } from "./dom.js";
import { S } from "./state.js";

const BC = window.butterchurn && (window.butterchurn.default || window.butterchurn);
const PRm = window.butterchurnPresets && (window.butterchurnPresets.default || window.butterchurnPresets);

let viz, presets = {}, lastSwitch = 0;
export let presetNames = [], presetIdx = 0;

export const engineLoaded = () => !!(BC && PRm);

/* Throws when WebGL 2 is not available. */
export function createViz(ctx){
  viz = BC.createVisualizer(ctx, stageMd, {width:stageMd.width, height:stageMd.height, pixelRatio:1, textureRatio:1});
}

/* Feed the visualizer from the gain node, fill the preset picker, and load a random first preset. */
export function startPresets(gain){
  viz.connectAudio(gain);
  presets = PRm.getPresets();
  presetNames = Object.keys(presets).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const sel = $("preset");
  presetNames.forEach((n,i) => { const o = document.createElement("option"); o.value = i; o.textContent = n; sel.appendChild(o); });
  loadPreset(Math.floor(Math.random()*presetNames.length), 0);
}

export function loadPreset(i, blend){
  presetIdx = (i + presetNames.length) % presetNames.length;
  viz.loadPreset(presets[presetNames[presetIdx]], blend);
  $("preset").value = presetIdx;
  lastSwitch = performance.now();
}
export const randomPreset = () => loadPreset(Math.floor(Math.random()*presetNames.length), 2.7);
export const nextPreset = () => loadPreset(presetIdx+1, 2.7);

/* Restart the auto change timer (called when the show starts). */
export function markSwitch(t){ lastSwitch = t; }

export function resizeViz(w, h){ if(viz) viz.setRendererSize(w, h); }

/* One frame of the layer: auto change when due, then draw. */
export function tickPresets(now){
  if(!S.locked && S.cycleSec > 0 && now - lastSwitch > S.cycleSec*1000) randomPreset();
  try{ viz.render(); }catch(e){}
}

export function initPresets(){
  $("preset").addEventListener("change", e => loadPreset(parseInt(e.target.value,10), 1.5));
  $("rand").addEventListener("click", randomPreset);
  $("next").addEventListener("click", nextPreset);
}

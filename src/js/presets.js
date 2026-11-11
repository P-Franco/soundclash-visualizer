/* MilkDrop layer: the Butterchurn visualizer and its preset list.
   Butterchurn and the preset pack are loaded as globals by the two vendor <script> tags. */
import { $, stageMd } from "./dom.js";
import { S } from "./state.js";
import { store } from "./store.js";

const BC = window.butterchurn && (window.butterchurn.default || window.butterchurn);
const PRm = window.butterchurnPresets && (window.butterchurnPresets.default || window.butterchurnPresets);

/* every pack the build inlined, in order; when two packs define the same name, the first one wins */
const PACKS = ["butterchurnPresets", "butterchurnPresetsExtra", "butterchurnPresetsExtra2", "butterchurnPresetsMD1"];
function loadPacks(){
  const all = {};
  for(const name of PACKS){
    const m = window[name], pack = m && (m.default || m);
    if(!pack || typeof pack.getPresets !== "function") continue;
    const p = pack.getPresets();
    for(const k in p) if(!(k in all)) all[k] = p[k];
  }
  return all;
}

/* ---------- favourites: starred preset names, saved as scv_stars ---------- */
const stars = new Set();
try{ const v = JSON.parse(store.get("stars", "[]")); if(Array.isArray(v)) v.forEach(n => { if(typeof n === "string") stars.add(n); }); }catch(e){}
const label = n => (stars.has(n) ? "★ " : "") + n;
export const isStarred = () => stars.has(presetNames[presetIdx]);
function paintStars(){
  const sel = $("preset"), on = isStarred();
  $("star").textContent = on ? "★ Starred" : "☆ Star";
  $("star").setAttribute("aria-pressed", on ? "true" : "false");
  for(let i = 0; i < sel.options.length; i++){
    const n = presetNames[i], o = sel.options[i];
    if(o.textContent !== label(n)) o.textContent = label(n);
    o.hidden = S.starList && stars.size > 0 && !stars.has(n);       // "list starred only" hides the rest
  }
}
export function toggleStar(){
  const n = presetNames[presetIdx]; if(!n) return;
  if(stars.has(n)) stars.delete(n); else stars.add(n);
  store.set("stars", JSON.stringify(Array.from(stars)));
  paintStars();
}
export function syncStars(){ if(presetNames.length) paintStars(); }

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
  presets = loadPacks();
  presetNames = Object.keys(presets).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const sel = $("preset");
  presetNames.forEach((n,i) => { const o = document.createElement("option"); o.value = i; o.textContent = label(n); sel.appendChild(o); });
  loadPreset(Math.floor(Math.random()*presetNames.length), 0);
}

export function loadPreset(i, blend){
  presetIdx = (i + presetNames.length) % presetNames.length;
  viz.loadPreset(presets[presetNames[presetIdx]], blend);
  $("preset").value = presetIdx;
  lastSwitch = performance.now();
  paintStars();
}
/* Auto change: any preset, or only starred ones when that option is on and something is starred. */
function autoPreset(){
  if(S.starOnly){
    const pool = [];
    for(let i = 0; i < presetNames.length; i++) if(stars.has(presetNames[i]) && i !== presetIdx) pool.push(i);
    if(pool.length){ loadPreset(pool[Math.floor(Math.random() * pool.length)], 2.7); return; }
    if(isStarred()){ lastSwitch = performance.now(); return; }     // the only starred preset is already showing
  }
  randomPreset();
}
export const randomPreset = () => loadPreset(Math.floor(Math.random()*presetNames.length), 2.7);
export const nextPreset = () => loadPreset(presetIdx+1, 2.7);

/* Restart the auto change timer (called when the show starts). */
export function markSwitch(t){ lastSwitch = t; }

/* test hook */
export function presetState(){ return {count: presetNames.length, idx: presetIdx, name: presetNames[presetIdx] || null, stars: Array.from(stars)}; }

export function resizeViz(w, h){ if(viz) viz.setRendererSize(w, h); }

/* One frame of the layer: auto change when due, then draw. */
export function tickPresets(now){
  if(!S.locked && S.cycleSec > 0 && now - lastSwitch > S.cycleSec*1000) autoPreset();
  try{ viz.render(); }catch(e){}
}

export function initPresets(){
  $("preset").addEventListener("change", e => loadPreset(parseInt(e.target.value,10), 1.5));
  $("rand").addEventListener("click", randomPreset);
  $("next").addEventListener("click", nextPreset);
  $("star").addEventListener("click", toggleStar);
}

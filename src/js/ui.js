/* Controls: saved settings bound to the drawer inputs, the slide-in drawer itself, fullscreen, and hotkeys. */
import { $, stageMd, panel } from "./dom.js";
import { S } from "./state.js";
import { bindRange, bindSelect, bindCheck, pct, onSettingChange } from "./store.js";
import { gain } from "./audio.js";
import { replan, newRound, nextClip, setRate, setRegionPoint } from "./clips.js";
import { nextPreset, toggleStar, syncStars } from "./presets.js";
import { sizeCanvases } from "./stage.js";
import { syncSens } from "./detect.js";
import { FRAME_STYLES } from "./frame.js";

/* A control that would do nothing in the current setup is hidden, so everything in the drawer has an
   effect. Hidden controls keep their value and come back when they apply again. */
function showIf(on, ...ids){
  for(const id of ids){ const el = $(id); (el.closest("label") || el.closest(".row") || el).hidden = !on; }
}
function tidyControls(){
  const border = S.frameStyle !== "off", round = border && S.frameShape !== "rect";
  showIf(S.xfade > 0, "xfadeLoop");                                   // nothing to crossfade when crossfade is off
  showIf(S.cutOn, "cutMode", "cutEvery", "cutGap");
  showIf(S.wordsOn, "wordsKind", "wordsAmount", "wordsSize");
  showIf(border, "frameShape", "frameX", "frameY");
  showIf(round, "fx");                                                // sparks and ripples come from the oval or blob
  showIf(S.mdOn, "preset", "rand", "lock", "starOnly", "starList", "cycle", "op", "blend");
  showIf(S.hudOn && !round, "graph");                                 // an oval or blob has one graph, the curve: nothing to choose
  showIf(S.statusOn || (S.hudOn && (round || S.graph === "curve")), "jp");   // labels and note names: only where text is drawn
  showIf(border || (S.hudOn && S.graph === "bars"), "glow");
}

export function initSettings(){
  /* effects stay gentle by default: no video punch for people who ask for reduced motion (a saved value still wins) */
  if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) $("punch").value = 0;
  bindRange("gain", "gain", v => v.toFixed(1) + "x", v => { if(gain) gain.gain.value = v; });
  bindRange("rate", "rate", v => v.toFixed(2) + "x", setRate);
  bindRange("dimR", "dim", pct, v => { S.baseDim = v; $("dim").style.opacity = v; });
  bindRange("tintR", "tint", pct, v => { $("tint").style.opacity = v; });
  bindRange("cycle", "cycle", v => v + " s", v => { S.cycleSec = v; });
  bindRange("op", "op", pct, v => { stageMd.style.opacity = v; });
  bindSelect("blend", "blend", v => { stageMd.style.mixBlendMode = v; });
  bindSelect("loopMode", "loop", v => { S.loopMode = v; newRound(); replan(); });
  bindRange("xfade", "xfade", v => v > 0 ? v.toFixed(1) + " s" : "off", v => { S.xfade = v; replan(); });
  bindCheck("xfadeLoop", "xfadeLoop", v => { S.xfadeLoop = v; replan(); });
  bindCheck("cutOn", "cutOn", v => { S.cutOn = v; replan(); });
  bindSelect("cutMode", "cutMode", v => { S.cutMode = v; replan(); });
  bindRange("cutEvery", "cutEvery", v => v + (v === 1 ? " kick" : " kicks"), v => { S.cutEvery = v; });
  bindRange("cutGap", "cutGap", v => v.toFixed(1) + " s", v => { S.cutGap = v; });
  bindCheck("hudOn", "hud", v => { S.hudOn = v; });
  bindCheck("statusOn", "status", v => { S.statusOn = v; });
  bindCheck("glow", "glow", v => { S.glow = v; });
  if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) $("fx").checked = false;   // a saved choice still wins
  bindCheck("fx", "fx", v => { S.fx = v; });
  if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) $("wordsOn").checked = false;
  bindCheck("wordsOn", "wordsOn", v => { S.wordsOn = v; });
  bindSelect("wordsKind", "wordsKind", v => { S.wordsKind = v; });
  bindRange("wordsAmount", "wordsAmount", v => v + " a kick", v => { S.wordsAmount = v; });
  bindRange("wordsSize", "wordsSize", v => v + " px", v => { S.wordsSize = v; });
  bindCheck("jp", "jp", v => { S.jp = v; });
  bindRange("sens", "sens", pct, v => { S.sens = v; syncSens(); });
  bindRange("punch", "punch", pct, v => { S.punch = v; });
  bindSelect("graph", "graph", v => { S.graph = v; });
  bindSelect("frameStyle", "frameStyle", v => { S.frameStyle = v; });
  bindSelect("frameShape", "frameShape", v => { S.frameShape = v; });
  bindRange("frameX", "frameX", v => v + "%", v => { S.frameX = v; });
  bindRange("frameY", "frameY", v => v + "%", v => { S.frameY = v; });
  bindRange("zoom", "zoom", pct, v => { S.zoom = v; });
  bindCheck("mdOn", "md", v => { S.mdOn = v; stageMd.style.display = v ? "block" : "none"; });
  $("lock").addEventListener("change", e => { S.locked = e.target.checked; });
  onSettingChange(tidyControls); tidyControls();
  bindCheck("starOnly", "starOnly", v => { S.starOnly = v; });
  bindCheck("starList", "starList", v => { S.starList = v; syncStars(); });
}

/* ---------- controls drawer / keys ---------- */
let idleT, pinnedHidden = false;
export function showPanel(on){ panel.classList.toggle("show", on); }
function wake(){
  document.body.classList.remove("idle");
  if(S.started && !pinnedHidden) showPanel(true);
  clearTimeout(idleT);
  idleT = setTimeout(() => { if(!panel.matches(":hover") && !panel.contains(document.activeElement)){ showPanel(false); document.body.classList.add("idle"); } }, 3500);
}
function toggleFs(){ if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(()=>{}); }

export function initPanel(){
  addEventListener("resize", sizeCanvases);
  addEventListener("mousemove", wake); addEventListener("touchstart", wake, {passive:true});
  $("fs").addEventListener("click", toggleFs);
  $("hide").addEventListener("click", () => { pinnedHidden = true; showPanel(false); document.activeElement.blur(); });
  addEventListener("keydown", e => {
    if(!S.started || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || "").toLowerCase(); if(tag === "select" || (tag === "input" && e.target.type !== "range" && e.target.type !== "checkbox")) return;
    const k = e.key.toLowerCase();
    if(k === "f") toggleFs();
    else if(k === "h"){ pinnedHidden = panel.classList.contains("show"); showPanel(!pinnedHidden); }
    else if(k === "n") nextPreset();
    else if(k === "v") nextClip();
    else if(k === "s"){ $("hudOn").checked = !S.hudOn; $("hudOn").dispatchEvent(new Event("change")); }
    else if(k === "g"){ const g = $("graph"); g.value = S.graph === "bars" ? "curve" : "bars"; g.dispatchEvent(new Event("change")); }
    else if(k === "m"){ $("mdOn").checked = !S.mdOn; $("mdOn").dispatchEvent(new Event("change")); }
    else if(k === "c"){ $("cutOn").checked = !S.cutOn; $("cutOn").dispatchEvent(new Event("change")); }
    else if(k === "b"){ const el = $("frameStyle"); el.value = FRAME_STYLES[(FRAME_STYLES.indexOf(S.frameStyle) + 1) % FRAME_STYLES.length]; el.dispatchEvent(new Event("change")); }
    else if(k === "k") toggleStar();
    else if(k === "j"){ $("wordsOn").checked = !S.wordsOn; $("wordsOn").dispatchEvent(new Event("change")); }
    else if(k === "t"){ $("statusOn").checked = !S.statusOn; $("statusOn").dispatchEvent(new Event("change")); }
    else if(k === "i") setRegionPoint("in");
    else if(k === "o") setRegionPoint("out");
    else if(k === " "){ e.preventDefault(); $("lock").checked = S.locked = !S.locked; }
  });
}

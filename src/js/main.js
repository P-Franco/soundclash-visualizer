/* Entry point: wires the modules together in a fixed order and runs the frame loop.
   The build bundles this into one classic script so the output works from file:// with no server. */
import { $, bg } from "./dom.js";
import { S } from "./state.js";
import { ctx, initAudio } from "./audio.js";
import { DET, detect } from "./detect.js";
import { clips, addClips, initClips } from "./clips.js";
import { initPresets, markSwitch, tickPresets } from "./presets.js";
import { analyse, drawHud } from "./hud.js";
import { initSettings, initPanel, showPanel } from "./ui.js";
import { sizeCanvases } from "./stage.js";

/* Called once audio is flowing (live input opened or a test track chosen). */
function begin(){
  ctx.resume();
  if(S.started) return;
  S.started = true; S.t0 = performance.now(); markSwitch(S.t0);
  $("start").style.display = "none";
  showPanel(true);
  setInterval(detect, 12);                       // hit detection runs on its own clock so slow frames never miss a beat
  requestAnimationFrame(frame);
}

/* ---------- main loop ---------- */
let lastF = 0; const dimEl = $("dim");
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastF)/1000 || 0.016); lastF = now;
  S.frameNo++;
  if(S.mdOn) tickPresets(now);
  analyse();
  const dec = Math.exp(-dt/0.14); for(const d of DET) d.env *= dec;
  const k = DET[0].env * S.punch;               // the kick pushes the video: slight zoom, and the darkening lifts
  bg.style.transform = k > 0.004 ? "scale(" + (1 + 0.05*k).toFixed(4) + ")" : "none";
  dimEl.style.opacity = (S.baseDim * (1 - 0.8*k)).toFixed(3);
  drawHud(now);
}

initSettings();
initAudio(begin);
initPresets();
initClips();
initPanel();
sizeCanvases();

/* test hook, used by tools/verify.js */
window.__scv = {clips, addClips, DET};

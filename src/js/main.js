/* Entry point: wires the modules together in a fixed order and runs the frame loop.
   The build bundles this into one classic script so the output works from file:// with no server. */
import { $, vidBox } from "./dom.js";
import { S } from "./state.js";
import { ctx, initAudio } from "./audio.js";
import { DET, detMode, detVia, detError } from "./detect.js";
import { clips, addClips, initClips, tickClips, clipState } from "./clips.js";
import { initPresets, markSwitch, tickPresets, presetState } from "./presets.js";
import { analyse, drawHud } from "./hud.js";
import { initSettings, initPanel, showPanel } from "./ui.js";
import { sizeCanvases } from "./stage.js";
import { initZoneEditor } from "./zone-editor.js";
import { initFolder } from "./folder.js";
import { drawFrame, frameState } from "./frame.js";
import { drawWords, wordsState } from "./words.js";
import { L, stepLook, snapLook } from "./look.js";
import { SHOW, showSeek, showAt } from "./show.js";
import { initPin, pinState } from "./pin.js";

/* Called once audio is flowing (live input opened or a test track chosen). */
function begin(){
  ctx.resume();
  if(S.started) return;
  S.started = true; S.t0 = performance.now(); markSwitch(S.t0);
  $("start").style.display = "none";
  showPanel(true);
  requestAnimationFrame(frame);                  // hit detection is already running on the audio thread (see detect.js)
}

/* ---------- main loop ---------- */
let lastF = 0; const dimEl = $("dim");
function frame(now){
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastF)/1000 || 0.016); lastF = now;
  S.frameNo++;
  stepLook(now, dt);                            // settle where the border, graph and zoom are for this frame
  if(S.mdOn) tickPresets(now);
  analyse();
  tickClips(now);
  const dec = Math.exp(-dt/0.14); for(const d of DET) d.env *= dec;
  const k = DET[0].env * S.punch;               // the kick pushes the video: slight zoom, and the darkening lifts
  const sc = L.zoom * (k > 0.004 ? 1 + 0.05*k : 1);   // zoom crops the clip's own border; the punch rides on top of it
  vidBox.style.transform = sc !== 1 ? "scale(" + sc.toFixed(4) + ")" : "none";
  dimEl.style.opacity = (S.baseDim * (1 - 0.8*k)).toFixed(3);
  drawFrame(now);
  drawHud(now);
  drawWords(now);
}

initSettings();
initAudio(begin);
initPresets();
initClips();
initFolder();
initZoneEditor();
initPanel();
initPin();
sizeCanvases();

/* test hook, used by tools/verify.js */
window.__scv = {get inputLabel(){ return S.inputLabel; }, pinState, clips, addClips, clipState, presetState, frameState, wordsState, lookState: () => ({...L}), snapLook, SHOW, showSeek, showAt, DET, get detMode(){ return detMode; }, get detVia(){ return detVia; }, get detError(){ return detError; }};

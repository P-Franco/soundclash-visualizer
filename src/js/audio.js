/* Audio graph: live input (line-in or mic) or a local test track, into a gain node that feeds the analysers.
   The live input is analysis only and is never connected to ctx.destination, so it cannot feed back.
   Only the test track plays to the speakers. */
import { $ } from "./dom.js";
import { S } from "./state.js";
import { store } from "./store.js";
import { engineLoaded, createViz, startPresets } from "./presets.js";
import { sizeCanvases } from "./stage.js";

export let ctx, gain, analyser, fast;
let stream, srcNode, fileNode, audioEl;
let onBegin = () => {};

export function fail(msg){ $("err").textContent = msg; }

/* Create the audio context, analysers, and the MilkDrop visualizer. Needs a user gesture. */
export function boot(){
  if(ctx) return true;
  if(!engineLoaded()){ fail("The visual engine did not load. Re-download the file and try again."); return false; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({latencyHint:"interactive"});
  gain = ctx.createGain(); gain.gain.value = parseFloat($("gain").value);
  analyser = ctx.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.6;
  gain.connect(analyser);
  fast = ctx.createAnalyser(); fast.fftSize = 2048; fast.smoothingTimeConstant = 0;   // short window, used only for hit detection
  gain.connect(fast);
  try{
    sizeCanvases();
    createViz(ctx);
  }catch(e){
    fail("This browser could not start WebGL 2. Use a current Chrome or Edge with hardware acceleration turned on.");
    ctx.close(); ctx = null; return false;
  }
  startPresets(gain);
  return true;
}

export async function useInput(deviceId){
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  if(srcNode){ srcNode.disconnect(); srcNode = null; }
  const audio = {echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:{ideal:2}};
  if(deviceId) audio.deviceId = {exact:deviceId};
  stream = await navigator.mediaDevices.getUserMedia({audio, video:false});
  srcNode = ctx.createMediaStreamSource(stream);
  srcNode.connect(gain);                       // analysis only, never to the speakers (no feedback)
  if(audioEl){ audioEl.pause(); }
  const tr = stream.getAudioTracks()[0];
  S.inputLabel = tr ? tr.label : "audio input";
  await listDevices(tr && tr.getSettings ? tr.getSettings().deviceId : deviceId);
}

async function listDevices(current){
  const sel = $("device");
  let devs = [];
  try{ devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"); }catch(e){}
  sel.innerHTML = "";
  devs.forEach((d,i) => { const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || ("Input " + (i+1)); sel.appendChild(o); });
  if(!devs.length){ const o = document.createElement("option"); o.textContent = "No inputs found"; sel.appendChild(o); }
  if(current) sel.value = current;
}

/* Test track: a local audio file, looped, analysed and also played to the speakers. */
export function useFile(file){
  if(!boot()) return;
  if(!audioEl){
    audioEl = new Audio(); audioEl.loop = true;
    fileNode = ctx.createMediaElementSource(audioEl);
    fileNode.connect(gain); fileNode.connect(ctx.destination);
  }
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  if(srcNode){ srcNode.disconnect(); srcNode = null; }
  if(audioEl.src) URL.revokeObjectURL(audioEl.src);
  audioEl.src = URL.createObjectURL(file);
  audioEl.play().catch(() => {});
  S.inputLabel = "FILE: " + file.name;
  onBegin();
}

/* begin() is supplied by main.js: it resumes the context and starts the show on first call. */
export function initAudio(begin){
  onBegin = begin;

  $("device").addEventListener("change", e => {
    useInput(e.target.value).catch(() => { S.inputLabel = "could not open that input"; });
  });
  if(navigator.mediaDevices && navigator.mediaDevices.addEventListener){
    navigator.mediaDevices.addEventListener("devicechange", () => { if(S.started) listDevices($("device").value); });
  }

  $("goMic").addEventListener("click", async () => {
    fail("");
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ fail("This browser has no audio input access here. Open the file in Chrome or Edge."); return; }
    if(!boot()) return;
    try{ await useInput(store.get("device", "") || undefined); }
    catch(e1){
      try{ await useInput(undefined); }
      catch(e2){
        fail(e2 && e2.name === "NotAllowedError"
          ? "Microphone permission was blocked. Click the icon at the right end of the address bar, allow the microphone, then press Start again."
          : "No audio input could be opened (" + (e2 && e2.name || "error") + "). Check that a mic or line-in is plugged in and enabled in Windows sound settings.");
        return;
      }
    }
    onBegin();
  });
  $("device").addEventListener("change", e => store.set("device", e.target.value));
  ["testAudio","testAudio2"].forEach(id => $(id).addEventListener("change", e => { const f = e.target.files[0]; if(f) useFile(f); e.target.value = ""; }));
}

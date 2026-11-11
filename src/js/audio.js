/* Audio graph: everything the visualizer listens to is summed into one gain node that feeds the analysers.

   What it can listen to, alone or together:
   - one input device (line-in, a USB interface, a mic),
   - every input device at once,
   - this computer's own sound, which a browser only hands over through its screen-share prompt,
   - a local test track.

   Live sound is analysis only and is never connected to ctx.destination, so it cannot feed back.
   Only the test track plays to the speakers. */
import { $ } from "./dom.js";
import { S } from "./state.js";
import { store } from "./store.js";
import { engineLoaded, createViz, startPresets } from "./presets.js";
import { sizeCanvases } from "./stage.js";
import { startDetector } from "./detect.js";

export let ctx, gain, analyser;
let fileNode, audioEl;
let onBegin = () => {};

const ALL = "__all", NONE = "__none", SYSTEM = "__system";
/* no processing of any kind: the browser's echo cancelling, noise suppression and automatic gain would wreck the analysis */
const RAW = {echoCancellation:false, noiseSuppression:false, autoGainControl:false};
/* what is being listened to right now: key -> {stream, node, label}. A key is a device id, or SYSTEM. */
const live = new Map();

export function fail(msg){ $("err").textContent = msg; }
function note(msg){ fail(msg); $("sysV").textContent = msg; }

/* Create the audio context, analysers, and the MilkDrop visualizer. Needs a user gesture. */
export function boot(){
  if(ctx) return true;
  if(!engineLoaded()){ fail("The visual engine did not load. Re-download the file and try again."); return false; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({latencyHint:"interactive"});
  gain = ctx.createGain(); gain.gain.value = parseFloat($("gain").value);
  analyser = ctx.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.6;
  gain.connect(analyser);
  try{
    sizeCanvases();
    createViz(ctx);
  }catch(e){
    fail("This browser could not start WebGL 2. Use a current Chrome or Edge with hardware acceleration turned on.");
    ctx.close(); ctx = null; return false;
  }
  startPresets(gain);
  startDetector(ctx, gain);                    // hit detection: AudioWorklet, loads in the background
  return true;
}

/* ---------- live sources ---------- */
function listen(key, stream, label){
  const node = ctx.createMediaStreamSource(stream);
  node.connect(gain);                          // analysis only, never to the speakers (no feedback)
  live.set(key, {stream, node, label});
}
function drop(key){
  const e = live.get(key); if(!e) return;
  try{ e.node.disconnect(); }catch(err){}
  e.stream.getTracks().forEach(t => t.stop());
  live.delete(key);
}
function dropDevices(){ for(const k of Array.from(live.keys())) if(k !== SYSTEM) drop(k); }

/* The INPUT line of the status block, and the computer-sound button. */
function relabel(){
  const names = [];
  for(const [k, e] of live) if(k !== SYSTEM) names.push(e.label);
  let txt = names.length > 1 ? "ALL INPUTS (" + names.length + ")" : (names[0] || "");
  if(live.has(SYSTEM)) txt = txt ? txt + " + COMPUTER SOUND" : "COMPUTER SOUND";
  S.inputLabel = txt || "no input";
  $("sysBtn").textContent = live.has(SYSTEM) ? "Stop listening to this computer" : "Also listen to this computer's sound";
}

async function open(deviceId){
  const audio = {...RAW, channelCount:{ideal:2}};
  if(deviceId) audio.deviceId = {exact:deviceId};
  const stream = await navigator.mediaDevices.getUserMedia({audio, video:false});
  return {stream, track: stream.getAudioTracks()[0]};
}

/* Listen to one input device, to all of them (ALL), or to none (NONE, for when only this computer's
   sound is wanted). Replaces whatever devices were open. */
export async function useInput(choice){
  dropDevices();
  if(choice === ALL) await openAll();
  else if(choice === NONE){ /* nothing to open */ }
  else{
    const {stream, track} = await open(choice);
    choice = track && track.getSettings ? track.getSettings().deviceId : choice;
    listen(choice || "default", stream, track ? track.label : "audio input");
  }
  if(audioEl){ audioEl.pause(); }
  relabel();
  await listDevices(choice);
}

/* Every input the computer has, summed. Windows also lists two aliases, "Default" and "Communications",
   which are devices that appear again under their own names; those are skipped so nothing is heard twice. */
async function openAll(){
  /* device ids are only given out once the page is allowed to listen, so ask for the default input first */
  const first = await open(undefined);
  first.stream.getTracks().forEach(t => t.stop());
  let devs = [];
  try{ devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput" && d.deviceId); }catch(e){}
  const real = devs.filter(d => d.deviceId !== "default" && d.deviceId !== "communications");
  for(const d of (real.length ? real : devs).slice(0, 8)){
    try{ const o = await open(d.deviceId); listen(d.deviceId, o.stream, d.label || "input"); }catch(e){}   // one busy or unplugged device must not stop the rest
  }
  if(!live.size || (live.size === 1 && live.has(SYSTEM))){ const e = new Error("no input could be opened"); e.name = "NotFoundError"; throw e; }
}

async function listDevices(current){
  const sel = $("device");
  let devs = [];
  try{ devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"); }catch(e){}
  sel.innerHTML = "";
  for(const [value, text] of [[NONE, "No input device"], [ALL, "All inputs together"]]){ const o = document.createElement("option"); o.value = value; o.textContent = text; sel.appendChild(o); }
  devs.forEach((d,i) => { const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || ("Input " + (i+1)); sel.appendChild(o); });
  if(!devs.length){ const o = document.createElement("option"); o.textContent = "No inputs found"; sel.appendChild(o); }
  sel.value = current || NONE;
  if(sel.selectedIndex < 0) sel.value = NONE;
}

/* This computer's own sound. A web page cannot simply tap what the computer is playing; the only door a
   browser offers is its screen-share prompt, where the user picks a screen or tab and ticks the box to
   share audio. Only the audio is used: the picture is never shown, sent or kept. Call from a click. */
export async function useSystem(){
  if(live.has(SYSTEM)){ drop(SYSTEM); relabel(); note(""); return false; }           // the button doubles as "stop"
  if(!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia){ note("This browser cannot share the computer's sound. Use Chrome or Edge on a computer."); return false; }
  if(!boot()) return false;
  let stream;
  try{
    stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: {...RAW, suppressLocalAudioPlayback: false}, systemAudio: "include"});
  }catch(e){
    note(e && e.name === "NotAllowedError" ? "Sharing was cancelled, so the computer's sound is not being heard." : "The computer's sound could not be shared (" + (e && e.name || "error") + ").");
    return false;
  }
  const track = stream.getAudioTracks()[0];
  if(!track){
    stream.getTracks().forEach(t => t.stop());
    note("That share came with no sound. Try again: pick Entire screen, or the tab that is playing, and tick the box to share audio.");
    return false;
  }
  /* the picture comes along whether wanted or not; it is not used, so ask for as little of it as possible */
  for(const v of stream.getVideoTracks()) v.applyConstraints({frameRate: 1, width: 320, height: 180}).catch(() => {});
  listen(SYSTEM, stream, "COMPUTER SOUND");
  track.addEventListener("ended", () => { drop(SYSTEM); relabel(); });               // the user pressed the browser's own "Stop sharing"
  note(""); relabel();
  /* started from this computer's sound alone: fill the input list so devices can still be added */
  if(!$("device").options.length) await listDevices(NONE);
  onBegin();
  return true;
}

/* Test track: a local audio file, looped, analysed and also played to the speakers. */
export function useFile(file){
  if(!boot()) return;
  if(!audioEl){
    audioEl = new Audio(); audioEl.loop = true;
    fileNode = ctx.createMediaElementSource(audioEl);
    fileNode.connect(gain); fileNode.connect(ctx.destination);
  }
  for(const k of Array.from(live.keys())) drop(k);          // the test track replaces live sound
  if(audioEl.src) URL.revokeObjectURL(audioEl.src);
  audioEl.src = URL.createObjectURL(file);
  audioEl.play().catch(() => {});
  relabel();
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
    const saved = store.get("device", "");
    try{ await useInput(saved && saved !== NONE ? saved : undefined); }
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
  $("goSys").addEventListener("click", () => { fail(""); useSystem(); });
  $("sysBtn").addEventListener("click", () => { useSystem(); });
  $("device").addEventListener("change", e => store.set("device", e.target.value));
  ["testAudio","testAudio2"].forEach(id => $(id).addEventListener("change", e => { const f = e.target.files[0]; if(f) useFile(f); e.target.value = ""; }));
}

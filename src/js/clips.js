/* Background video: a playlist of local clips (file picker or drag and drop). */
import { $, bg } from "./dom.js";
import { S } from "./state.js";
import { useFile } from "./audio.js";

export const clips = [];
export let clipIdx = -1;

const isVideo = f => f.type.startsWith("video/") || /\.(mp4|webm|mkv|mov|m4v)$/i.test(f.name);

export function syncLoop(){ bg.loop = (S.loopMode === "one" || clips.length < 2); }

export function addClips(files){
  for(const f of files){ if(isVideo(f)) clips.push({name:f.name, url:URL.createObjectURL(f)}); }
  renderClips();
  if(clipIdx < 0 && clips.length) playClip(0);
  syncLoop();
}

export function playClip(i){
  if(!clips.length){ clipIdx = -1; bg.removeAttribute("src"); bg.load(); bg.style.display = "none"; $("tint").style.display = "none"; renderClips(); return; }
  clipIdx = (i + clips.length) % clips.length;
  bg.src = clips[clipIdx].url;
  bg.style.display = "block"; $("tint").style.display = "block";
  bg.playbackRate = parseFloat($("rate").value);
  bg.play().catch(() => {});
  bg.playbackRate = parseFloat($("rate").value);
  syncLoop(); renderClips();
}

export function nextClip(){
  if(clips.length < 2){ if(clips.length){ bg.currentTime = 0; bg.play().catch(()=>{}); } return; }
  if(S.loopMode === "shuffle"){ let j; do{ j = Math.floor(Math.random()*clips.length); }while(j === clipIdx); playClip(j); }
  else playClip(clipIdx + 1);
}

function renderClips(){
  const ul = $("clips"); ul.innerHTML = "";
  clips.forEach((c,i) => {
    const li = document.createElement("li"); if(i === clipIdx) li.className = "on";
    const s = document.createElement("span"); s.textContent = (c.bad ? "[can't play] " : "") + c.name; s.title = c.name;
    const x = document.createElement("button"); x.textContent = "x"; x.setAttribute("aria-label", "Remove " + c.name);
    x.addEventListener("click", ev => { ev.stopPropagation(); URL.revokeObjectURL(c.url); clips.splice(i,1);
      if(i === clipIdx) playClip(clips.length ? i % clips.length : 0); else { if(i < clipIdx) clipIdx--; renderClips(); syncLoop(); } });
    li.addEventListener("click", () => playClip(i));
    li.append(s, x); ul.appendChild(li);
  });
}

export function initClips(){
  bg.addEventListener("ended", nextClip);
  bg.addEventListener("error", () => { if(clipIdx >= 0 && clips[clipIdx]){ clips[clipIdx].bad = true; renderClips(); if(clips.some(c => !c.bad)) nextClip(); } });
  $("vids").addEventListener("change", e => { addClips(e.target.files); e.target.value = ""; });
  $("nextClip").addEventListener("click", nextClip);

  /* drag and drop anywhere: videos join the playlist, an audio file becomes the test track */
  let dragDepth = 0;
  addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; $("drop").classList.add("on"); });
  addEventListener("dragleave", e => { e.preventDefault(); if(--dragDepth <= 0){ dragDepth = 0; $("drop").classList.remove("on"); } });
  addEventListener("dragover", e => e.preventDefault());
  addEventListener("drop", e => {
    e.preventDefault(); dragDepth = 0; $("drop").classList.remove("on");
    const files = Array.from(e.dataTransfer.files || []);
    const vids = files.filter(isVideo);
    const aud = files.find(f => f.type.startsWith("audio/"));
    if(vids.length) addClips(vids);
    if(aud) useFile(aud);
  });
}

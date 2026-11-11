/* Background video: a playlist of local clips (folder, file picker or drag and drop). Every clip plays
   all the way through, then the next one starts. Nothing changes in the middle of a clip.

   Two stacked <video> elements are used so one clip can crossfade into the next:
   - One is "front" (on screen, playing). The other is "back": hidden, paused, and already loaded
     with the clip that plays next, so a switch does not have to wait for the file to open.
   - A switch plays the back element and either swaps at once or fades over the crossfade time.
     When the fade is done the old front is paused and becomes the new back.
   - vids[1] sits above vids[0]. `mix` is the opacity of vids[1]: 0 shows vids[0], 1 shows vids[1]. */
import { $, vids } from "./dom.js";
import { S } from "./state.js";
import { useFile } from "./audio.js";

export const clips = [];       // {name, url, bad}
export let clipIdx = -1;

let cur = 0;                   // index into vids of the front element
let mix = 0;
let fade = null;               // {from, t0, dur} while a crossfade runs (ms)
let pend = null;               // {el, dur} a switch waiting for its video to be ready
let plan = -1;                 // index of the clip the back element has been loaded with, or -1
let deck = [];                 // random order: the clips still to play in this round, next one first

const front = () => vids[cur], back = () => vids[1 - cur];
export const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v)$/i;
const isVideo = f => f.type.startsWith("video/") || VIDEO_EXT.test(f.name);
const rate = () => parseFloat($("rate").value);
function playable(){ let n = 0; for(let i = 0; i < clips.length; i++) if(!clips[i].bad) n++; return n; }

function setMix(m){ mix = m; vids[1].style.opacity = m; }
function showVideo(on){
  for(const el of vids) el.style.display = on ? "block" : "none";
  $("tint").style.display = on ? "block" : "none";
}

/* The crossfade that fits the clip in `el`: never more than about half its length. */
function fadeFor(el){
  const len = el.duration;
  if(!(S.xfade > 0) || !isFinite(len)) return 0;
  const d = Math.min(S.xfade, len / 2 - 0.1);
  return d > 0.05 ? d : 0;
}

/* ---------- loading a clip into an element ---------- */
/* Load `clip` into `el` and park it, paused, on its first frame. el._ready turns true when that frame is there. */
function prepare(el, clip){
  if(el._clip === clip){
    if(el._ready && el.currentTime > 0.05){ el._ready = false; el.currentTime = 0; }   // rewind; "seeked" marks it ready again
    return;
  }
  el._clip = clip; el._ready = false;
  el.loop = false;
  el.src = clip.url; el.load();
}
function unload(el){
  el.pause(); el._clip = null; el._ready = false;
  el.removeAttribute("src"); el.load();
}
function markReady(el){
  el._ready = true;
  if(pend && pend.el === el) commit();
}

/* ---------- switching ---------- */
/* Make clip `idx` the current one. dur is the crossfade in seconds (0 = swap at once). */
function switchTo(idx, dur){
  if(fade){ const f = fade.from; fade = null; setMix(cur); f.pause(); }      // a fade in progress snaps to its end
  const clip = clips[idx], moved = idx !== clipIdx;
  clipIdx = idx;
  { const k = deck.indexOf(clip); if(k >= 0) deck.splice(k, 1); }               // it has had its turn in this round
  showVideo(true);
  if(moved) renderClips();                      // not on every loop of the same clip: that would rebuild the list under the mouse
  const el = back();
  pend = {el, dur: dur || 0};
  prepare(el, clip);
  if(el._ready) commit();                       // it was preloaded: no waiting
}

function commit(){
  const el = pend.el, dur = pend.dur, from = front();
  pend = null; plan = -1;
  cur = vids.indexOf(el);
  el.playbackRate = rate();
  el.play().catch(() => {});
  el.playbackRate = rate();
  if(dur > 0 && from._clip){
    fade = {from, t0: performance.now(), dur: dur * 1000};
  }else{
    setMix(cur); from.pause();
    preloadNext();
  }
  syncLoop();
}

function endFade(){
  const from = fade.from; fade = null;
  setMix(cur); from.pause();
  if(front().ended) advance(0);                 // a clip shorter than the fade ran out while fading in
  else preloadNext();
}

/* ---------- what plays next ---------- */
function pickNext(){
  const n = clips.length;
  if(S.loopMode === "shuffle"){
    /* Random order, in rounds: every clip plays once, then a fresh order is drawn. This only looks at
       the next clip; a clip leaves the round when it starts playing (see switchTo). */
    deck = deck.filter(c => !c.bad && clips.includes(c));
    if(!deck.length){
      deck = clips.filter(c => !c.bad);
      for(let i = deck.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)), t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
      if(deck.length > 1 && deck[0] === clips[clipIdx]){          // a new round never opens with the clip that just played
        const j = 1 + Math.floor(Math.random() * (deck.length - 1)), t = deck[0]; deck[0] = deck[j]; deck[j] = t;
      }
    }
    if(deck.length) return clips.indexOf(deck[0]);
  }
  for(let k = 1; k <= n; k++){ const i = (clipIdx + k) % n; if(!clips[i].bad) return i; }
  return clipIdx;
}
/* Which clip the back element should hold, or -1 for nothing. */
function planNext(){
  if(clipIdx < 0) return -1;
  const others = clips.some((c, i) => i !== clipIdx && !c.bad);
  if(others && S.loopMode !== "one") return pickNext();
  if(S.xfade > 0 && S.xfadeLoop) return clipIdx;                  // the same clip again, for a crossfaded loop
  if(others) return pickNext();                                    // looping one clip: still keep the next one ready for V
  return -1;
}
function preloadNext(){
  if(fade || pend) return;
  plan = planNext();
  if(plan >= 0) prepare(back(), clips[plan]);
}
/* Start a fresh random order (the end-of-clip mode was changed). */
export function newRound(){ deck = []; }
/* Call when a setting or the list changes what should come next. */
export function replan(){ if(clipIdx >= 0){ syncLoop(); preloadNext(); } }

/* The next clip to move to: the planned one when it is a different clip, so what plays is what was preloaded. */
const nextIdx = () => (plan >= 0 && plan !== clipIdx && clips[plan] && !clips[plan].bad) ? plan : pickNext();

/* Native looping is seamless, so it is used whenever nothing else has to happen at the loop point. */
function syncLoop(){
  const single = S.loopMode === "one" || clips.length < 2;
  for(const el of vids) el.loop = el === front() && single && !(S.xfade > 0 && S.xfadeLoop);
}

/* The current clip reached its end. */
function advance(dur){
  if(clipIdx < 0) return;
  if(S.loopMode === "one" || playable() < 2){
    if(dur > 0 && S.xfadeLoop) switchTo(clipIdx, dur);
    else { const el = front(); el.currentTime = 0; el.play().catch(() => {}); }
  }
  else switchTo(nextIdx(), dur);
}

/* ---------- public controls ---------- */
export function addClips(files){
  const before = clips.length;
  for(const f of files){ if(isVideo(f)) clips.push({name: f.name, url: URL.createObjectURL(f)}); }
  if(deck.length) for(let i = before; i < clips.length; i++) deck.splice(Math.floor(Math.random() * (deck.length + 1)), 0, clips[i]);   // new clips join the round in progress
  renderClips();
  if(clipIdx < 0 && clips.length) switchTo(S.loopMode === "shuffle" ? pickNext() : 0, 0);
  else replan();
}

/* Replace the whole playlist (Open folder). */
export function setClips(files){
  for(const c of clips) URL.revokeObjectURL(c.url);
  clips.length = 0;
  stopAll();
  addClips(files);
}

export function playClip(i){
  if(!clips.length){ stopAll(); return; }
  switchTo((i + clips.length) % clips.length, clipIdx >= 0 ? S.xfade : 0);
}

/* V key and the Next clip button. With one clip it restarts that clip. */
export function nextClip(){
  if(clips.length < 2){ if(clips.length){ const el = front(); el.currentTime = 0; el.play().catch(()=>{}); } return; }
  switchTo(nextIdx(), S.xfade);
}

export function setRate(v){ for(const el of vids) el.playbackRate = v; }

function stopAll(){
  fade = null; pend = null; plan = -1; clipIdx = -1; deck = [];
  for(const el of vids) unload(el);
  showVideo(false); renderClips();
}

function removeClip(i){
  const c = clips[i];
  URL.revokeObjectURL(c.url); clips.splice(i, 1);
  if(!clips.length){ stopAll(); return; }
  if(i === clipIdx){
    switchTo(i % clips.length, 0);
    renderClips();
  }else{
    if(i < clipIdx) clipIdx--;
    if(back()._clip === c && !fade) unload(back());
    plan = -1;                                    // indexes have shifted: line the next clip up again
    renderClips(); replan();
  }
}

function renderClips(){
  const ul = $("clips"); ul.innerHTML = "";
  clips.forEach((c,i) => {
    const li = document.createElement("li"); if(i === clipIdx) li.className = "on";
    const s = document.createElement("span"); s.textContent = (c.bad ? "[can't play] " : "") + c.name; s.title = c.name;
    const x = document.createElement("button"); x.textContent = "x"; x.setAttribute("aria-label", "Remove " + c.name);
    x.addEventListener("click", ev => { ev.stopPropagation(); removeClip(i); });
    li.addEventListener("click", () => playClip(i));
    li.append(s, x); ul.appendChild(li);
  });
}

/* ---------- once per frame ---------- */
export function tickClips(now){
  if(fade){
    const p = Math.min(1, (now - fade.t0) / fade.dur);
    setMix(cur === 1 ? p : 1 - p);
    if(p >= 1) endFade();
    return;
  }
  if(pend || clipIdx < 0) return;
  /* With a crossfade, start it early enough that it finishes as the clip runs out.
     Without one there is nothing to do here: the end of the file raises "ended". */
  const el = front();
  if(!el._ready || el._clip !== clips[clipIdx] || el.paused || el.loop) return;
  const selfLoop = S.loopMode === "one" || playable() < 2;
  const d = selfLoop && !S.xfadeLoop ? 0 : fadeFor(el);
  if(d > 0 && (el.duration - el.currentTime) / (el.playbackRate || 1) <= d) advance(d);
}

/* ---------- element events ---------- */
function onError(el){
  const clip = el._clip; if(!clip) return;
  clip.bad = true; el._clip = null; el._ready = false;
  const wasPending = pend && pend.el === el;
  if(wasPending) pend = null;
  if(wasPending || el === front()){
    if(clips.some(c => !c.bad)) switchTo(pickNext(), 0);
    renderClips();
  }else{
    plan = -1; renderClips(); preloadNext();       // the preloaded clip was bad: line up another
  }
}

export function initClips(){
  for(const el of vids){
    el.preload = "auto";
    el.addEventListener("loadeddata", () => { if(el._clip) markReady(el); });
    el.addEventListener("seeked", () => { if(el._clip && !el._ready) markReady(el); });
    el.addEventListener("ended", () => { if(el === front() && !fade && !pend) advance(fadeFor(el)); });
    el.addEventListener("error", () => onError(el));
  }
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
    const vids2 = files.filter(isVideo);
    const aud = files.find(f => f.type.startsWith("audio/"));
    if(vids2.length) addClips(vids2);
    if(aud) useFile(aud);
  });
}

/* test hook: a snapshot of the playback state */
export function clipState(){
  return {deck: deck.map(c => c.name), idx: clipIdx, front: cur, mix, fading: !!fade, pending: !!pend, plan,
    els: vids.map(el => ({clip: el._clip ? el._clip.name : null, ready: !!el._ready, paused: el.paused, loop: el.loop,
      t: el.currentTime, dur: el.duration, rate: el.playbackRate, shown: el.style.display !== "none"}))};
}

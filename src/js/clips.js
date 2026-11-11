/* Background video: a playlist of local clips (file picker or drag and drop), played through two
   stacked <video> elements so one clip can crossfade into the next.

   How the two elements are used:
   - One is "front" (on screen, playing). The other is "back": hidden, paused, and already loaded
     with whatever is likely to play next, so a switch does not have to wait for the file to open.
   - A switch plays the back element and either swaps at once or fades over the crossfade time.
     When the fade is done the old front is paused and becomes the new back.
   - vids[1] sits above vids[0]. `mix` is the opacity of vids[1]: 0 shows vids[0], 1 shows vids[1]. */
import { $, vids, panel } from "./dom.js";
import { S } from "./state.js";
import { store } from "./store.js";
import { useFile } from "./audio.js";
import { onHit } from "./detect.js";

export const clips = [];       // {name, url, key, in, out, bad}  in/out: loop region in seconds, null = not set
export let clipIdx = -1;

let cur = 0;                   // index into vids of the front element
let mix = 0;
let fade = null;               // {from, t0, dur} while a crossfade runs (ms)
let pend = null;               // {el, dur} a switch waiting for its video to be ready
let plan = null;               // {idx, at} what the back element has been loaded with
let deck = [];                 // random order: the clips still to play in this round, next one first
let kicks = 0;                 // kicks counted since the last beat cut
let lastCut = 0;               // performance.now() of the last clip change of any kind
let cuts = 0;                  // beat cuts made so far (for tests)

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

/* ---------- where a clip starts and ends ---------- */
/* A clip can carry a loop region: an in point, an out point, or both. Everything that asks where a clip
   starts or ends goes through these two, so looping, crossfades and beat cuts all stay inside the region. */
const MIN_REGION = 0.2;        // seconds
const clipIn = clip => clip.in || 0;
const clipOut = (clip, el) => (clip.out != null && !(clip.out > el.duration)) ? clip.out : el.duration;
const hasRegion = clip => clip.in != null || clip.out != null;

/* Regions are remembered per file (name and size), so they come back when the same clip is added again. */
let regions = {};
try{ const v = JSON.parse(store.get("regions", "{}")); if(v && typeof v === "object") regions = v; }catch(e){}
function saveRegion(clip){
  if(hasRegion(clip)) regions[clip.key] = [clip.in, clip.out]; else delete regions[clip.key];
  const keys = Object.keys(regions);
  for(let i = 0; i < keys.length - 500; i++) delete regions[keys[i]];        // keep the list bounded: oldest go first
  store.set("regions", JSON.stringify(regions));
}
/* A saved region that does not fit the file (a different clip with the same name and size) is dropped. */
function checkRegion(clip, dur){
  if(!isFinite(dur) || !hasRegion(clip)) return;
  const was = clip.in + "," + clip.out;
  if(clip.in != null && clip.in > dur - MIN_REGION) clip.in = null;
  if(clip.out != null && (clip.out > dur + 0.05 || clip.out - clipIn(clip) < MIN_REGION)) clip.out = null;
  if(clip.in + "," + clip.out !== was){ saveRegion(clip); renderClips(); }
}
/* The crossfade that fits this clip: never more than about half its length. */
function fadeFor(clip, el){
  const len = clipOut(clip, el) - clipIn(clip);
  if(!(S.xfade > 0) || !isFinite(len)) return 0;
  const d = Math.min(S.xfade, len / 2 - 0.1);
  return d > 0.05 ? d : 0;
}

/* ---------- loading a clip into an element ---------- */
/* Load `clip` into `el` and park it, paused, at `at` seconds. el._ready turns true when a frame is there. */
function prepare(el, clip, at){
  if(el._clip === clip){
    el._at = at;
    if(el._ready && Math.abs(el.currentTime - at) > 0.05){ el._ready = false; el.currentTime = at; }   // "seeked" marks it ready again
    return;
  }
  el._clip = clip; el._at = at; el._ready = false;
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
/* Make clip `idx` the current one. dur is the crossfade in seconds (0 = swap at once), at an optional start time. */
function switchTo(idx, dur, at){
  if(fade){ const f = fade.from; fade = null; setMix(cur); f.pause(); }      // a fade in progress snaps to its end
  const clip = clips[idx], moved = idx !== clipIdx;
  clipIdx = idx; lastCut = performance.now();
  { const k = deck.indexOf(clip); if(k >= 0) deck.splice(k, 1); }               // it has had its turn in this round
  showVideo(true);
  if(moved) renderClips();                      // not on every loop of the same clip: that would rebuild the list under the mouse
  const el = back();
  pend = {el, dur: dur || 0};
  prepare(el, clip, at === undefined ? clipIn(clip) : at);
  if(el._ready) commit();                       // it was preloaded: no waiting
}

function commit(){
  const el = pend.el, dur = pend.dur, from = front();
  pend = null; plan = null;
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
/* Decide what the back element should hold, or null for nothing.
   Beat cuts come first: they have to land on the beat, so their target must be the one that is ready. */
function planNext(){
  if(clipIdx < 0) return null;
  const others = clips.some((c, i) => i !== clipIdx && !c.bad);
  if(S.cutOn && (S.cutMode === "point" || !others)){ const at = randomPoint(); if(at !== null) return {idx: clipIdx, at}; }
  if(S.cutOn && others) return {idx: pickNext()};
  if(others && S.loopMode !== "one") return {idx: pickNext()};
  if(S.xfade > 0 && S.xfadeLoop) return {idx: clipIdx};           // the same clip again, for a crossfaded loop
  if(others) return {idx: pickNext()};                             // looping one clip: still keep the next one ready for V
  return null;
}
function preloadNext(){
  if(fade || pend) return;
  plan = planNext();
  if(plan) prepare(back(), clips[plan.idx], plan.at === undefined ? clipIn(clips[plan.idx]) : plan.at);
}
/* Start a fresh random order (the end-of-clip mode was changed). */
export function newRound(){ deck = []; }
/* Call when a setting or the list changes what should come next. */
export function replan(){ if(clipIdx >= 0){ syncLoop(); preloadNext(); } }

/* The next clip to move to: the planned one when it is a different clip (so shuffle plays what was preloaded). */
const nextIdx = () => (plan && plan.idx !== clipIdx && clips[plan.idx] && !clips[plan.idx].bad) ? plan.idx : pickNext();

/* Native looping is seamless, so it is used whenever nothing else has to happen at the loop point. */
function syncLoop(){
  const single = S.loopMode === "one" || clips.length < 2;
  for(const el of vids) el.loop = el === front() && single && !(S.xfade > 0 && S.xfadeLoop) && !(el._clip && hasRegion(el._clip));
}

/* The current clip reached its end. */
function advance(dur){
  if(clipIdx < 0) return;
  if(S.loopMode === "one" || playable() < 2){
    if(dur > 0 && S.xfadeLoop) switchTo(clipIdx, dur);
    else { const el = front(); el.currentTime = clipIn(clips[clipIdx]); el.play().catch(() => {}); }
  }
  else switchTo(nextIdx(), dur);
}

/* ---------- beat-synced cuts ---------- */
/* A random start point inside the current clip, away from where it is now and not right at the end. */
function randomPoint(){
  const el = front(), clip = clips[clipIdx], a = clipIn(clip), len = clipOut(clip, el) - a;
  if(el._clip !== clip || !isFinite(len) || len < 1) return null;
  const room = len - Math.min(2, len * 0.25), away = Math.max(len * 0.1, Math.min(0.6, len * 0.3));
  let t = a, n = 0;
  do { t = a + Math.random() * room; } while(Math.abs(t - el.currentTime) < away && ++n < 12);
  return t;
}

/* Runs for every kick. Cuts on the first kick where both conditions hold: N kicks counted, and the minimum time passed. */
function onKick(age){
  if(!S.cutOn || clipIdx < 0){ kicks = 0; return; }
  kicks++;
  if(age > 0.25) return;                        // reported late (a stalled frame): count it, but do not cut off the beat
  if(kicks < S.cutEvery || performance.now() - lastCut < S.cutGap * 1000 || pend) return;
  kicks = 0;
  const others = clips.some((c, i) => i !== clipIdx && !c.bad);
  if(S.cutMode === "clip" && others){ cuts++; switchTo(nextIdx(), 0); return; }
  /* a random point in this clip; also what happens when there is no other clip to jump to */
  let at = plan && plan.idx === clipIdx && plan.at !== undefined ? plan.at : randomPoint();
  /* The parked point was chosen a while ago. If playback has since run up next to it, the cut would
     hardly show, so pick again now (a short seek, instead of an instant swap). */
  if(at !== null && Math.abs(at - front().currentTime) < 0.6) at = randomPoint();
  if(at === null) return;
  cuts++; switchTo(clipIdx, 0, at);
}

/* For the status block: kicks counted toward the next cut, or null when beat cuts are off. */
export function cutInfo(){ return S.cutOn && clipIdx >= 0 ? {kicks: Math.min(kicks, S.cutEvery), every: S.cutEvery} : null; }

/* ---------- public controls ---------- */
export function addClips(files){
  const before = clips.length;
  for(const f of files){
    if(!isVideo(f)) continue;
    const key = f.name + "|" + f.size, r = regions[key];
    clips.push({name: f.name, url: URL.createObjectURL(f), key,
      in: r && typeof r[0] === "number" ? r[0] : null, out: r && typeof r[1] === "number" ? r[1] : null});
  }
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
  if(clips.length < 2){ if(clips.length){ const el = front(); el.currentTime = clipIn(clips[0]); el.play().catch(()=>{}); } return; }
  switchTo(nextIdx(), S.xfade);
}

export function setRate(v){ for(const el of vids) el.playbackRate = v; }

function stopAll(){
  fade = null; pend = null; plan = null; clipIdx = -1; deck = [];
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
    if(back()._clip === c && !fade){ unload(back()); plan = null; }
    renderClips(); replan();
  }
}

function renderClips(){
  const ul = $("clips"); ul.innerHTML = "";
  clips.forEach((c,i) => {
    const li = document.createElement("li"); if(i === clipIdx) li.className = "on";
    const s = document.createElement("span"); s.textContent = (c.bad ? "[can't play] " : "") + c.name; s.title = c.name;
    if(hasRegion(c)){ const tag = document.createElement("i"); tag.className = "tag"; tag.textContent = "loop"; tag.title = regionText(c); li.append(tag); }
    const x = document.createElement("button"); x.textContent = "x"; x.setAttribute("aria-label", "Remove " + c.name);
    x.addEventListener("click", ev => { ev.stopPropagation(); removeClip(i); });
    li.addEventListener("click", () => playClip(i));
    li.prepend(s); li.append(x); ul.appendChild(li);
  });
  renderRegion();
}

/* ---------- loop region controls ---------- */
const fmtT = t => Math.floor(t / 60) + ":" + (t % 60).toFixed(2).padStart(5, "0");
function regionText(c){
  if(c.in != null && c.out != null) return fmtT(c.in) + " to " + fmtT(c.out) + " (" + (c.out - c.in).toFixed(2) + " s)";
  if(c.in != null) return fmtT(c.in) + " to the end";
  if(c.out != null) return "start to " + fmtT(c.out);
  return "whole clip";
}
function renderRegion(){
  const c = clips[clipIdx];
  $("regionV").textContent = c ? "Loop region: " + regionText(c) : "Loop region: no clip playing";
  for(const id of ["setIn", "setOut", "clearRegion", "pos"]) $(id).disabled = !c;
  $("clearRegion").disabled = !c || !hasRegion(c);
}
/* Mark the in or out point at the current position of the playing clip. The point just set wins:
   if the other one no longer leaves a usable region, it is dropped. */
export function setRegionPoint(which){
  const c = clips[clipIdx], el = front(); if(!c || el._clip !== c) return;
  const t = Math.round(el.currentTime * 100) / 100;
  if(which === "in"){
    c.in = t > 0.05 ? t : null;
    if(c.out != null && c.out - clipIn(c) < MIN_REGION) c.out = null;
  }else{
    if(t < MIN_REGION) return;
    c.out = t;
    if(c.in != null && c.out - c.in < MIN_REGION) c.in = null;
    el.currentTime = clipIn(c);                 // stay on this clip and show the loop, whatever the end-of-clip mode is
  }
  saveRegion(c); renderClips(); replan();
}
function clearRegion(){
  const c = clips[clipIdx]; if(!c) return;
  c.in = c.out = null;
  saveRegion(c); renderClips(); replan();
}
function showPosition(){
  const el = front(), d = el.duration, pos = $("pos");
  if(!isFinite(d) || d <= 0){ $("posV").textContent = ""; return; }
  if(document.activeElement !== pos) pos.value = el.currentTime / d;
  $("posV").textContent = fmtT(el.currentTime) + " / " + fmtT(d);
}

/* ---------- once per frame ---------- */
export function tickClips(now){
  if(clipIdx >= 0 && S.frameNo % 6 === 0 && panel.classList.contains("show")) showPosition();
  if(fade){
    const p = Math.min(1, (now - fade.t0) / fade.dur);
    setMix(cur === 1 ? p : 1 - p);
    if(p >= 1) endFade();
    return;
  }
  if(pend || clipIdx < 0) return;
  /* The end of the clip (or of its loop region). With a crossfade, start early enough that the fade
     finishes as the clip runs out. Without one, only a region's out point needs catching here:
     the real end of the file raises "ended". */
  const el = front(), clip = clips[clipIdx];
  if(!el._ready || el._clip !== clip || el.paused || el.loop) return;
  const selfLoop = S.loopMode === "one" || playable() < 2;
  const d = selfLoop && !S.xfadeLoop ? 0 : fadeFor(clip, el);
  const left = (clipOut(clip, el) - el.currentTime) / (el.playbackRate || 1);
  if(d > 0 ? left <= d : (clip.out != null && left <= 0)) advance(d);
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
    plan = null; renderClips(); preloadNext();     // the preloaded clip was bad: line up another
  }
}

export function initClips(){
  for(const el of vids){
    el.preload = "auto";
    el.addEventListener("loadeddata", () => {
      if(!el._clip) return;
      checkRegion(el._clip, el.duration);
      if(el._at > el.duration - 0.1) el._at = clipIn(el._clip);
      if(el._at > 0.05) el.currentTime = el._at; else markReady(el);
    });
    el.addEventListener("seeked", () => { if(el._clip && !el._ready) markReady(el); });
    el.addEventListener("ended", () => { if(el === front() && !fade && !pend) advance(clipIdx >= 0 ? fadeFor(clips[clipIdx], el) : 0); });
    el.addEventListener("timeupdate", () => {                      // backup for the out point when frames are not running (hidden tab)
      const c = el._clip;
      if(document.hidden && el === front() && c && c.out != null && !fade && !pend && el.currentTime >= c.out) advance(0);
    });
    el.addEventListener("error", () => onError(el));
  }
  onHit((zone, i, age) => { if(i === 0) onKick(age); });       // the kick zone is always first
  $("vids").addEventListener("change", e => { addClips(e.target.files); e.target.value = ""; });
  $("nextClip").addEventListener("click", nextClip);
  $("setIn").addEventListener("click", () => setRegionPoint("in"));
  $("setOut").addEventListener("click", () => setRegionPoint("out"));
  $("clearRegion").addEventListener("click", clearRegion);
  $("pos").addEventListener("input", e => { const el = front(); if(isFinite(el.duration)) el.currentTime = parseFloat(e.target.value) * el.duration; });
  renderRegion();

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
  return {deck: deck.map(c => c.name), idx: clipIdx, front: cur, mix, fading: !!fade, pending: !!pend, plan: plan && plan.idx, planAt: plan && plan.at, cuts, kicks,
    els: vids.map(el => ({clip: el._clip ? el._clip.name : null, ready: !!el._ready, paused: el.paused, loop: el.loop,
      t: el.currentTime, dur: el.duration, rate: el.playbackRate, shown: el.style.display !== "none"}))};
}

/* Clip folder: point at a folder and every video inside it, subfolders included, becomes the playlist.

   Where the browser has the File System Access API (Chrome and Edge do), the folder is remembered
   between launches: its handle is kept in IndexedDB. The browser decides whether it lets the page
   back in silently next time or wants one click first; both cases are handled.
   Anywhere else, a plain folder input does the same job without the memory. */
import { $ } from "./dom.js";
import { setClips, VIDEO_EXT } from "./clips.js";

const canPick = typeof window.showDirectoryPicker === "function";
const DB = "scv", STORE = "kv", KEY = "clipFolder";
let handle = null;             // the remembered folder, if any
let waiting = false;           // remembered, but the browser wants a click before it gives access again
let note = "";                 // last thing that happened, shown under the buttons

/* ---------- a one-value store in IndexedDB (a folder handle cannot go in localStorage) ---------- */
function open(){
  return new Promise((res, rej) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(STORE); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function withStore(mode, fn){
  const d = await open();
  try{ return await new Promise((res, rej) => { const tx = d.transaction(STORE, mode), r = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(r.result); tx.onerror = tx.onabort = () => rej(tx.error); }); }
  finally{ d.close(); }
}
const remember = h => withStore("readwrite", s => s.put(h, KEY)).then(() => true, () => false);
const recall = () => withStore("readonly", s => s.get(KEY)).catch(() => null);
const forget = () => withStore("readwrite", s => s.delete(KEY)).catch(() => {});

/* ---------- reading a folder ---------- */
const byPath = (a, b) => a.path.localeCompare(b.path, undefined, {numeric: true, sensitivity: "base"});
async function collect(dir, prefix, out, depth){
  for await (const [name, h] of dir.entries()){
    if(h.kind === "file"){ if(VIDEO_EXT.test(name)) out.push({path: prefix + name, h}); }
    else if(depth < 8) await collect(h, prefix + name + "/", out, depth + 1);
  }
}
async function loadFolder(h){
  note = "Reading " + h.name + " ..."; show();
  const found = []; await collect(h, "", found, 0);
  found.sort(byPath);
  const files = [];
  for(const f of found){ try{ files.push(await f.h.getFile()); }catch(e){} }
  setClips(files);
  waiting = false;
  note = "Folder: " + h.name + ", " + files.length + (files.length === 1 ? " clip." : " clips.") + (handle === h ? " Remembered for next time." : "");
  show();
}

async function pick(){
  if(canPick){
    try{
      const h = await window.showDirectoryPicker({id: "scv-clips", mode: "read"});
      handle = (await remember(h)) ? h : null;
      await loadFolder(h);
      return;
    }catch(e){
      if(e && e.name === "AbortError") return;          // the user closed the dialog
      /* anything else (blocked on this page, for one): fall through to the folder input */
    }
  }
  $("folderIn").click();
}

async function reopen(){
  if(!handle) return;
  try{
    if(await handle.requestPermission({mode: "read"}) === "granted") await loadFolder(handle);
  }catch(e){ note = "Could not open " + handle.name + ". It may have been moved or renamed."; show(); }
}

function show(){
  $("folderV").textContent = note || ("Open folder loads every video inside a folder, subfolders too." + (canPick ? " The folder is remembered for next time." : ""));
  $("reopenFolder").hidden = !(handle && waiting);
  $("reopenFolder").textContent = handle ? "Reopen " + handle.name : "";
  $("forgetFolder").hidden = !handle;
}

export async function initFolder(){
  $("openFolder").addEventListener("click", pick);
  $("reopenFolder").addEventListener("click", reopen);
  $("forgetFolder").addEventListener("click", async () => { await forget(); handle = null; waiting = false; note = "Folder forgotten. The clips in the list stay until you close the page."; show(); });
  $("folderIn").addEventListener("change", e => {
    const files = Array.from(e.target.files || []).filter(f => VIDEO_EXT.test(f.name))
      .sort((a, b) => byPath({path: a.webkitRelativePath || a.name}, {path: b.webkitRelativePath || b.name}));
    const first = (e.target.files[0] && e.target.files[0].webkitRelativePath || "").split("/")[0];
    e.target.value = "";
    setClips(files);
    note = "Folder: " + (first || "selected") + ", " + files.length + (files.length === 1 ? " clip." : " clips.");
    show();
  });

  /* a folder dropped on the window works like Open folder */
  addEventListener("drop", e => {
    const items = e.dataTransfer && e.dataTransfer.items; if(!items) return;
    for(const it of items){
      const entry = it.kind === "file" && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if(!entry || !entry.isDirectory || !it.getAsFileSystemHandle) continue;
      it.getAsFileSystemHandle().then(async h => { if(h && h.kind === "directory"){ handle = (await remember(h)) ? h : null; await loadFolder(h); } }).catch(() => {});
      break;
    }
  });

  show();
  if(!canPick) return;
  /* a folder from last time */
  const h = await recall();
  if(!h || typeof h.queryPermission !== "function") return;
  handle = h;
  let perm = "prompt";
  try{ perm = await h.queryPermission({mode: "read"}); }catch(e){}
  if(perm === "granted"){
    try{ await loadFolder(h); return; }catch(e){}
  }
  waiting = true;
  note = "Last time: " + h.name + ". The browser wants a click before it opens the folder again.";
  show();
}

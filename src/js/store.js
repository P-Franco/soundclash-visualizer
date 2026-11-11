/* Saved settings (this browser only), stored in localStorage under the scv_ prefix,
   plus helpers that tie a control to a saved value. */
import { $ } from "./dom.js";

export const store = {
  get(k, d){ try{ const v = localStorage.getItem("scv_"+k); return v === null ? d : v; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem("scv_"+k, v); }catch(e){} }
};

/* Runs after any bound control changes (ui.js uses it to hide controls that no longer apply). */
let changed = () => {};
export function onSettingChange(fn){ changed = fn; }

/* Each bind helper restores the saved value, applies it once, then saves and applies on every change. */
export function bindRange(id, key, fmt, apply){
  const el = $(id), out = $(id === "dimR" ? "dimV" : id === "tintR" ? "tintV" : id + "V");
  el.value = store.get(key, el.value);
  const run = () => { const v = parseFloat(el.value); if(out) out.textContent = fmt(v); apply(v); store.set(key, el.value); changed(); };
  el.addEventListener("input", run); run();
}
export function bindSelect(id, key, apply){
  const el = $(id); el.value = store.get(key, el.value); if(!el.value) el.selectedIndex = 0;
  const run = () => { apply(el.value); store.set(key, el.value); changed(); };
  el.addEventListener("change", run); run();
}
export function bindCheck(id, key, apply){
  const el = $(id); el.checked = store.get(key, el.checked ? "1" : "0") === "1";
  const run = () => { apply(el.checked); store.set(key, el.checked ? "1" : "0"); changed(); };
  el.addEventListener("change", run); run();
}

export const pct = v => Math.round(v*100) + "%";

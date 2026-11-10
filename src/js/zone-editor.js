/* HIT ZONES section of the drawer: edit the frequency range of each zone, add and remove custom zones. */
import { $ } from "./dom.js";
import { DET, MAX_ZONES, HZ_MIN, HZ_MAX, addZone, removeZone, setZoneRange, renameZone, resetZones } from "./detect.js";

function hzInput(value, label){
  const el = document.createElement("input");
  el.type = "number"; el.className = "zhz"; el.min = HZ_MIN; el.max = HZ_MAX; el.step = 1; el.value = value;
  el.setAttribute("aria-label", label);
  return el;
}

/* Rebuilt only when the list itself changes. Range edits update the two inputs in place, so focus is not lost. */
function render(){
  const box = $("zones"); box.innerHTML = "";
  for(const d of DET){
    const row = document.createElement("div"); row.className = "zone";
    const name = document.createElement("input"); name.className = "zname"; name.value = d.en; name.maxLength = 6;
    if(d.custom){
      name.setAttribute("aria-label", "Zone name");
      name.addEventListener("change", () => { name.value = renameZone(d.id, name.value); });
    }else{
      name.readOnly = true; name.tabIndex = -1; name.setAttribute("aria-label", "Zone " + d.en);
    }
    const lo = hzInput(d.lo, d.en + " from Hz"), hi = hzInput(d.hi, d.en + " to Hz");
    const apply = edited => { const r = setZoneRange(d.id, lo.value, hi.value, edited); if(r){ lo.value = r.lo; hi.value = r.hi; } };
    lo.addEventListener("change", () => apply("lo")); hi.addEventListener("change", () => apply("hi"));
    const to = document.createElement("span"); to.textContent = "to";
    const hz = document.createElement("span"); hz.textContent = "Hz";
    row.append(name, lo, to, hi, hz);
    if(d.custom){
      const x = document.createElement("button"); x.textContent = "x"; x.setAttribute("aria-label", "Remove zone " + d.en);
      x.addEventListener("click", () => { removeZone(d.id); render(); });
      row.append(x);
    }else{
      const pad = document.createElement("span"); pad.className = "zpad";      // keeps the columns lined up with rows that have a remove button
      row.append(pad);
    }
    box.appendChild(row);
  }
  $("zoneAdd").disabled = DET.length >= MAX_ZONES;
}

export function initZoneEditor(){
  $("zoneAdd").addEventListener("click", () => { if(addZone()) render(); });
  $("zoneReset").addEventListener("click", () => { resetZones(); render(); });
  render();
}

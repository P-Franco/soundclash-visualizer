/* Border: a frame the app draws over the edges of the picture. Clips come with all sorts of borders
   baked in (black bars, coloured frames); covering the edge with one border makes them look the same.

   It has its own canvas, above the video and the MilkDrop layer and below the graph. Only the border
   strips are ever painted; the middle stays clear. No shadowBlur anywhere: this runs every frame. */
import { frameCv } from "./dom.js";
import { S } from "./state.js";
import { DET } from "./detect.js";
import { barV, NB } from "./hud.js";

const g = frameCv.getContext("2d");
const INK = "#0c0304", ROSE = "#d9667e", PALE = "#f3e9ea";

export const FRAME_STYLES = ["off", "solid", "bars", "pulse"];

/* one colour per spectrum band, built once: red for the lows round to violet for the highs */
const RAINBOW = Array.from({length: NB}, (_, i) => "hsl(" + Math.round(i / (NB - 1) * 290) + ",95%,58%)");

let drawn = "";      // what is on the canvas now, so a border that does not move is not repainted

function strips(W, H, bx, by){
  if(by){ g.fillRect(0, 0, W, by); g.fillRect(0, H - by, W, by); }
  if(bx){ g.fillRect(0, by, bx, H - 2*by); g.fillRect(W - bx, by, bx, H - 2*by); }
}

/* Colour bars that move with the music. Each bar is one slice of the spectrum (the same levels the
   LED graph shows) and grows from the edge of the screen toward the picture.
   Top and bottom: lows in the middle, highs toward the corners. Sides: lows at the bottom. */
function bars(W, H, bx, by){
  const rainbow = S.frameColor !== "app", half = NB / 2;
  if(by){
    const pitch = W / NB, w = pitch * 0.74, off = (pitch - w) / 2;
    for(let p = 0; p < NB; p++){
      const band = p < half ? (half - 1 - p) * 2 : (p - half) * 2;
      const v = barV[band] > barV[band+1] ? barV[band] : barV[band+1], len = Math.max(2, v * by), x = p * pitch + off;
      g.fillStyle = rainbow ? RAINBOW[band] : (v > 0.8 ? PALE : ROSE);
      g.fillRect(x, 0, w, len); g.fillRect(x, H - len, w, len);
    }
  }
  if(bx){
    const top = by, room = H - 2*by, pitch = room / half, h = pitch * 0.74, off = (pitch - h) / 2;
    for(let q = 0; q < half; q++){
      const band = q * 2;
      const v = barV[band] > barV[band+1] ? barV[band] : barV[band+1], len = Math.max(2, v * bx), y = top + room - (q + 1) * pitch + off;
      g.fillStyle = rainbow ? RAINBOW[band] : (v > 0.8 ? PALE : ROSE);
      g.fillRect(0, y, len, h); g.fillRect(W - len, y, len, h);
    }
  }
}

/* Once per frame. */
export function drawFrame(){
  const W = frameCv.width, H = frameCv.height, style = S.frameStyle;
  const bx = style === "off" ? 0 : Math.round(W * S.frameX / 100), by = style === "off" ? 0 : Math.round(H * S.frameY / 100);
  const key = [style, bx, by, W, H, S.sizeGen].join("|"), changed = key !== drawn;
  if(changed){ drawn = key; g.clearRect(0, 0, W, H); }
  if(!bx && !by) return;
  if(style === "solid" && !changed) return;

  g.fillStyle = INK; strips(W, H, bx, by);           // the opaque base is what hides the clip's own border
  if(style === "bars") bars(W, H, bx, by);
  else if(style === "pulse"){
    const k = DET[0].env;                             // lights up on the kick, fades with it
    if(k > 0.02){ g.fillStyle = "rgba(217,102,126," + (0.7 * k).toFixed(3) + ")"; strips(W, H, bx, by); }
  }
  /* a thin line where the border meets the picture */
  const lw = Math.max(1, Math.round(W / 960));
  g.strokeStyle = "rgba(217,102,126,.6)"; g.lineWidth = lw;
  g.strokeRect(bx - lw / 2, by - lw / 2, W - 2*bx + lw, H - 2*by + lw);
}

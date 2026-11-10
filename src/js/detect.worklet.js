/* AudioWorklet side of hit detection. It runs on the audio thread, so slow frames on the main
   thread cannot starve it: every block of audio is analysed, and hits wait in the message queue.

   The build turns this file (with detect-core.js bundled in) into a string. detect.js loads that
   string from a Blob URL, which also works when the page is opened from file://. */
import { HitEngine } from "./detect-core.js";

class ScvHitDetector extends AudioWorkletProcessor {
  constructor(){
    super();
    this.engine = new HitEngine(sampleRate);
    this.rev = 0;        // which zone list the main thread last sent; echoed back so stale messages can be dropped
    this.hops = 0;
    this.port.onmessage = e => {
      const m = e.data;
      if(m.sens !== undefined) this.engine.setSens(m.sens);
      if(m.zones){ this.engine.setZones(m.zones); this.rev = m.rev; }
    };
    /* hits are posted at once; the flux readout only every third hop (about 30 times a second) */
    this.onHop = (n, fired) => {
      const hits = n ? Array.from(fired.subarray(0, n)) : null;
      if(hits || ++this.hops % 3 === 0) this.port.postMessage({rev: this.rev, time: currentTime, flux: this.engine.fluxes(), hits});
    };
  }
  process(inputs){
    const ch = inputs[0] && inputs[0][0];                 // mono: the node down-mixes for us
    this.engine.feed(ch || null, ch ? ch.length : 128, this.onHop);
    return true;
  }
}
registerProcessor("scv-hit-detector", ScvHitDetector);

/* Shared mutable state.
   Settings are written by the control bindings in ui.js. Runtime values are written by the module that owns them. */
export const S = {
  /* settings */
  hudOn: true,        // graph visible
  statusOn: true,     // status text visible (input, preset, clip, time, level, hit pads)
  glow: true,         // soft glow and extra detail on the bars (graph and border)
  jp: true,           // Japanese labels and note names
  locked: false,      // MilkDrop preset lock (stops auto change)
  cycleSec: 30,       // MilkDrop auto change interval
  starOnly: false,    // auto change picks starred presets only
  starList: false,    // the preset list shows starred presets only
  loopMode: "cycle",  // what happens when a clip ends: cycle | one | shuffle
  xfade: 1,           // crossfade between clips in seconds, 0 = hard cut
  xfadeLoop: true,    // also crossfade when a single clip loops back to its start
  cutOn: false,       // beat-synced cuts
  cutMode: "clip",    // on a cut: jump to another clip | to a random point in this one
  cutEvery: 16,       // kicks between cuts
  cutGap: 4,          // minimum seconds between cuts
  frameStyle: "off",  // border: off | solid | bars | pulse
  frameShape: "rect", // shape of the picture inside the border: rect | oval | blob
  frameColor: "rainbow", // colour of the bar border: rainbow | app
  frameX: 6,          // border width at the left and right, percent of the screen width
  frameY: 6,          // border height at the top and bottom, percent of the screen height
  zoom: 1,            // video zoom, 1 to 2: enlarges the picture so a clip's own border falls off the screen
  graph: "bars",      // bars | curve
  sens: 0.6,          // hit sensitivity 0..1
  punch: 0.4,         // video punch on kick 0..1
  baseDim: 0.35,      // video darkening 0..0.9
  mdOn: true,         // MilkDrop layer visible

  /* runtime */
  started: false,
  t0: 0,              // performance.now() at start, for the TIME readout
  inputLabel: "",
  level: 0,           // input level (RMS with a short hold)
  frameNo: 0,
  sizeGen: 0,         // goes up each time the canvases are resized
};

/* Shared mutable state.
   Settings are written by the control bindings in ui.js. Runtime values are written by the module that owns them. */
export const S = {
  /* settings */
  hudOn: true,        // graph and status text visible
  jp: true,           // Japanese labels and note names
  locked: false,      // MilkDrop preset lock (stops auto change)
  cycleSec: 30,       // MilkDrop auto change interval
  loopMode: "cycle",  // what happens when a clip ends: cycle | one | shuffle
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
};

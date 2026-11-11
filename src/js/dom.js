/* Element lookups shared by every module. The app script sits at the end of <body>, so these exist at load. */
export const $ = id => document.getElementById(id);

export const stageMd = $("md");   // MilkDrop (WebGL) canvas
export const frameCv = $("frame"); // border canvas, between the MilkDrop layer and the graph
export const hud = $("hud");      // 2D graph and status overlay
export const vidBox = $("vids");  // holds the two background videos
export const vids = [$("bg"), $("bg2")];   // vids[1] is stacked above vids[0]
export const panel = $("panel");  // control drawer

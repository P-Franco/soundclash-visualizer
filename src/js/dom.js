/* Element lookups shared by every module. The app script sits at the end of <body>, so these exist at load. */
export const $ = id => document.getElementById(id);

export const stageMd = $("md");   // MilkDrop (WebGL) canvas
export const hud = $("hud");      // 2D graph and status overlay
export const bg = $("bg");        // background video
export const panel = $("panel");  // control drawer

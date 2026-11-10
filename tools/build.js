#!/usr/bin/env node
/* Builds dist/soundclash-visualizer.html: one self-contained file with the CSS, the vendor
   libraries and the app code all inlined, so it runs from file:// with no server and no network.

   usage: node tools/build.js [--watch] [--minify]                                              */
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "src");
const outFile = path.join(root, "dist", "soundclash-visualizer.html");
const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

/* Third-party scripts, inlined as-is ahead of the app. Each one sets a global the app reads. */
const VENDOR = [
  "node_modules/butterchurn/lib/butterchurn.min.js",
  "node_modules/butterchurn-presets/lib/butterchurnPresets.min.js",
];

const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

/* Make JS safe to sit inside a <script> element. */
const inlineJs = code => "<script>\n" + code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--") + "\n</script>";

function banner(){
  const pkg = JSON.parse(read("package.json"));
  const dep = name => JSON.parse(read("node_modules/" + name + "/package.json")).version;
  return [
    "<!--",
    "  Soundclash Visualizer " + pkg.version + " (MIT License, see LICENSE in the source repository)",
    "  Built from src/ by tools/build.js. Edit the sources, not this file.",
    "",
    "  This file bundles third-party software:",
    "    butterchurn " + dep("butterchurn") + " and butterchurn-presets " + dep("butterchurn-presets"),
    "    Copyright (c) 2013-2018 Jordan Berg, MIT License",
    "",
    ...read("node_modules/butterchurn/LICENSE").trim().split(/\r?\n/).slice(4).map(l => l ? "    " + l : ""),
    "-->",
  ].join("\n");
}

async function build(){
  const t = Date.now();
  const app = await esbuild.build({
    entryPoints: [path.join(srcDir, "js", "main.js")],
    bundle: true,
    format: "iife",
    target: ["chrome110"],
    charset: "utf8",
    legalComments: "none",
    minify,
    write: false,
    logLevel: "warning",
  });
  const css = read("src/styles.css");
  const vendor = VENDOR.map(f => inlineJs(read(f).trim())).join("\n");

  let html = read("src/index.html");
  const put = (marker, text) => {
    if(!html.includes(marker)) throw new Error("src/index.html is missing the marker " + marker);
    html = html.replace(marker, () => text);      // function form: no $ substitution in the inserted text
  };
  put("<!-- build:css -->", "<style>\n" + css.trim() + "\n</style>");
  put("<!-- build:vendor -->", vendor);
  put("<!-- build:app -->", inlineJs(app.outputFiles[0].text.trim()));
  html = html.replace(/^<!DOCTYPE html>\r?\n/i, m => m + banner() + "\n");

  fs.mkdirSync(path.dirname(outFile), {recursive: true});
  fs.writeFileSync(outFile, html);
  console.log("built " + path.relative(root, outFile) + "  " + (Buffer.byteLength(html)/1024).toFixed(0) + " KB  " + (Date.now() - t) + " ms");
}

build().then(() => {
  if(!watch) return;
  console.log("watching src/ for changes (Ctrl+C to stop)");
  let timer;
  fs.watch(srcDir, {recursive: true}, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch(e => console.error(e.message)), 80);
  });
}).catch(e => { console.error(e.message || e); process.exit(1); });

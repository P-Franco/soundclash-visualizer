# Soundclash Visualizer

A browser music visualizer for live DJ sets. It listens to a line-in or mic input and draws
on top of looping background video clips: LED bars that light up on kicks, snares and hats,
or a spectrum curve with note labels, plus an optional MilkDrop layer.

It builds into **one HTML file** that you open by double-clicking. No server, no install,
no network. Nothing is recorded or sent anywhere.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer to build.

```bash
npm install
```

```bash
npm run build
```

Then open `dist/soundclash-visualizer.html` in Chrome or Edge.

1. Click **Start with audio input** and allow the microphone when the browser asks.
   (It asks once per launch. The "microphone" permission covers line-in too.)
2. Pick your input under **AUDIO IN**.
3. Add video clips with **Add clips**, or drop files anywhere on the window.
4. Press `F` for fullscreen and `H` to hide the controls.

No input handy? **Test with an audio file** plays a local track through the speakers and
drives the visuals from it.

While working on the code, `npm run dev` rebuilds on every change in `src/`.

## Hotkeys

| Key | Does |
| --- | --- |
| `F` | Fullscreen on/off |
| `H` | Show or hide the controls |
| `N` | Next MilkDrop preset |
| `Space` | Lock the current preset (stops auto change) |
| `V` | Next video clip |
| `S` | Graph and status text on/off |
| `G` | Switch graph style: LED bars or spectrum curve |
| `M` | MilkDrop layer on/off |

## Wiring a DJ mixer into line-in

The visualizer needs a copy of what the crowd hears, at line level, going into the computer.

**Which mixer output to use**

- **Record out (REC OUT)** is the best choice. It carries the full mix at a fixed level, so
  the visuals do not change when you ride the master volume.
- **Booth out** works too and has its own level knob. Use it if the booth output is free,
  or if you want a hands-on level control for the visuals.
- If both are taken, split the record out with a pair of RCA Y-cables, or use a second
  master output if the mixer has one.

**Getting it into the computer**

- Desktop PC: a stereo RCA to 3.5 mm cable from the mixer into the sound card's **line-in**
  jack (usually light blue).
- Laptop: most laptops only have a mic or headset jack, which expects a far weaker signal
  and is often mono. Line level into it clips and distorts. Use a USB audio interface with
  line inputs instead (anything with RCA or 1/4 inch line-in works).
- All-in-one controller with no spare output: route the DJ software's output through a
  loopback device (Windows "Stereo Mix" if your driver has it, or a virtual audio cable)
  and pick that as the input.

**Setting the level**

1. In Windows sound settings, open the input's properties and turn off any enhancements.
   The app already asks the browser for echo cancellation, noise suppression and automatic
   gain to be off.
2. Play a loud section. In the app, watch the **LEVEL** meter in the top left.
   Aim for it to sit around two thirds, without living in the white segments at the end.
3. Use the Windows input level for big changes and the app's **Sensitivity** slider for
   small ones. If kicks stop registering as hits, the input is usually too quiet or clipping.

The live input is used for analysis only. It is never played back to the speakers, so it
cannot feed back. Only the test track plays out loud.

## What is in it

- **Audio in**: any input device, with a sensitivity (gain) slider.
- **Video clips**: a playlist of local files. When a clip ends it can play the next one,
  loop, or jump to a random clip. Speed, darken and red wash controls. The clip zooms and
  brightens slightly on each kick ("video punch", adjustable, off by default when your
  system asks for reduced motion).
- **Graph**: LED bars with falling peak caps and zones that flash white on hits, or a
  spectrum curve with peak note and Hz labels. A status block shows input, preset, clip,
  time, level and KICK / SNARE / HAT pads. Labels in English or Japanese.
- **MilkDrop layer**: [Butterchurn](https://github.com/jberg/butterchurn) presets blended
  over the video, with a preset picker, auto change, strength and blend mode.
- Settings are saved in the browser (localStorage, keys start with `scv_`).

- **Hit zones**: edit the frequency range of KICK, SNARE and HAT, and add up to five zones
  of your own. Each zone gets a pad in the status block and lights its part of the graph.

### About hit detection

KICK, SNARE and HAT are frequency zones, not instrument recognition. The detector watches
how fast the spectrum rises inside 40 to 120 Hz, 1800 to 5000 Hz and 7000 to 14000 Hz, and
fires when that rise beats both the zone's running average and a fraction of its recent
peak. A loud bass stab will light KICK. A vocal consonant can light SNARE.

Change the ranges under **HIT ZONES** if your music sits elsewhere (a higher kick zone for
drum and bass, say), or add a zone for something specific like a clap around 900 to 1600 Hz.
KICK is always the zone that drives the video punch.

Detection runs in an AudioWorklet, on the audio thread, about 94 times a second. A slow or
stalled frame cannot make it miss a hit: hits wait in a queue and are counted when the
page catches up. If a browser has no AudioWorklet, the same math runs on a 12 ms timer.

One browser quirk worth knowing: Chrome and Edge refuse to load a worklet from a Blob URL
when the page was opened from `file://`. The worklet source is therefore loaded from a
`data:` URL on `file://`, and from a Blob URL when the page is served over http.

## Project layout

```
src/
  index.html      page markup, with markers the build fills in
  styles.css      all CSS
  js/
    main.js       entry point: start-up order and the frame loop
    audio.js            audio context, input device, test track
    detect.js           zone list, starts the detector, receives hits
    detect-core.js      the detection math (FFT, flux, thresholds), no browser APIs
    detect.worklet.js   AudioWorklet shell around detect-core.js
    zone-editor.js      HIT ZONES controls
    clips.js            video playlist, drag and drop
    presets.js          MilkDrop layer and preset list
    hud.js              spectrum analysis and graph drawing
    ui.js               control bindings, drawer, hotkeys
    stage.js            canvas sizing
    state.js            shared settings and runtime state
    store.js            localStorage helpers
    dom.js              element lookups
tools/
  build.js            bundles everything into dist/soundclash-visualizer.html
  make-drum-loop.js   synthesizes the test drum loop (WAV)
  test-detect.js      offline test of the detection math
  verify.js           headless browser test of the built file
```

The build inlines the CSS, Butterchurn, its preset pack and the bundled app code into a
single classic `<script>` page, because ES modules do not load from `file://`. The worklet
is bundled to a string inside the app code for the same reason.

## Testing

```bash
npm test
```

Runs the detection math in Node, with no browser: the FFT against a plain DFT, then the
detector over the synthesized drum loop.

```bash
npm run verify
```

This builds nothing itself, so run `npm run build` first. It synthesizes an 8 second drum
loop (kick on every beat, snare on 2 and 4, hats on 8ths, plus a bass line), opens the
built file from `file://` in headless Chrome or Edge with that loop as a fake audio input,
clicks Start, and checks:

- hit counts in each zone against what the loop contains,
- the same counts again while the main thread is blocked 80% of the time,
- the hit zone editor (edit, add, rename, remove, reset),
- every hotkey,
- that nothing was logged as a console error and nothing was requested over the network.

It writes screenshots to `test-output/`. Options: `--md` keeps the MilkDrop layer on while
measuring, `--no-worklet` forces the timer fallback, `--https` serves the file from a
pretend https origin (the Blob URL path), `--browser=chrome|msedge|bundled|<path>` picks
the browser, `--headed` shows the window.

Headless Chrome on a machine with no GPU renders the MilkDrop layer at a few frames per
second, which starves the main thread. That is why the layer is off by default in this test.

The test cannot tell you how a real line-in feed behaves, whether your video files decode
smoothly, or what frame rate you get on your GPU. Check those by hand before a show.

## Rules for changes

- The built file must work when double-clicked (`file://` in Chrome or Edge), fully
  offline, with no server and no network calls.
- Never connect the live input to `ctx.destination`. Keep echo cancellation, noise
  suppression and automatic gain control off in `getUserMedia`.
- Target 60 fps at 1080p on a mid-range GPU. The WebGL layer is capped near 1080p on
  purpose. Do not use `shadowBlur` on anything drawn per bar.
- Keep the look (dark red, monospace, MS Gothic first in the font stack) and every hotkey.
- Effects stay gentle by default and respect `prefers-reduced-motion`.
- Never commit video or audio files. `.gitignore` blocks the common extensions.

## License

[MIT](LICENSE) for the code in this repository. The built file also contains Butterchurn
and its preset pack, both MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

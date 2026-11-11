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
3. Click **Open folder** and pick the folder your clips live in. Every video inside it,
   subfolders included, becomes the playlist. (**Add clips** adds single files, and you
   can drop files or a folder anywhere on the window.)
4. Press `F` for fullscreen and `H` to hide the controls.

**Where the sound can come from**, alone or together:

- **An input device**: line-in, a USB interface, or a mic. Pick it under AUDIO IN.
- **All inputs together**: the first entry in that list opens every input the computer has
  at once, so whatever is plugged in gets heard without choosing.
- **This computer's own sound**: for when the music is playing on the same machine. A web
  page cannot simply tap what the computer is playing. The only way a browser allows it is
  its share window: click **Also listen to this computer's sound** (or start with it),
  pick **Entire screen**, or the tab that is playing, and tick the box to share audio. Only
  the sound is used; the picture is never shown, kept or sent. It has to be granted again
  each time the page is opened. Windows shares the whole system's sound with Entire screen;
  on a Mac, Chrome can only share the sound of a tab.

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
| `S` | Graph on/off |
| `T` | Status text on/off (input, preset, clip name, time, level, hit pads) |
| `J` | Japanese text over the picture on/off |
| `X` | Show mode on/off |
| `P` | Projector corners: open or close the corner pin grid |
| `G` | Switch graph style: LED bars or spectrum curve |
| `M` | MilkDrop layer on/off |
| `B` | Step through the border styles |
| `K` | Star or unstar the current MilkDrop preset |

## Setting up the projector

The beam has to clear people's heads, which usually means mounting the projector high and
aiming it down, or off to one side. That makes the picture a trapezoid on the wall.

1. Mount it, aim it, and focus it.
2. Use the projector's own keystone or 4-corner setting if it has one and the angle is mild.
3. For steeper angles, or a projector without that setting, use the app's corner pin: tick
   it under **PROJECTOR**, press `P`, and move the corners until the grid is square on the
   wall. Look at the wall while you do it, not at the laptop.

Limits that no software can get round: the bent picture uses fewer of the projector's
pixels, so it is a little less sharp, and at a steep angle one side goes slightly soft
because the lens focuses at one distance. Staying under about 30 to 40 degrees off-axis
keeps both small. Corner pin also cannot help a projector mounted on the same wall it
projects onto; only an ultra short throw projector can sit that close.

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

- **Audio in**: any input device, all of them at once, this computer's own sound, or any mix
  of those, with a sensitivity (gain) slider.
- **Video clips**: a playlist of local files, played one after another. Speed, darken and red wash controls. The clip zooms and
  brightens slightly on each kick ("video punch", adjustable, off by default when your
  system asks for reduced motion).
- **Corner pin**: for a projector hung high or off to one side, which throws a lopsided
  picture. Turn it on, press `P` (or Adjust corners), and a grid appears. Drag each corner,
  or pick one with `1` to `4` and nudge it with the arrow keys, until the squares look square
  and the circle looks round on the wall. Everything is bent together: video, MilkDrop,
  border and graph. The corners are saved, so it is done once per venue. See the note below.
- **Show mode**: one switch (`X`) and the looks play by themselves, forever. The border
  goes through every scene in the show, each one turning smoothly into the next (a
  rectangle rounds off into an oval, widths glide, bars and pulse fade in and out). A graph
  is always up: the rectangle shows LED bars for half its time and the curve for the other
  half, and the oval and blob keep the curve up all the way through. See "Changing the show" below.
- **Random order**: by default every clip plays all the way through, the next one is drawn at
  random from the clips that have not played yet, and when all have played a fresh random
  order starts. The same clip never plays twice in a row. "When a clip ends" can also be
  set to list order or to looping one clip.
- **Crossfade**: clips dissolve into each other instead of cutting, over 0 to 5 seconds
  (1 second by default, 0 is a hard cut). A single looping clip can crossfade into its own
  start too. Turn that off if your clip is already a seamless loop.
- **Graph**: LED bars with falling peak caps and zones that flash white on hits, or a
  spectrum curve with peak note and Hz labels. A status block shows input, preset, clip,
  time, level and KICK / SNARE / HAT pads. Labels in English or Japanese.
- **MilkDrop layer**: [Butterchurn](https://github.com/jberg/butterchurn) presets blended
  over the video, with a preset picker, auto change, strength and blend mode.
- **Presets and favourites**: 395 presets, from all four packs that ship in the
  `butterchurn-presets` package. Star the ones you like (`K` or the Star button), then
  optionally limit auto change to starred presets, or show only starred ones in the list.
- The drawer only shows controls that do something in the current setup. Turn the border
  on and its settings appear; pick the oval or blob and the sparks option appears. Hidden controls keep their values.
- **Label size**: one slider sets the size of the status text and of the note names on the
  graph, from half to one and a half times the original. It starts at 80%.
- Settings are saved in the browser (localStorage, keys start with `scv_`).

- **Open folder**: point at a folder and it pulls in every video inside, subfolders too,
  sorted by path. In Chrome and Edge the folder is remembered: next launch it either opens
  by itself or shows a one-click "Reopen" button, depending on what the browser allows.
  Nothing is copied or uploaded; the app only reads the files in place.
- **Border**: clips come with all sorts of borders baked in. The app can draw its own
  border over the edges of the picture so every clip looks the same. Set the left/right
  and top/bottom widths just wide enough to hide what is underneath. Styles: solid, bars
  that move with the music, and a pulse on the kick. The
  graph and status text move inside the border. Off by default.
- **Glow and detail**: bars in the graph and in the border get a soft glow, LED segments,
  a bright centre line that flares on hits, and falling peak markers. One checkbox turns
  it off for a plainer look or a slower machine. The glow is built from a few wide, faint
  strokes, not `shadowBlur`.
- **Japanese text**: small labels appear at random spots inside the picture, a few on each
  kick, flash white and fade, in the style of old MIDI player screens. Some are note names
  read from the music as it plays (in イロハ names like ハ-2 or ニ#4, placed left to right
  by pitch), the rest are words in kanji and katakana to do with sound, now and then with
  a live number. They keep clear of the status text and the graph and stay inside an oval
  or blob. Choose what it shows, how many per kick, and the size. Off by default when your
  system asks for reduced motion.
- **Graph on an oval or blob**: a rectangular graph looks wrong on a round picture, so
  there the graph is the spectrum curve as a closed line just inside the edge, with the
  two strongest notes written beside it. It follows the blob as it moves. There are no LED
  bars inside the shape: the bars outside it are the only bars. The status text
  loses its dark panel there too. The rectangular graphs only appear on a rectangular
  picture, and the graph style list is hidden when there is nothing to choose.
- **Sparks and ripples**: with the oval or blob, each kick sends a faint ring spreading out
  from the outline and throws a handful of sparks. A soft dark rim just inside the edge
  gives the picture depth.
  The blob also breathes with the kick, lifts into broad lobes on a snare, and shimmers on
  hats. One checkbox turns the sparks and ripples off; it starts off when your system asks
  for reduced motion.
- **Shape of the picture**: everything outside the picture is pure black, so a projector
  shows only the shape and not its own rectangle. The picture can be a rectangle, an oval,
  or a blob: an oval whose outline drifts slowly and bulges out in a different direction
  on each kick. With the oval and the blob, the bars stand all the way round the
  outline. The blob grows into the border, so give the border some width.
- **Video zoom**: enlarges the picture up to 200% so a clip's own border falls off the
  edge of the screen. Use it alone, or with the border to cover whatever is left.
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

### Changing the show

The show is one table at the top of `src/js/show.js`. Each line is a scene:

```js
{shape: "rect", style: "solid", x: 14, y: 15, length: 2, graphs: ["bars", "curve"]},
{shape: "oval", style: "bars",  x: 14, y: 10, length: 1, graphs: ["curve"]},
{shape: "blob", style: "pulse", x: 19, y: 18, length: 1, graphs: ["curve"]},
```

- `shape`: `rect`, `oval` or `blob`. `style`: `solid`, `bars` or `pulse`.
- `x`, `y`: border width in percent of the screen, left/right and top/bottom.
- `length`: how long the scene lasts, in scene lengths. The Scene length slider sets how
  many seconds one length is, so the whole show speeds up or slows down together.
- `graphs`: the graph styles that show during the scene, in order. A graph is always up. The
  scene's time is shared equally between the ones listed (two graphs: half each), with a
  quick handover between them. A round picture only has the curve, so there it stays up the
  whole scene. The graph also stays up while the border changes, and the flat graph
  dissolves into the curved one as the picture rounds off.

Reorder, edit, add or delete lines and rebuild. `zoom`, `morph` (seconds a border takes to
turn into the next) and `fade` (seconds the graph takes to fade down or up at a handover)
are just above the table.

How it works: nothing draws from the settings directly. `look.js` holds the border, graph
and zoom as plain numbers (squareness, blob amount, widths, how much of each style shows).
Out of show mode those numbers mirror the drawer. In show mode they slide toward what the
current scene asks for, and the border is drawn from wherever they are, so any scene can
turn into any other. A new border only has to be drawable from those numbers to join the show.

### How clips play

There are two stacked video elements. One is on screen. The other holds the clip that is
likely to play next, already opened and paused on its first frame, so a switch does not
wait for a file to load. A crossfade plays both for a moment and blends them. The fade
starts early enough to finish as the outgoing clip runs out. Nothing changes in the middle
of a clip: every clip plays from its first frame to its last.

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
    clips.js            video playlist on two stacked videos, random order, crossfade
    folder.js           Open folder, and remembering it between launches
    frame.js            the border drawn over the edges of the picture
    look.js             where the border, graph and zoom are right now, as numbers that can slide
    show.js             show mode: the table of scenes and its clock
    pin.js              corner pin: bends the whole picture for a projector at an angle
    words.js            Japanese text that appears over the picture on kicks
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
- clip playback, using short clips the page records for itself: crossfades, hard cuts,
  each end-of-clip mode, a file that cannot be decoded, removing clips,
- the border: each style, by reading pixels back from its canvas,
- presets: the merged pack count, starring, and starred-only auto change,
- open folder: reading a folder tree (with a stand-in folder, since the native dialog
  cannot be driven from a test), and with `--https` that it is remembered and reopened,
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

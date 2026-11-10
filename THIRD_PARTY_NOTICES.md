# Third-party notices

The code in `src/` and `tools/` is ours and is covered by [LICENSE](LICENSE).

The built file, `dist/soundclash-visualizer.html`, also contains the third-party
software listed here, copied unmodified from npm and inlined by `tools/build.js`.
The same notice is written into the top of the built file.

## Butterchurn

- Package: `butterchurn` 2.6.7 (`lib/butterchurn.min.js`)
- What it is: a WebGL implementation of the MilkDrop visualizer. It draws the MilkDrop layer.
- Source: https://github.com/jberg/butterchurn
- License: MIT

## Butterchurn presets

- Package: `butterchurn-presets` 2.4.7 (`lib/butterchurnPresets.min.js`)
- What it is: MilkDrop presets converted for Butterchurn. The presets themselves were written
  by many people in the MilkDrop community over the years. Each preset name carries its
  authors' names, and the app shows those names unchanged.
- Source: https://github.com/jberg/butterchurn-presets
- License: MIT

## License text

Both packages ship the same license:

```
MIT License

Copyright (c) 2013-2018 Jordan Berg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development tools

`esbuild` (MIT) and `playwright-core` (Apache-2.0) are used to build and test.
They are not part of the built file.

# Vendored: Tesseract.js

This directory contains a vendored (bundled, offline) copy of
[Tesseract.js](https://github.com/naptha/tesseract.js) v5, its WASM core
(`tesseract.js-core`, SIMD+LSTM build), and the English trained-data model
(`eng.traineddata`, from the standard Tesseract 4.x "fast" English model).

Bundled here — rather than loaded from a CDN — so the "Standard OCR"
option in the Scorecard Reader works fully offline, including inside the
Capacitor-wrapped mobile app. Licensed Apache-2.0; see LICENSE.md.

Files:
- `tesseract.min.js`, `worker.min.js` — Tesseract.js browser build
- `tesseract-core-simd-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm` — WASM OCR engine core
- `eng.traineddata` — English language model

// Bundled to headstone-tool/vendor/ocr-web.js: PaddleOCR (PP-OCRv4) in the browser through ONNX Runtime Web.
import Ocr from '@gutenye/ocr-browser';
import * as ort from 'onnxruntime-web'; // aliased to the WebAssembly-only build at bundle time

// Single-threaded WebAssembly: multi-threading needs special server headers the apps server does not send.
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

let enginePromise = null;
window.HWOcr = {
  // base: folder URL holding ort/*.wasm and models/*
  async create(base) {
    if (!enginePromise) {
      // The loader is served as .js (not .mjs) because some static hosts do not send a JavaScript type for .mjs
      const ortBase = new URL(base + 'ort/', location.href).href;
      ort.env.wasm.wasmPaths = { mjs: ortBase + 'ort-wasm-simd-threaded.js', wasm: ortBase + 'ort-wasm-simd-threaded.wasm' };
      enginePromise = Ocr.create({ models: { detectionPath: base + 'models/det.onnx', recognitionPath: base + 'models/rec.onnx', dictionaryPath: base + 'models/dict.txt' } });
    }
    return enginePromise;
  },
};

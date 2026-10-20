'use strict';
// Second OCR engine: PaddleOCR (PP-OCRv4 models) through ONNX, via @gutenye/ocr-node.
// Optional: if the package is not installed the tool runs on Apple Vision alone.
let enginePromise = null;
let unavailable = '';

async function engine() {
  if (unavailable) return null;
  if (!enginePromise) {
    enginePromise = (async () => {
      let Ocr;
      try { Ocr = (await import('@gutenye/ocr-node')).default; }
      catch (e) { unavailable = 'not installed (run npm install)'; return null; }
      try { return await Ocr.create(); }
      catch (e) { unavailable = 'failed to start: ' + String(e.message).split('\n')[0]; return null; }
    })();
  }
  return enginePromise;
}

async function status() {
  await engine();
  return unavailable ? { name: 'PaddleOCR', available: false, note: unavailable } : { name: 'PaddleOCR', available: true };
}

// The models are trained for Chinese too; on Latin text they sometimes emit a CJK character for a dash or ornament.
const clean = (t) => t.replace(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]+/g, ' - ').replace(/\s+/g, ' ').trim();

// Returns lines like the Apple Vision helper: [{text, confidence, x, y, w, h}], normalised, y from the top.
// Give it an upright image (the 1800px JPEG preview), since PaddleOCR does not apply EXIF rotation.
async function read(file) {
  const ocr = await engine();
  if (!ocr) return null;
  const r = await ocr.detect(file);
  const W = r.resizedImageWidth, H = r.resizedImageHeight;
  return (r.texts || []).filter((t) => t.text && t.text.trim()).map((t) => {
    const xs = t.box.map((p) => p[0]), ys = t.box.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { text: clean(t.text), confidence: t.mean, x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
  });
}

module.exports = { read, status };

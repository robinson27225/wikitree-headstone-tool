#!/bin/bash
# Builds the OCR helper if needed, then starts the app at http://localhost:8777
cd "$(dirname "$0")"
if [ ! -x helper/headstone_ocr ] || [ helper/headstone_ocr.swift -nt helper/headstone_ocr ]; then
  echo "Building OCR helper (needs Xcode command line tools)..."
  swiftc -O helper/headstone_ocr.swift -o helper/headstone_ocr || exit 1
fi
if [ ! -d node_modules/@gutenye/ocr-node ]; then
  echo "Tip: run 'npm install' once (about 330 MB) to add PaddleOCR as a second text reader. Without it only Apple Vision is used."
fi
open "http://localhost:${PORT:-8777}" 2>/dev/null &
exec node server.js

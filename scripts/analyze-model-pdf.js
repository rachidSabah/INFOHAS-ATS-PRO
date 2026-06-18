// Extract text + layout info from the OUSSAMA EL FATIMI model PDF.
// Outputs structured info about: page count, margins, fonts, sections, line spacing.
const fs = require("fs");

async function main() {
  // Load pdf.js
  if (!globalThis.pdfjsLib) {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    globalThis.pdfjsLib = window.pdfjsLib;
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
}

// Run in Node with a fake document
const { createRequire } = require("module");
const path = "/home/z/my-project/upload/OUSSAMA EL FATIMI Resume QDF.pdf";

(async () => {
  // Use pdfjs-dist legacy build for Node.js
  // Polyfill DOMMatrix for pdfjs in Node
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    }
  };
  globalThis.DOMRect = class DOMRect { constructor(x=0,y=0,w=0,h=0){this.x=x;this.y=y;this.width=w;this.height=h;} };
  globalThis.window = globalThis.window || {};
  globalThis.navigator = globalThis.navigator || { userAgent: "node" };

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(path));
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;

  console.log(`=== PDF Info ===`);
  console.log(`Pages: ${pdf.numPages}`);

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    console.log(`\n=== Page ${i} ===`);
    console.log(`Dimensions: ${viewport.width} x ${viewport.height} pt (${viewport.width / 72 * 25.4} x ${viewport.height / 72 * 25.4} mm)`);

    const textContent = await page.getTextContent();
    console.log(`Text items: ${textContent.items.length}`);

    // Get all text with positions
    const items = textContent.items.map((item) => ({
      text: item.str,
      x: Math.round(item.transform[4] * 10) / 10,
      y: Math.round(item.transform[5] * 10) / 10,
      fontSize: Math.round(item.height * 10) / 10,
      fontName: item.fontName,
      width: Math.round(item.width * 10) / 10,
    }));

    // Group by Y (line)
    const lines = {};
    for (const item of items) {
      const yKey = Math.round(item.y);
      if (!lines[yKey]) lines[yKey] = [];
      lines[yKey].push(item);
    }

    // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
    const sortedLines = Object.entries(lines).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));

    console.log(`\n=== Page ${i} content (line by line) ===`);
    let prevY = null;
    for (const [yKey, lineItems] of sortedLines) {
      const y = parseFloat(yKey);
      const text = lineItems.map((i) => i.text).join("");
      const fontSize = lineItems[0]?.fontSize || 0;
      const fontName = lineItems[0]?.fontName || "?";
      const xStart = Math.min(...lineItems.map((i) => i.x));
      const gap = prevY !== null ? Math.round((prevY - y) * 10) / 10 : 0;
      console.log(`y=${y} (gap=${gap}pt, fs=${fontSize}pt, font=${fontName}, x=${xStart}): ${text}`);
      prevY = y;
    }

    // Analyze fonts used
    const fonts = {};
    for (const item of items) {
      const key = `${item.fontName} (${item.fontSize}pt)`;
      fonts[key] = (fonts[key] || 0) + 1;
    }
    console.log(`\n=== Fonts used on page ${i} ===`);
    for (const [font, count] of Object.entries(fonts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${font}: ${count} items`);
    }

    // Margins
    const minX = Math.min(...items.map((i) => i.x));
    const maxX = Math.max(...items.map((i) => i.x + i.width));
    const maxY = Math.max(...items.map((i) => i.y));
    const minY = Math.min(...items.map((i) => i.y));
    console.log(`\n=== Margins (page ${i}) ===`);
    console.log(`Left: ${minX}pt (${(minX / 72 * 25.4).toFixed(1)}mm)`);
    console.log(`Right: ${viewport.width - maxX}pt (${((viewport.width - maxX) / 72 * 25.4).toFixed(1)}mm)`);
    console.log(`Top: ${viewport.height - maxY}pt (${((viewport.height - maxY) / 72 * 25.4).toFixed(1)}mm)`);
    console.log(`Bottom: ${minY}pt (${(minY / 72 * 25.4).toFixed(1)}mm)`);
    console.log(`Content width: ${maxX - minX}pt (${((maxX - minX) / 72 * 25.4).toFixed(1)}mm)`);
    console.log(`Content height: ${maxY - minY}pt (${((maxY - minY) / 72 * 25.4).toFixed(1)}mm)`);
  }
})().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});

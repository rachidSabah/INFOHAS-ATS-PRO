const fs = require('fs');

// Mock DOMMatrix for Node environment
global.DOMMatrix = class DOMMatrix {
  constructor() {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
  }
};

async function main() {
  const pdfjs = require('pdfjs-dist');
  const filePath = `C:\\Users\\InGodWeTrust\\Downloads\\ZAKARIYA_NADIF_resume (6).pdf`;
  if (!fs.existsSync(filePath)) {
    console.log("File does not exist:", filePath);
    return;
  }
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  console.log(`PDF has ${pdf.numPages} pages.`);
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(" ");
    console.log(`--- Page ${i} ---`);
    console.log(text);
  }
}

main().catch(err => console.error("PDF Read Error:", err));

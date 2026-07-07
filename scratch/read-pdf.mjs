import fs from "fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

async function readPdf() {
  const filePath = "C:\\Users\\InGodWeTrust\\Downloads\\ZAKARIYA_NADIF_resume.pdf";
  const data = new Uint8Array(fs.readFileSync(filePath));
  
  const loadingTask = pdfjsLib.getDocument({
    data: data,
    useSystemFonts: true
  });
  
  const pdf = await loadingTask.promise;
  console.log(`PDF loaded. Pages: ${pdf.numPages}`);
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(" ");
    console.log(`--- PAGE ${i} ---`);
    console.log(text);
  }
}

readPdf().catch(console.error);

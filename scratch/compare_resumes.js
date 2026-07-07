const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

async function extractDocxText(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return `[ERROR: File does not exist at ${filePath}]`;
    }
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || "";
  } catch (err) {
    return `[ERROR reading DOCX: ${err.message}]`;
  }
}

async function extractDocText(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return `[ERROR: File does not exist at ${filePath}]`;
    }
    // For old .doc format, it might contain binary + plain text, or be a disguised html/rtf/xml.
    // Let's read it as string and strip non-ascii or see what's inside.
    const buffer = fs.readFileSync(filePath);
    // Let's do a basic clean up to see the text
    const text = buffer.toString('utf8');
    // Try to remove weird binary chars
    const cleaned = text.replace(/[^\x20-\x7E\s]/g, '');
    return cleaned;
  } catch (err) {
    return `[ERROR reading DOC: ${err.message}]`;
  }
}

async function extractPdfText(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return `[ERROR: File does not exist at ${filePath}]`;
    }
    // We can use pdfjs-dist from node.js
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(" ");
      fullText += pageText + "\n";
    }
    return fullText;
  } catch (err) {
    // If pdfjs-dist node import fails, we can fall back to basic parsing or report the error
    return `[ERROR reading PDF: ${err.message}]`;
  }
}

async function main() {
  const originalDocxPath = `C:\\Users\\InGodWeTrust\\OneDrive - Rachid ElSabah\\Documents\\ZAKARIYA NADIF Resume.docx`;
  const optPdfPath = `C:\\Users\\InGodWeTrust\\Downloads\\ZAKARIYA_NADIF_resume (6).pdf`;
  const optDocPath = `C:\\Users\\InGodWeTrust\\Downloads\\ZAKARIYA_NADIF_resume (7).doc`;
  const optDocxPath = `C:\\Users\\InGodWeTrust\\Downloads\\ZAKARIYA_NADIF_resume (13).docx`;

  console.log("=== ORIGINAL DOCX ===");
  const originalText = await extractDocxText(originalDocxPath);
  console.log(originalText.slice(0, 1500));
  console.log("-------------------------------------------\n");

  console.log("=== OPTIMIZED PDF (6) ===");
  const pdfText = await extractPdfText(optPdfPath);
  console.log(pdfText.slice(0, 1500));
  console.log("-------------------------------------------\n");

  console.log("=== OPTIMIZED DOC (7) ===");
  const docText = await extractDocText(optDocPath);
  console.log(docText.slice(0, 1500));
  console.log("-------------------------------------------\n");

  console.log("=== OPTIMIZED DOCX (13) ===");
  const docxText = await extractDocxText(optDocxPath);
  console.log(docxText.slice(0, 1500));
  console.log("-------------------------------------------\n");
}

main().catch(err => console.error("Main error:", err));

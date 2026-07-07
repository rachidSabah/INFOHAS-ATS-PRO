const mammoth = require('mammoth');

async function main() {
  const docxPath = `C:\\Users\\InGodWeTrust\\OneDrive - Rachid ElSabah\\Documents\\ZAKARIYA NADIF Resume.docx`;
  const result = await mammoth.extractRawText({ path: docxPath });
  console.log("=== FULL ORIGINAL TEXT ===");
  console.log(result.value);
}

main().catch(console.error);

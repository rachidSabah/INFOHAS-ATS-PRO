const mammoth = require("mammoth");
const fs = require("fs");

async function readDocx() {
  const filePath = "C:\\Users\\InGodWeTrust\\OneDrive - Rachid ElSabah\\Images\\Optimized_Resume Optmised.docx";
  if (!fs.existsSync(filePath)) {
    console.log("File does not exist:", filePath);
    return;
  }
  
  const result = await mammoth.extractRawText({ path: filePath });
  console.log("--- DOCX CONTENT ---");
  console.log(result.value);
}

readDocx().catch(console.error);

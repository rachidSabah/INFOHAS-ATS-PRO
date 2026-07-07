const fs = require('fs');

const docPath = `C:\\Users\\InGodWeTrust\\Downloads\\ZAKARIYA_NADIF_resume (7).doc`;
if (fs.existsSync(docPath)) {
  const content = fs.readFileSync(docPath, 'utf8');
  // Find where EXPERIENCE starts (case-insensitive)
  const match = content.match(/experience/i);
  if (match) {
    const idx = match.index;
    console.log("=== MATCH IN DOC (7) ===");
    console.log(content.slice(Math.max(0, idx - 100), idx + 2000));
  } else {
    console.log("No experience match. First 1000 characters:");
    console.log(content.slice(0, 1000));
  }
} else {
  console.log("DOC (7) does not exist");
}

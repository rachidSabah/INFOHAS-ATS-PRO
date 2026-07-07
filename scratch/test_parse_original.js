const fs = require('fs');
const mammoth = require('mammoth');

// Re-implement the key regexes and parsing functions from src/lib/parser.ts
const DATE_RANGE_RE = /(?:(?:\d{1,2}[\/\.]\d{4})|(?:\d{4})|([A-Za-z]{3,9}\.?\s+\d{4}))\s*(?:[\-–—]|\bto\b|–)\s*(?:present|current|(?:\d{1,2}[\/\.]\d{4})|(?:\d{4})|([A-Za-z]{3,9}\.?\s+\d{4}))/i;

function splitTitleAndCompany(text) {
  // Simple split simulation
  const parts = text.split('|');
  if (parts.length >= 2) {
    return { title: parts[0].trim(), company: parts[1].trim() };
  }
  return null;
}

function parseExperiences(lines) {
  const out = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const dateMatch = trimmed.match(DATE_RANGE_RE);

    if (dateMatch && trimmed.length > 20 && !trimmed.startsWith('•') && !trimmed.startsWith('-')) {
      if (current) out.push(current);

      const dateStr = dateMatch[0];
      let cleanLine = trimmed.replace(dateStr, '').trim();
      cleanLine = cleanLine.replace(/^[:\s,—–\-|·•▪◦()]+/, '').replace(/[:\s,—–\-|·•▪◦()]+$/, '').trim();

      let title = cleanLine;
      let company = "";
      let location = "";

      const pipeParts = cleanLine.split(/\s*\|\s*/);
      if (pipeParts.length >= 2) {
        title = pipeParts[0].trim();
        company = pipeParts[1].trim();
        if (pipeParts.length >= 3) {
          location = pipeParts.slice(2).join(" | ").trim();
        }
      }

      current = {
        title,
        company,
        location,
        startDate: dateStr.split(/[-–—]|\bto\b/i)[0]?.trim() || "",
        endDate: dateStr.split(/[-–—]|\bto\b/i)[1]?.trim() || "",
        bullets: []
      };
    } else if (trimmed && current) {
      current.bullets.push(trimmed.replace(/^[•\-\s\*▪◦◦·]+/, '').trim());
    }
  }
  if (current) out.push(current);
  return out;
}

async function test() {
  const docxPath = `C:\\Users\\InGodWeTrust\\OneDrive - Rachid ElSabah\\Documents\\ZAKARIYA NADIF Resume.docx`;
  const result = await mammoth.extractRawText({ path: docxPath });
  const rawText = result.value || "";
  
  console.log("=== RAW TEXT ===");
  console.log(rawText.slice(0, 2000));
  
  console.log("\n=== HEURISTIC EXPERIENCES ===");
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const expLines = [];
  let isExp = false;
  for (const line of lines) {
    if (/experience/i.test(line)) {
      isExp = true;
      continue;
    } else if (isExp && (/education/i.test(line) || /skills/i.test(line) || /languages/i.test(line))) {
      isExp = false;
    }
    if (isExp) expLines.push(line);
  }
  
  const parsedExps = parseExperiences(expLines);
  console.log(JSON.stringify(parsedExps, null, 2));
}

test().catch(console.error);

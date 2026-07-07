const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

// Load parser.ts content and extract parseExperiences
const parserContent = fs.readFileSync('src/lib/parser.ts', 'utf8');

// We will construct a running node version of the parser
// But wait, we can just extract the functions from the file by compiling or running them.
// Let's create a script that runs the parser code directly.
// We need uid, isForbiddenSkill, detectSectionBoundaries, etc.
// Let's create a self-contained parser script that copies the exact code from parser.ts.

function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

const DATE_RANGE_RE = /(?:(?:\d{1,2}[\/\.]\d{4})|(?:\d{4})|([A-Za-z]{3,9}\.?\s+\d{4}))\s*(?:[\-–—]|\bto\b|–)\s*(?:present|current|(?:\d{1,2}[\/\.]\d{4})|(?:\d{4})|([A-Za-z]{3,9}\.?\s+\d{4}))/i;

function parseDateRange(str) {
  return { startDate: str.split(/[-–—]|\bto\b/i)[0]?.trim() || "", endDate: str.split(/[-–—]|\bto\b/i)[1]?.trim() || "" };
}

function splitTitleAndCompany(combined) {
  const TITLE_END_KEYWORDS = ["manager", "specialist", "agent", "associate", "engineer", "technician", "officer", "assistant", "representative", "consultant", "analyst", "developer", "lead", "director", "coordinator", "supervisor", "agent", "expert"];
  const trimmed = combined.trim();
  if (!trimmed) return null;
  let bestSplit = null;
  for (const kw of TITLE_END_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    const match = trimmed.match(re);
    if (!match) continue;
    if (match.index === undefined) continue;
    const endPos = match.index + match[0].length;
    const title = trimmed.slice(0, endPos).trim();
    const company = trimmed.slice(endPos).trim();
    if (!company || !/[A-Za-z0-9]/.test(company)) continue;
    if (bestSplit === null || match.index > bestSplit.index) {
      bestSplit = { title, company, index: match.index };
    }
  }
  return bestSplit ? { title: bestSplit.title, company: bestSplit.company } : null;
}

// Copy of exact parseExperiences from parser.ts:
function parseExperiences(lines) {
  if (!lines.length) return [];
  const out = [];
  let current = null;

  const trimOrPad = (bullets) => {
    return bullets;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const dateMatch = trimmed.match(DATE_RANGE_RE);

    if (dateMatch && trimmed.length > 20 && !trimmed.startsWith('•') && !trimmed.startsWith('-')) {
      if (current) out.push({ ...current, bullets: trimOrPad(current.bullets) });

      const dateStr = dateMatch[0];
      const dateRange = parseDateRange(dateStr);

      let cleanLine = trimmed.replace(dateStr, '').trim();
      cleanLine = cleanLine.replace(new RegExp("^[:\\s,—–\\-|·•▪◦]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦]+$"), '').trim();

      let title = cleanLine;
      let company = "";
      let location = "";

      const pipeParts = cleanLine.split(new RegExp("\\s*\\|\\s*"));
      if (pipeParts.length >= 2) {
        const leftSide = pipeParts[0].trim();
        const rightSide = pipeParts.slice(1).join(" | ").trim();
        const split = splitTitleAndCompany(leftSide);
        if (split) {
          title = split.title;
          company = split.company;
          location = rightSide;
        } else {
          title = leftSide;
          company = rightSide;
        }
      } else {
        // ... omitted other splits for brevity
      }

      current = {
        id: uid("e"),
        company,
        title,
        location,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        bullets: []
      };
    } else if (trimmed && current) {
      current.bullets.push(trimmed.replace(/^[•\-\s\*▪◦◦·]+/, '').trim());
    }
  }
  if (current) out.push({ ...current, bullets: trimOrPad(current.bullets) });
  return out;
}

async function run() {
  const text = `PROFESSIONAL EXPERIENCE

Administrative Agent | BIOLOGIA LABORATORY | Rabat, Morocco (Jan 2023 – Oct 2025)

Acted as the primary client liaison, delivering professional trilingual (Arabic, French, English) service to diverse clients in a high-volume setting.

Managed complex scheduling and confidential records for high-volume operations, ensuring 100% data accuracy and strict adherence to compliance protocols.`;

  const lines = text.split('\n');
  const parsed = parseExperiences(lines);
  console.log("Parsed result:", JSON.stringify(parsed, null, 2));
}

run();

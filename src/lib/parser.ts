// ========================================================================
// PARSE EDUCATION
// ========================================================================
function parseEducation(lines: string[]): ResumeData["education"] {
  if (!lines.length) return [];

  // Split into entries by blank lines OR by lines that look like a degree/institution header.
  // A "header" line is one that contains a degree keyword (B.S., M.S., PhD, Bachelor, Master, etc.)
  // or a year range (2014-2018, 2014 - 2018, 2014–2018).
  const degreePattern = /\b(b\.?\s?s\.?|b\.?\s?a\.?|b\.?\s?eng\.?|b\.?\s?tech|m\.?\s?s\.?|m\.?\s?a\.?|mba|ph\.?d|bachelor|master|doctorate|diploma|certificate|associate|degree|high\s+school)\b/i;
  const yearRangePattern = new RegExp("\\b(19|20)\\d{2}\\s*[–\\-]\\s*(19|20)\\d{2}\\b|\\b(19|20)\\d{2}\\s*[–\\-]\\s*present\\b", "i");

  const entries: string[][] = [];
  let current: string[] = [];

  const INST_KEYWORDS = /\b(University|College|Institute|School|Academy|Polytechnic|Conservatory)\b/i;

  for (const line of lines) {
    const hasYearRange = yearRangePattern.test(line);
    const hasDegree = degreePattern.test(line);
    const hasInst = INST_KEYWORDS.test(line);

    const currentHasDegree = current.some(l => degreePattern.test(l));
    const currentHasInst = current.some(l => INST_KEYWORDS.test(l));

    let shouldSplit = false;
    if (current.length > 0) {
      if (hasYearRange) {
        shouldSplit = true;
      } else if (hasDegree && currentHasDegree) {
        // Avoid splitting when the line is a plain degree phrase without an institution.
        const plainDegreeOnly = /^(high\s+school|school|b\.?\s?s\.?|m\.?\s?s\.?|ph\.?\s?d\.?|bachelor|master|diploma|associate|degree)\b/i.test(line.trim());
        if (!plainDegreeOnly && (hasInst || currentHasInst)) {
          shouldSplit = true;
        }
      } else if (hasInst && currentHasInst) {
        shouldSplit = true;
      }
    }

    if (shouldSplit) {
      entries.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) entries.push(current);

  // If we only found 1 entry via splitting, but it has many lines, try splitting by blank-line gaps
  if (entries.length === 1 && lines.length > 5) {
    const blankSplit: string[][] = [];
    let curr: string[] = [];
    for (const line of lines) {
      if (line === "") {
        if (curr.length > 0) blankSplit.push(curr);
        curr = [];
      } else {
        curr.push(line);
      }
    }
    if (curr.length > 0) blankSplit.push(curr);
    if (blankSplit.length > 1) {
      entries.length = 0;
      entries.push(...blankSplit);
    }
  }

  // Parse each entry
  const result: ResumeData["education"] = [];
  for (const entryLines of entries) {
    // Try to extract year range from any line
    let startDate = "";
    let endDate = "";
    for (const l of entryLines) {
      const yrMatch = l.match(/\b(19|20)\d{2}\b/g);
      if (yrMatch && yrMatch.length >= 2) {
        startDate = yrMatch[0];
        endDate = yrMatch[1];
        break;
      } else if (yrMatch && yrMatch.length === 1) {
        if (/present/i.test(l)) {
          startDate = yrMatch[0];
          endDate = "Present";
          break;
        } else if (/ongoing/i.test(l)) {
          startDate = yrMatch[0];
          endDate = "Ongoing";
          break;
        }
      }
    }

    // First line with a degree keyword → degree; next line → institution
    let degree = "";
    let institution = "";
    let field = "";
    let location = "";
    const highlights: string[] = [];

    const cleanedEntryLines = entryLines.map(cleanEducationLine).filter(Boolean);

    for (let i = 0; i < cleanedEntryLines.length; i++) {
      const cleanedLine = cleanedEntryLines[i];
      if (!cleanedLine) continue;

      if (!degree && degreePattern.test(cleanedLine)) {
        let leftSide = cleanedLine;
        if (cleanedLine.includes("|")) {
          const pipeParts = cleanedLine.split("|").map((p) => p.trim());
          leftSide = pipeParts[0];
          // The pipe part could be location OR institution depending on format:
          // - "degree | institution" → pipe part is institution
          // - "degree institution | location" → pipe part is location
          // Find the degree keyword match to see if there's text after it in leftSide
          const degMatchForPipe = leftSide.match(degreePattern);
          if (degMatchForPipe && degMatchForPipe.index !== undefined) {
            const afterDeg = leftSide.slice(degMatchForPipe.index + degMatchForPipe[0].length).trim();
            if (afterDeg.length > 1) {
              // Text after degree → pipe part is location
              location = pipeParts[1] || "";
            } else {
              // No text after degree → pipe part is institution
              institution = pipeParts[1] || "";
              if (pipeParts.length >= 3) {
                location = pipeParts[2] || "";
              }
            }
          } else {
            institution = pipeParts[1] || "";
            if (pipeParts.length >= 3) {
              location = pipeParts[2] || "";
            }
          }
        }

        // Try to separate degree + field from institution in leftSide.
        // We find the rightmost degree keyword match.
        const degMatches = Array.from(leftSide.matchAll(new RegExp(degreePattern.source, "gi")));
        let bestDegMatch: any = null;
        for (const m of degMatches) {
          if (m.index !== undefined) {
            if (bestDegMatch === null || m.index > bestDegMatch.index) {
              bestDegMatch = m;
            }
          }
        }

        if (bestDegMatch) {
          let kwEnd = bestDegMatch.index + bestDegMatch[0].length;
          if (leftSide[kwEnd] === ".") {
            kwEnd++;
          }
          degree = leftSide.slice(0, kwEnd).trim();

          const afterKw = leftSide.slice(kwEnd);
          const fieldMatch = afterKw.match(new RegExp("^\\s+(?:of|in|with)\\s+([A-Za-z\\s&]+?)(?=\\s+(?:University|College|Institute|School|Academy|Polytechnic|Conservatory)|$)", "i"));
          if (fieldMatch) {
            field = fieldMatch[1].trim();
            institution = afterKw.slice(fieldMatch[0].length).trim();
          } else if (!institution) {
            institution = afterKw.trim();
          }
        } else {
          degree = leftSide;
        }

        if (!institution) {
          // Attempt to extract institution from the previous line if it contains a colon.
          const prevIdx = i - 1;
          if (prevIdx >= 0) {
            const prevLine = cleanedEntryLines[prevIdx];
            const colonPos = prevLine.indexOf(':');
            if (colonPos !== -1) {
              const possibleInst = prevLine.slice(colonPos + 1).trim();
              if (possibleInst && !yearRangePattern.test(possibleInst)) {
                institution = possibleInst;
              }
            }
          }
        }
      } else if (degree && !institution && INST_KEYWORDS.test(cleanedLine)) {
        institution = cleanedLine;
      } else if (degree && institution && !location && /[A-Za-z]+,\s*[A-Z]{2}/.test(cleanedLine)) {
        location = cleanedLine;
      } else if (degree && institution && !location && /[A-Z]{2},\s*[A-Za-z]+/.test(cleanedLine)) {
        location = cleanedLine;
      } else if (degree && institution && !location && /[A-Z]{2}/.test(cleanedLine)) {
        location = cleanedLine;
      } else if (degree && institution && !location && /\b(remote|online)\b/i.test(cleanedLine)) {
        location = cleanedLine;
      } else if (degree && institution && !location && /\b(hybrid|on\s*site|on-site)\b/i.test(cleanedLine)) {
        location = cleanedLine;
      } else if (degree && institution && !location && /\b([A-Z][a-z]+\s+)+[A-Z]{2}\b/.test(cleanedLine)) {
        location = cleanedLine;
      } else if (degree && institution && !location && /\b([A-Z]{2})\b/.test(cleanedLine)) {
        location = cleanedLine;
      } else if (degree && institution) {
        highlights.push(cleanedLine);
      }
    }

    // If we still don't have an institution, try to extract it from the first line
    if (!institution && cleanedEntryLines.length > 0) {
      const firstLine = cleanedEntryLines[0];
      if (INST_KEYWORDS.test(firstLine)) {
        institution = firstLine;
      }
    }

    // If we still don't have a degree, try to extract it from the first line
    if (!degree && cleanedEntryLines.length > 0) {
      const firstLine = cleanedEntryLines[0];
      if (degreePattern.test(firstLine)) {
        degree = firstLine;
      }
    }

    // If we still don't have a degree, skip this entry
    if (!degree) continue;

    // Clean up institution and location
    institution = cleanInstitution(institution);
    location = location.trim();

    // Format education entry to enforce bullets, bold institution, italic degree, and years in parentheses
    const formattedHighlights = highlights.map(h => `• ${h}`);
    const yearStr = startDate && endDate ? `(${startDate} - ${endDate})` : "";
    const formattedEntry = `• **${institution}** *${degree}* ${yearStr}`;
    const formattedHighlightsWithEntry = [formattedEntry, ...formattedHighlights];

    result.push({
      id: uid("ed"),
      institution,
      degree,
      field,
      location,
      startDate,
      endDate,
      highlights: formattedHighlightsWithEntry.slice(0, 4)
    });
  }

  return result;
}

function cleanEducationLine(line: string): string {
  return line.replace(/^\s*[-•*·▪◦]\s*/, "").trim();
}

// ========================================================================
// POST-PROCESS institution: strip em-dash garbling.
function cleanInstitution(inst: string): string {
  return inst.replace(/—/g, "-").trim();
}
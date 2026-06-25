const leftSide = "B.S. in Computer Science University of California, Berkeley";
const degreePattern = /\b(b\.?\s?s\.?|b\.?\s?a\.?|b\.?\s?eng\.?|b\.?\s?tech|m\.?\s?s\.?|m\.?\s?a\.?|mba|ph\.?d|bachelor|master|doctorate|diploma|certificate|associate|degree|high\s+school)\b/gi;

console.log("matchAll matches:");
const degMatches = Array.from(leftSide.matchAll(degreePattern));
for (const m of degMatches) {
  console.log("match:", m[0], "index:", m.index);
}

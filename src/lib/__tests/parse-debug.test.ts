import { describe, it } from "vitest";
import { parseResumeFile } from "../parser";
import * as fs from "fs";
import * as path from "path";

describe("Diagnose uploaded PDF parsing", () => {
  it("parses the PDFs in the brain directory", async () => {
    const brainDir = "C:\\Users\\InGodWeTrust\\.gemini\\antigravity\\brain\\96fe2b76-f159-456e-b2d3-e876c85a991e";
    const pdfs = ["media__1782480563587.pdf", "media__1782480550147.pdf"];

    for (const name of pdfs) {
      const fullPath = path.join(brainDir, name);
      if (!fs.existsSync(fullPath)) {
        console.log(`File not found: ${fullPath}`);
        continue;
      }
      console.log(`\n==================================================`);
      console.log(`PARSING: ${name}`);
      console.log(`==================================================`);

      try {
        // Read file into Buffer
        const buffer = fs.readFileSync(fullPath);
        // Create a File-like object
        const file = new File([buffer], name, { type: "application/pdf" });
        const result = await parseResumeFile(file);
        console.log(JSON.stringify(result, null, 2));
      } catch (err: any) {
        console.error(`Failed to parse ${name}:`, err.message);
      }
    }
  });
});

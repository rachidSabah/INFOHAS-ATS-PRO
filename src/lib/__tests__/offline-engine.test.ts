import { describe, it, expect } from "vitest";
import { localGenerate } from "../local-engine";
import type { AICallOptions } from "../ai";

describe("Local Engine Copilot", () => {
  const dummyResume = {
    id: "res-123",
    name: "John Doe",
    summary: "Experienced software engineer.",
    experience: [
      { id: "exp-1", title: "Software Engineer", company: "Tech Corp", bullets: ["Wrote code.", "Fixed bugs."] },
      { id: "exp-2", title: "Junior Engineer", company: "Web Shop", bullets: ["Helped out."] }
    ]
  };

  const systemPrompt = `You are a professional AI Resume Optimizer Copilot.
Here is the current resume context:
${JSON.stringify(dummyResume, null, 2)}`;

  it("should return a leadership rewrite patch when requested", () => {
    const opts: AICallOptions = {
      systemPrompt,
      userPrompt: "rewrite the first job experience bullet points to focus on leadership",
      taskCategory: "document"
    };

    const response = localGenerate(opts);
    expect(response).toContain("[PATCH]");
    expect(response).toContain("Spearheaded");
    expect(response).toContain("exp-1"); // Checks that it parsed the correct ID from the context

    // Check JSON validity of the patch block
    const parts = response.split("[PATCH]");
    const patchJson = JSON.parse(parts[1].trim());
    expect(patchJson.experience[0].id).toBe("exp-1");
    expect(patchJson.experience[0].bullets.length).toBeGreaterThan(0);
  });

  it("should return a shortened summary patch when requested", () => {
    const opts: AICallOptions = {
      systemPrompt,
      userPrompt: "shorten the summary to be under 3 sentences",
      taskCategory: "document"
    };

    const response = localGenerate(opts);
    expect(response).toContain("[PATCH]");
    
    const parts = response.split("[PATCH]");
    const patchJson = JSON.parse(parts[1].trim());
    expect(patchJson.summary).toContain("Trilingual Professional");
  });

  it("should return quantified metrics patch when requested", () => {
    const opts: AICallOptions = {
      systemPrompt,
      userPrompt: "make my experience bullet points contain more quantified metrics",
      taskCategory: "document"
    };

    const response = localGenerate(opts);
    expect(response).toContain("[PATCH]");

    const parts = response.split("[PATCH]");
    const patchJson = JSON.parse(parts[1].trim());
    expect(patchJson.experience.length).toBe(2);
    expect(patchJson.experience[0].id).toBe("exp-1");
    expect(patchJson.experience[1].id).toBe("exp-2");
  });
});

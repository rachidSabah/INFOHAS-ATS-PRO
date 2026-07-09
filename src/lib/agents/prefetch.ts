// Speculative Pre-Fetching Agent. Runs in the background to analyze JDs and compute skill gaps.
"use client";

import { analyzeJobIntelligence } from "../job-intelligence";
import { analyzeCompanyIntelligence, analyzeSkillGap } from "./company-skill-agents";
import type { ResumeData, JobDescription } from "../types";

export async function startSpeculativePrefetch(resume: ResumeData, jd: JobDescription): Promise<void> {
  console.info(`[Prefetch] Starting speculative pre-fetch for JD: ${jd.title} (${jd.id})`);
  
  // Run Job Intelligence & Company Intelligence in parallel in background
  Promise.allSettled([
    analyzeJobIntelligence(jd),
    analyzeCompanyIntelligence(jd, null)
  ]).then(async (results) => {
    const jiRes = results[0];
    const ciRes = results[1];
    
    const ji = jiRes.status === "fulfilled" ? jiRes.value : null;
    const ci = ciRes.status === "fulfilled" ? ciRes.value : null;
    
    if (ji) {
      console.info(`[Prefetch] Speculative Job Intelligence complete.`);
      // Run Skill Gap analysis (requires Job Intelligence)
      try {
        await analyzeSkillGap(resume, jd, ji, ci);
        console.info(`[Prefetch] Speculative Skill Gap complete.`);
      } catch (e) {
        console.warn(`[Prefetch] Speculative Skill Gap failed:`, e);
      }
    }
  }).catch((err) => {
    console.warn(`[Prefetch] Speculative pre-fetch failed:`, err);
  });
}

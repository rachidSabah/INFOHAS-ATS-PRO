// Prefetch cache module to store background-prefetched intelligence artifacts.
"use client";

import type { JobIntelligence } from "./job-intelligence";
import type { CompanyIntelligence, SkillGapIntelligence } from "./agents/company-skill-agents";

interface PrefetchCache {
  jobIntelligence: Record<string, JobIntelligence>;
  companyIntelligence: Record<string, CompanyIntelligence>;
  skillGap: Record<string, SkillGapIntelligence>;
}

const cache: PrefetchCache = {
  jobIntelligence: {},
  companyIntelligence: {},
  skillGap: {},
};

export const prefetchCache = {
  getJobIntelligence: (jdId: string): JobIntelligence | null => {
    return cache.jobIntelligence[jdId] || null;
  },
  setJobIntelligence: (jdId: string, val: JobIntelligence): void => {
    cache.jobIntelligence[jdId] = val;
  },
  
  getCompanyIntelligence: (jdId: string): CompanyIntelligence | null => {
    return cache.companyIntelligence[jdId] || null;
  },
  setCompanyIntelligence: (jdId: string, val: CompanyIntelligence): void => {
    cache.companyIntelligence[jdId] = val;
  },
  
  getSkillGap: (resumeId: string, jdId: string): SkillGapIntelligence | null => {
    return cache.skillGap[`${resumeId}:${jdId}`] || null;
  },
  setSkillGap: (resumeId: string, jdId: string, val: SkillGapIntelligence): void => {
    cache.skillGap[`${resumeId}:${jdId}`] = val;
  },
};

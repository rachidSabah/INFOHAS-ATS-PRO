// ============================================================================
// MemoryAgent — persists a user's career profile + history across sessions.
//
// Stores:
//   - skills, certifications, industries, target roles, preferred locations,
//     languages, salary expectations
//   - application history, optimization history, interview history
//
// Persistence:
//   - localStorage (`resumeai-memory-profile`) — survives refresh/logout/login
//   - Best-effort sync to D1 via the existing cloud API (future enhancement)
//
// The Supervisor and other agents read this profile to personalize their
// recommendations (e.g. the Career Coach recommends certifications aligned
// with the user's target roles; the Salary Agent uses the user's salary
// expectation as a baseline).
// ============================================================================

export interface UserProfile {
  // === Career profile (aggregated from all resumes + JDs the user has ever uploaded) ===
  skills: string[]; // unique, sorted by frequency
  certifications: string[];
  industries: string[]; // industries the user has worked in or applied to
  targetRoles: string[]; // roles the user is actively targeting
  preferredLocations: string[];
  languages: string[];
  salaryExpectations: { role: string; min: number; mid: number; max: number; currency: string }[];

  // === History ===
  applicationHistory: ApplicationEntry[];
  optimizationHistory: OptimizationEntry[];
  interviewHistory: InterviewEntry[];

  // === Metadata ===
  updatedAt: string;
}

export interface ApplicationEntry {
  id: string;
  company: string;
  role: string;
  status: "saved" | "applied" | "interview" | "assessment" | "offer" | "rejected" | "ghosted";
  appliedAt: string;
  notes?: string;
}

export interface OptimizationEntry {
  id: string;
  resumeName: string;
  jobTitle: string;
  company: string;
  atsBefore: number;
  atsAfter: number;
  createdAt: string;
}

export interface InterviewEntry {
  id: string;
  company: string;
  role: string;
  score: number;
  createdAt: string;
}

const MEMORY_KEY = "resumeai-memory-profile";

// ============================================================================
// Load / save
// ============================================================================

export function loadUserProfile(): UserProfile {
  if (typeof localStorage === "undefined") return createEmptyProfile();
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return createEmptyProfile();
    const parsed = JSON.parse(raw);
    return { ...createEmptyProfile(), ...parsed };
  } catch {
    return createEmptyProfile();
  }
}

export function saveUserProfile(profile: UserProfile): void {
  if (typeof localStorage === "undefined") return;
  try {
    profile.updatedAt = new Date().toISOString();
    localStorage.setItem(MEMORY_KEY, JSON.stringify(profile));
  } catch (e) {
    console.warn("[MemoryAgent] Failed to save profile:", e);
  }
}

export function createEmptyProfile(): UserProfile {
  return {
    skills: [],
    certifications: [],
    industries: [],
    targetRoles: [],
    preferredLocations: [],
    languages: [],
    salaryExpectations: [],
    applicationHistory: [],
    optimizationHistory: [],
    interviewHistory: [],
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Aggregation — called whenever a resume is uploaded or a JD is parsed
// ============================================================================

/**
 * Merge skills/certs/languages from a resume into the user profile.
 * Deduplicates and sorts skills by frequency (most-used first).
 */
export function ingestResumeIntoMemory(profile: UserProfile, resume: { skills?: any[]; certifications?: any[]; languages?: any[]; name?: string }): UserProfile {
  const next = { ...profile };
  const skillFreq: Record<string, number> = {};
  for (const s of next.skills) skillFreq[s] = (skillFreq[s] || 0) + 1;
  for (const s of (resume.skills ?? [])) {
    const name = typeof s === "string" ? s : s?.name;
    if (name && typeof name === "string") skillFreq[name] = (skillFreq[name] || 0) + 1;
  }
  next.skills = Object.entries(skillFreq)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

  const certSet = new Set(next.certifications);
  for (const c of (resume.certifications ?? [])) {
    const name = typeof c === "string" ? c : c?.name;
    if (name && typeof name === "string") certSet.add(name);
  }
  next.certifications = Array.from(certSet);

  const langSet = new Set(next.languages);
  for (const l of (resume.languages ?? [])) {
    const name = typeof l === "string" ? l : l?.name;
    if (name && typeof name === "string") langSet.add(name);
  }
  next.languages = Array.from(langSet);

  saveUserProfile(next);
  return next;
}

/**
 * Merge industry/company/role from a JD into the user profile.
 */
export function ingestJobIntoMemory(profile: UserProfile, jd: { title?: string; company?: string; location?: string }): UserProfile {
  const next = { ...profile };
  if (jd.title && !next.targetRoles.includes(jd.title)) {
    next.targetRoles = [jd.title, ...next.targetRoles].slice(0, 20);
  }
  if (jd.location && !next.preferredLocations.includes(jd.location)) {
    next.preferredLocations = [jd.location, ...next.preferredLocations].slice(0, 10);
  }
  saveUserProfile(next);
  return next;
}

/**
 * Record an optimization run in the user's history.
 */
export function recordOptimization(profile: UserProfile, entry: OptimizationEntry): UserProfile {
  const next = { ...profile, optimizationHistory: [entry, ...profile.optimizationHistory].slice(0, 50) };
  saveUserProfile(next);
  return next;
}

/**
 * Record an application in the user's history.
 */
export function recordApplication(profile: UserProfile, entry: ApplicationEntry): UserProfile {
  const next = { ...profile, applicationHistory: [entry, ...profile.applicationHistory].slice(0, 100) };
  saveUserProfile(next);
  return next;
}

/**
 * Record an interview in the user's history.
 */
export function recordInterview(profile: UserProfile, entry: InterviewEntry): UserProfile {
  const next = { ...profile, interviewHistory: [entry, ...profile.interviewHistory].slice(0, 50) };
  saveUserProfile(next);
  return next;
}

// ============================================================================
// Human Approval Gate Unit Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runOptimizationPipeline } from '../orchestrator';
import type { ResumeData, JobDescription } from '../../types';

// Mock dependecies to avoid calling real LLMs/stores
vi.mock('../../ai', () => ({
  callAI: vi.fn().mockResolvedValue({
    text: JSON.stringify({
      name: 'Jane Doe',
      headline: 'Optimized Software Engineer',
      summary: 'Experienced developer',
      skills: [],
      experience: [],
      education: [],
      languages: [],
    }),
    provider: 'MockProvider',
    latencyMs: 10,
    tokensEstimate: 100,
  }),
  extractJSON: vi.fn((x) => JSON.parse(x)),
  getOptimizerDirective: vi.fn(() => 'Test directive'),
}));

vi.mock('../../store', () => ({
  useApp: {
    getState: vi.fn(() => ({
      providers: [],
      flags: {},
      providerSettings: { autoHealProviders: false },
    })),
  },
}));

// Mock the locked pipeline with a VALID optimization result so the pipeline
// reaches the approval gates. (The old degraded-original flow no longer exists:
// when the optimizer cannot produce a valid result the pipeline returns
// recoverable_error and never reaches an approval gate — see
// orchestrator.degraded.test.ts.)
vi.mock('../../locked-pipeline', () => ({
  runLockedPipeline: vi.fn(() =>
    Promise.resolve({
      resume: {
        id: 'r-1',
        name: 'Jane Doe',
        headline: 'Optimized Software Engineer',
        contact: { email: 'jane@example.com', phone: '123-456-7890', location: 'New York' },
        summary: 'Experienced TypeScript developer with a strong record of building scalable systems, mentoring engineers, and delivering reliable platforms.',
        experience: [
          {
            id: 'e1',
            title: 'Software Engineer',
            company: 'Tech Corp',
            location: 'New York',
            startDate: '2020-01',
            endDate: 'Present',
            bullets: [
              'Built scalable TypeScript services handling 1M+ requests/day with 99.9% uptime.',
              'Mentored 4 engineers and led the migration to typed APIs, cutting runtime errors by 40%.',
            ],
          },
        ],
        education: [],
        skills: [{ id: 's1', name: 'TypeScript', category: 'Languages' }],
        languages: [],
        projects: [],
        certifications: [],
        template: 'ats-professional',
        createdAt: '',
        updatedAt: '',
      },
      provider: 'MockProvider',
      charCount: 3000,
      keywordsAdded: 2,
      warnings: [],
      errors: [],
      guardianScore: 95,
      guardianStatus: 'PASS',
      fingerprintValid: true,
      blueprintValid: true,
      templateBlueprintValid: true,
      retryCount: 1,
      isDegraded: false,
      keywordCoverage: { total: 2, alreadyPresent: 0, integrated: 2, stillMissing: [], coveragePct: 100 },
      assemblerStats: { matchedById: 1, matchedByFingerprint: 0, matchedByTitleCompany: 0, matchedByIndex: 0, unmatched: 0 },
    }),
  ),
}));

vi.mock('../ats-analysis', () => ({
  analyzeATS: vi.fn(() => ({
    scores: { ats: 85, keywords: 80 },
    missingKeywords: [],
    matchedKeywords: [],
  })),
}));

vi.mock('../qa-agent', () => ({
  runQA: vi.fn(() => ({
    confidence: 90,
    checks: [{ passed: true, name: 'Factual consistency' }],
    factualConsistency: { passed: true, fabricatedEmployers: [], fabricatedEducation: [], fabricatedCertifications: [], issueCount: 0 },
  })),
}));

describe('Human Approval Gate in runOptimizationPipeline', () => {
  let mockResume: ResumeData;
  let mockJD: JobDescription;

  beforeEach(() => {
    mockResume = {
      id: 'r-1',
      name: 'Jane Doe',
      headline: 'Software Engineer',
      contact: { email: 'jane@example.com', phone: '123-456-7890', location: 'New York' },
      summary: 'Experienced dev',
      skills: [],
      experience: [],
      education: [],
      languages: [],
      projects: [],
      certifications: [],
      createdAt: '',
      updatedAt: '',
      template: 'ats-professional',
    };

    mockJD = {
      id: 'jd-1',
      title: 'Senior Engineer',
      company: 'Tech Corp',
      rawText: 'TypeScript experience required.',
      keywords: ['TypeScript'],
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      technologies: [],
      createdAt: '',
    };
  });

  it('succeeds and proceeds when requestApproval returns true', async () => {
    const requestApproval = vi.fn().mockResolvedValue(true);

    const result = await runOptimizationPipeline({
      resume: { ...mockResume, experience: [
        {
          id: 'e1',
          title: 'Software Engineer',
          company: 'Tech Corp',
          location: 'New York',
          startDate: '2020-01',
          endDate: 'Present',
          bullets: [
            'Built scalable services handling 1M+ requests/day with 99.9% uptime.',
            'Mentored 4 engineers and led the migration to typed APIs.',
          ],
        },
      ] },
      jd: mockJD,
      requestApproval,
    });

    expect(result.status).not.toBe('failed');
    expect(result.status).not.toBe('recoverable_error');
    expect(requestApproval).toHaveBeenCalled();
  });

  it('fails and aborts when requestApproval returns false', async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);

    const result = await runOptimizationPipeline({
      resume: { ...mockResume, experience: [
        {
          id: 'e1',
          title: 'Software Engineer',
          company: 'Tech Corp',
          location: 'New York',
          startDate: '2020-01',
          endDate: 'Present',
          bullets: [
            'Built scalable services handling 1M+ requests/day with 99.9% uptime.',
            'Mentored 4 engineers and led the migration to typed APIs.',
          ],
        },
      ] },
      jd: mockJD,
      requestApproval,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('User rejected');
  });
});

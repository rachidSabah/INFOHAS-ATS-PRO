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
    })),
  },
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
      resume: mockResume,
      jd: mockJD,
      requestApproval,
    });

    expect(result.status).not.toBe('failed');
    expect(requestApproval).toHaveBeenCalled();
  });

  it('fails and aborts when requestApproval returns false', async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);

    const result = await runOptimizationPipeline({
      resume: mockResume,
      jd: mockJD,
      requestApproval,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('User rejected');
  });
});


import { describe, it, expect } from 'vitest';
import { runUnifiedPipeline } from '../unified-pipeline';
import { ResumeData } from '../types';

describe('Data Loss Reproduction', () => {
  const mockOriginalResume: ResumeData = {
    id: 'orig-123',
    name: 'AROUA EL HILALI',
    headline: 'Hospitality Professional',
    contact: {
      email: 'arouaeel@gmail.com',
      phone: '+212 644004991',
      location: 'RABAT, MOROCCO'
    },
    summary: 'Highly motivated professional...',
    experience: [
      {
        id: 'exp-1',
        company: 'The millennium Hotel & Resort',
        title: 'Intern Receptionist',
        location: 'Bahrain',
        startDate: '2025-02',
        endDate: '2025-05',
        bullets: ['Bullet 1']
      }
    ],
    education: [
      {
        id: 'edu-1',
        institution: 'INFOHAS',
        degree: 'Diploma',
        startDate: '2023',
        endDate: '2025',
        highlights: ['Module 1']
      }
    ],
    skills: [{ id: 's1', name: 'Excel', category: 'Technical' }],
    languages: [
      { id: 'l1', name: 'English', proficiency: 'fluent' },
      { id: 'l2', name: 'French', proficiency: 'fluent' },
      { id: 'l3', name: 'Arabic', proficiency: 'native' }
    ],
    certifications: [],
    projects: [],
    dateOfBirth: '2005-02-21',
    additionalInfo: 'Willing to relocate, Height 1m72',
    dynamicSections: [
      {
        id: 'ds-1',
        title: 'Interests',
        normalizedTitle: 'interests',
        content: 'Reading, Traveling',
        bullets: [],
        order: 10,
        source: 'parsed',
        immutable: true
      }
    ],
    template: 'infohas-pro',
    accentColor: '#000000',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const mockAiOutput = JSON.stringify({
    summary: 'Optimized summary',
    headline: 'Optimized Headline',
    skills: [{ name: 'Excel', category: 'Technical' }, { name: 'Customer Service', category: 'Soft Skills' }],
    experience: [
      {
        id: 'exp-1',
        bullets: ['Optimized Bullet 1']
      }
    ]
  });

  it('should preserve dateOfBirth, additionalInfo and dynamicSections', () => {
    const result = runUnifiedPipeline(mockAiOutput, mockOriginalResume);
    
    expect(result.resume.dateOfBirth).toBe(mockOriginalResume.dateOfBirth);
    expect(result.resume.additionalInfo).toBe(mockOriginalResume.additionalInfo);
    expect(result.resume.dynamicSections).toBeDefined();
    expect(result.resume.dynamicSections?.length).toBe(mockOriginalResume.dynamicSections?.length);
    expect(result.resume.dynamicSections?.[0].title).toBe('Interests');
  });

  it('should preserve all languages with proficiency', () => {
    const result = runUnifiedPipeline(mockAiOutput, mockOriginalResume);
    
    expect(result.resume.languages.length).toBe(3);
    expect(result.resume.languages.find(l => l.name === 'French')?.proficiency).toBe('fluent');
  });
});

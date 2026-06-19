// ResumeAI Pro — Interactive Onboarding System
// First-time user walkthrough, smart tooltips, progress indicator

"use client";

import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Icon, Badge } from "@/components/shared";
import { useApp } from "@/lib/store";

const ONBOARDING_KEY = "resumeai-onboarding-completed";

interface OnboardingState {
  isActive: boolean;
  currentStep: number;
  completedSteps: string[];
  totalSteps: number;
}

interface OnboardingStep {
  id: string;
  view: string;
  title: string;
  description: string;
  icon: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: "upload", view: "resumes", title: "Upload Your Resume", description: "Upload your existing resume (PDF, DOCX, or TXT) to get started. The AI will parse it automatically.", icon: "Upload" },
  { id: "ats-check", view: "ats-checker", title: "Check ATS Score", description: "Run an ATS check to see how your resume scores against a job description. Get instant feedback on missing keywords.", icon: "ScanText" },
  { id: "optimize", view: "optimizer", title: "Optimize Your Resume", description: "Upload your resume and a job description. The AI will rewrite your resume to match the job requirements while staying truthful.", icon: "Wand2" },
  { id: "jd-scraper", view: "jd-scraper", title: "Analyze Job URLs", description: "Paste any job posting URL. The AI will extract structured data: skills, responsibilities, keywords.", icon: "Search" },
  { id: "cover-letter", view: "cover-letter", title: "Generate Cover Letters", description: "Create tailored cover letters in 4 styles: modern, traditional, executive, or email.", icon: "Mail" },
  { id: "interview", view: "interview", title: "Prepare for Interviews", description: "Get AI-generated interview questions with STAR-method answers tailored to your target role.", icon: "MessagesSquare" },
  { id: "skill-gap", view: "skill-gap", title: "Analyze Skill Gaps", description: "Compare your skills to a job description and see exactly what's missing.", icon: "GitCompare" },
  { id: "export", view: "downloads", title: "Export Your Resume", description: "Download your optimized resume as PDF, DOCX, or TXT — formatted for one A4 page.", icon: "Download" },
  { id: "ai-coach", view: "ai-coach", title: "AI Career Coach", description: "Chat with an AI career advisor for personalized guidance on any career question.", icon: "Bot" },
  { id: "mock-interview", view: "ai-mock-interview", title: "Practice Interviews", description: "Do a mock interview with the AI. It asks real questions and gives feedback on your answers.", icon: "Mic" },
];

const OnboardingContext = createContext<{
  isActive: boolean;
  currentStep: number;
  startOnboarding: () => void;
  skipOnboarding: () => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (index: number) => void;
  completedSteps: string[];
  markStepCompleted: (stepId: string) => void;
  isCompleted: boolean;
} | null>(null);

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    return {
      isActive: false,
      currentStep: 0,
      startOnboarding: () => {},
      skipOnboarding: () => {},
      nextStep: () => {},
      prevStep: () => {},
      goToStep: () => {},
      completedSteps: [],
      markStepCompleted: () => {},
      isCompleted: true,
    };
  }
  return ctx;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const setView = useApp((s) => s.setView);
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (completed === "true") {
      setIsCompleted(true);
    } else {
      // Auto-start onboarding for first-time users after a short delay
      const timer = setTimeout(() => {
        if (!completed) setIsActive(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const startOnboarding = () => {
    setIsActive(true);
    setCurrentStep(0);
    setView(ONBOARDING_STEPS[0].view as any);
  };

  const skipOnboarding = () => {
    setIsActive(false);
    setIsCompleted(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(ONBOARDING_KEY, "true");
    }
  };

  const nextStep = () => {
    const step = ONBOARDING_STEPS[currentStep];
    setCompletedSteps((prev) => prev.includes(step.id) ? prev : [...prev, step.id]);
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      setView(ONBOARDING_STEPS[next].view as any);
    } else {
      skipOnboarding();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      const prev = currentStep - 1;
      setCurrentStep(prev);
      setView(ONBOARDING_STEPS[prev].view as any);
    }
  };

  const goToStep = (index: number) => {
    setCurrentStep(index);
    setView(ONBOARDING_STEPS[index].view as any);
  };

  const markStepCompleted = (stepId: string) => {
    setCompletedSteps((prev) => prev.includes(stepId) ? prev : [...prev, stepId]);
  };

  return (
    <OnboardingContext.Provider value={{
      isActive, currentStep, startOnboarding, skipOnboarding, nextStep, prevStep,
      goToStep, completedSteps, markStepCompleted, isCompleted,
    }}>
      {children}
      <OnboardingOverlay />
    </OnboardingContext.Provider>
  );
}

function OnboardingOverlay() {
  const { isActive, currentStep, nextStep, prevStep, skipOnboarding, completedSteps } = useOnboarding();

  if (!isActive) return null;

  const step = ONBOARDING_STEPS[currentStep];
  const progress = Math.round(((currentStep + 1) / ONBOARDING_STEPS.length) * 100);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] pointer-events-none flex items-end justify-center p-4 sm:p-8"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/30 pointer-events-auto" onClick={skipOnboarding} />

        {/* Tour card */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 50, opacity: 0 }}
          className="relative bg-card rounded-2xl border border-border shadow-premium max-w-md w-full p-6 pointer-events-auto"
        >
          {/* Progress bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-secondary rounded-t-2xl overflow-hidden">
            <div className="h-full bg-brand transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-between mb-4">
            <Badge variant="brand" className="text-[10px]">
              Step {currentStep + 1} of {ONBOARDING_STEPS.length}
            </Badge>
            <button onClick={skipOnboarding} className="text-xs text-muted-foreground hover:text-foreground">
              Skip tour
            </button>
          </div>

          {/* Content */}
          <div className="flex items-start gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
              <Icon name={step.icon} className="w-6 h-6 text-brand" />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg">{step.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
            </div>
          </div>

          {/* Step dots */}
          <div className="flex items-center gap-1.5 mb-4">
            {ONBOARDING_STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => i <= currentStep || completedSteps.includes(s.id) ? null : null}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep ? "w-6 bg-brand" : completedSteps.includes(s.id) ? "w-1.5 bg-emerald-500" : "w-1.5 bg-secondary"
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={prevStep} disabled={currentStep === 0} className="gap-1">
              <Icon name="ArrowLeft" className="w-3.5 h-3.5" /> Back
            </Button>
            <div className="flex items-center gap-2">
              {completedSteps.length > 0 && (
                <span className="text-xs text-muted-foreground">{completedSteps.length} completed</span>
              )}
              <Button size="sm" onClick={nextStep} className="bg-brand hover:bg-brand-dark text-white gap-1">
                {currentStep === ONBOARDING_STEPS.length - 1 ? "Finish" : "Next"}
                {currentStep < ONBOARDING_STEPS.length - 1 && <Icon name="ArrowRight" className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Onboarding trigger button — shown in the dashboard for users who haven't completed onboarding
 */
export function OnboardingTrigger() {
  const { isCompleted, startOnboarding } = useOnboarding();

  if (isCompleted) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={startOnboarding}
      className="gap-2 border-brand/30 text-brand hover:bg-brand/5"
    >
      <Icon name="Sparkles" className="w-3.5 h-3.5" />
      Take the tour
    </Button>
  );
}

/**
 * Setup progress indicator — shows how many onboarding steps the user has completed
 */
export function SetupProgress() {
  const { completedSteps, isCompleted } = useOnboarding();
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);

  if (isCompleted) return null;

  // Calculate real setup progress from actual user data
  const checks = [
    { label: "Resume uploaded", done: resumes.length > 0 },
    { label: "Job description added", done: jds.length > 0 },
    { label: "ATS check run", done: useApp.getState().atsReports.length > 0 },
    { label: "Onboarding tour", done: completedSteps.length >= 3 },
  ];
  const completedCount = checks.filter((c) => c.done).length;
  const progress = Math.round((completedCount / checks.length) * 100);

  return (
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Rocket" className="w-4 h-4 text-brand" />
          <span className="font-semibold text-sm">Setup Progress</span>
        </div>
        <span className="text-xs font-bold text-brand">{progress}%</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-1.5 text-xs">
            <Icon
              name={check.done ? "CheckCircle2" : "Circle"}
              className={`w-3.5 h-3.5 ${check.done ? "text-emerald-500" : "text-muted-foreground"}`}
            />
            <span className={check.done ? "text-foreground" : "text-muted-foreground"}>{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

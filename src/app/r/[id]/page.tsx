"use client";
export const runtime = "edge";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { useApp } from "@/lib/store";
import { A4Preview } from "@/components/resume/A4Preview";
import { blankResume } from "@/lib/parser";
import type { ResumeData } from "@/lib/types";

export default function PublicResumePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const resumeId = params.id as string;
  const encodedData = searchParams.get("d");
  const resumes = useApp((s) => s.resumes);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);

  // Decode fallback data from URL (for cross-device sharing)
  const decodedResume = useMemo(() => {
    if (!encodedData) return null;
    try {
      const raw = JSON.parse(atob(decodeURIComponent(encodedData)));
      const r = blankResume();
      r.id = resumeId;
      r.name = raw.n || "";
      r.headline = raw.h || "";
      r.summary = raw.s || "";
      r.experience = (raw.e || []).map((e: any) => ({
        id: "s_" + Math.random().toString(36).slice(2, 9),
        title: e.t, company: e.c, startDate: e.d?.split(" - ")[0] || "", endDate: e.d?.split(" - ")[1] || "", bullets: [],
      }));
      r.education = (raw.edu || []).map((e: any) => ({
        id: "s_" + Math.random().toString(36).slice(2, 9),
        degree: e.d, institution: e.i || "", startDate: "", endDate: "",
      }));
      r.skills = (raw.sk || []).map((name: string) => ({ id: "s_" + Math.random().toString(36).slice(2, 9), name, category: "" }));
      r.languages = (raw.l || []).map((name: string) => ({ id: "s_" + Math.random().toString(36).slice(2, 9), name, proficiency: "" }));
      return r;
    } catch { return null; }
  }, [encodedData, resumeId]);

  useEffect(() => {
    if (resumeId && resumes.length > 0) {
      const found = resumes.find((r) => r.id === resumeId);
      if (found) { setResume(found); setLoading(false); return; }
    }
    // Fallback to URL-encoded data
    if (decodedResume) { setResume(decodedResume); setLoading(false); return; }
    setLoading(false);
  }, [resumeId, resumes, decodedResume]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-brand border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!resume) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Resume Not Found</h1>
        <p className="text-gray-600 mb-4">This resume link may have expired or been removed.</p>
        <a href="/" className="text-brand hover:underline font-medium">Create your own at ResumeAI Pro</a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Public resume banner */}
      <div className="bg-brand text-white py-2 px-4 text-center text-sm flex items-center justify-center gap-2">
        <span>📄 Public resume view</span>
        <span className="opacity-60">•</span>
        <a href="/" className="underline hover:opacity-80">Create yours at ResumeAI Pro</a>
      </div>
      
      {/* Resume preview */}
      <div className="max-w-[210mm] mx-auto py-8 px-4">
        <div className="bg-white shadow-xl rounded-sm">
          <A4Preview resume={resume} />
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-6 text-sm text-gray-400">
        Powered by <a href="/" className="text-brand hover:underline font-medium">ResumeAI Pro</a> — ATS-Optimized Resume Builder
      </div>
    </div>
  );
}

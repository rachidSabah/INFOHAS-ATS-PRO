"use client";
export const runtime = "edge";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, useMemo, Suspense } from "react";
import { useApp } from "@/lib/store";
import { api as cloudApi } from "@/lib/cloud-api";
import { A4Preview } from "@/components/resume/A4Preview";
import { blankResume } from "@/lib/parser";
import type { ResumeData } from "@/lib/types";

/**
 * Public resume reader — three resolution paths, in order:
 *  1. Local store lookup (legacy same-device /r/<resumeId> links).
 *  2. NEW: cloud share snapshot — /r/<shareToken> → GET /api/public/shares/:token.
 *     Works cross-device, serves the exact snapshot the owner published, and
 *     bumps the owner's view counter server-side.
 *  3. Legacy ?d= base64 blob (kept for old links already in circulation —
 *     lossy: no contact info, no bullets — superseded by path 2).
 */
export default function PublicResumePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-brand border-t-transparent rounded-full" />
        </div>
      }
    >
      <PublicResumeContent />
    </Suspense>
  );
}

function PublicResumeContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const resumeId = params.id as string;
  const encodedData = searchParams.get("d");
  const resumes = useApp((s) => s.resumes);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharedAt, setSharedAt] = useState<string | null>(null);
  const [contactHidden, setContactHidden] = useState(false);

  // Decode fallback data from URL (legacy cross-device sharing)
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
    let cancelled = false;

    const finish = (r: ResumeData, opts: { fromShare?: boolean; sharedAt?: string; contactHidden?: boolean } = {}) => {
      if (cancelled) return;
      // Defensive completeness — templates iterate arrays directly.
      const safe: ResumeData = {
        ...r,
        experience: Array.isArray(r.experience) ? r.experience : [],
        education: Array.isArray(r.education) ? r.education : [],
        skills: Array.isArray(r.skills) ? r.skills : [],
        projects: Array.isArray(r.projects) ? r.projects : [],
        certifications: Array.isArray(r.certifications) ? r.certifications : [],
        languages: Array.isArray(r.languages) ? r.languages : [],
      };
      setResume(safe);
      setSharedAt(opts.sharedAt || null);
      setContactHidden(!!opts.fromShare && (!!safe.shareContactHidden || !!opts.contactHidden));
      setLoading(false);
    };

    (async () => {
      // 1) Local store (same-device legacy links)
      if (resumeId && resumes.length > 0) {
        const found = resumes.find((r) => r.id === resumeId);
        if (found) { finish(found); return; }
      }
      // 2) Cloud share snapshot — any cross-device /r/<token> link
      try {
        const data = await cloudApi.fetchPublicShare(resumeId);
        if (data?.resume) {
          finish(data.resume as ResumeData, { fromShare: true, sharedAt: data.sharedAt, contactHidden: data.hideContact });
          return;
        }
      } catch { /* not a share token (or offline) → try the legacy blob */ }
      // 3) Legacy URL-encoded data
      if (decodedResume) { finish(decodedResume); return; }
      if (cancelled) return;
      setLoading(false);
    })();

    return () => { cancelled = true; };
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
        <p className="text-gray-600 mb-4">This resume link may have expired, been paused, or been removed.</p>
        <a href="/" className="text-brand hover:underline font-medium">Create your own at ResumeAI Pro</a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Public resume banner */}
      <div className="bg-brand text-white py-2 px-4 text-center text-sm flex flex-wrap items-center justify-center gap-2">
        <span>📄 Public resume view</span>
        {sharedAt && <span className="opacity-70">• Snapshot of {new Date(sharedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>}
        <span className="opacity-60">•</span>
        <a href="/" className="underline hover:opacity-80">Create yours at ResumeAI Pro</a>
      </div>

      {contactHidden && (
        <div className="bg-amber-50 border-b border-amber-200 py-2 px-4 text-center text-sm text-amber-800">
          🔒 The owner chose to hide contact details in this public view — reach out via the application channel instead.
        </div>
      )}

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

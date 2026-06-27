"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import type { ResumeData, JobDescription } from "../types";

export interface ContentTip { text: string; type: "keyword" | "metric" | "action" | "length"; icon: string; }

export function useSmartSuggestions(resume: ResumeData | undefined, jd: JobDescription | undefined, activeField: { section: string; currentText: string } | null): ContentTip[] {
  return useMemo(() => {
    if (!resume || !jd || !activeField) return [];
    const tips: ContentTip[] = [];
    const jdKeywords = (jd.keywords || []).map(k => k.toLowerCase());
    const currentLower = activeField.currentText.toLowerCase();
    if (activeField.section === "bullet") {
      if (!/\d/.test(activeField.currentText)) tips.push({ text: "Add a metric (%, $, number) to strengthen", type: "metric", icon: "BarChart3" });
      const missKw = jdKeywords.filter(k => !currentLower.includes(k)).slice(0, 3);
      if (missKw.length > 0) tips.push({ text: "Missing JD keywords: " + missKw.join(", "), type: "keyword", icon: "Search" });
      if (!/^(managed|led|built|developed|designed|implemented|reduced|increased)/i.test(activeField.currentText)) tips.push({ text: "Start with action verb: Managed, Led, Built...", type: "action", icon: "Zap" });
    }
    if (activeField.section === "summary") {
      const words = activeField.currentText.split(/\s+/).filter(Boolean).length;
      if (words < 60) tips.push({ text: "Too short (" + words + " words). Aim for 60-90.", type: "length", icon: "AlignLeft" });
    }
    return tips;
  }, [resume, jd, activeField]);
}

const CMN = new Set("the and for that this with from have been were they their will would about which into after other over some could these than then just because through during before between under should still while being where those first great place world house point state large small right high light night early young along again never since think might found years going today water later money music human media power group level order focus issue month price image paper style model class table space range total major local final legal green black white south north east known clear whole ready close short wrong heavy lower upper quick new old big long own see use way man day got say get go work need feel life hand part case week side type hour care love page food area body door head line text form plan team data role list mind city told open free past hard warm cold deep away live best real able easy sure back fast keep good show well year face move call turn home help talk look want room give take read land play less view more much very only most each such both even many next last".split(" "));

export interface SpellIssue { word: string; start: number; end: number; }

export function useSpellCheck(text: string, enabled = true): { issues: SpellIssue[]; loading: boolean } {
  const [issues, setIssues] = useState<SpellIssue[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !text || text.length < 10) { setIssues([]); return; }
    const t = setTimeout(() => {
      setLoading(true);
      const words = text.match(/[a-zA-Z]{4,}/g) || [];
      const unique = [...new Set(words.map(w => w.toLowerCase()))];
      const found: SpellIssue[] = [];
      for (const word of unique) {
        if (!CMN.has(word) && !/ing$|ed$|ly$|tion$|ment$/.test(word)) {
          const idx = text.toLowerCase().indexOf(word);
          if (idx >= 0) found.push({ word, start: idx, end: idx + word.length });
        }
      }
      setIssues(found.slice(0, 8));
      setLoading(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [text, enabled]);
  return { issues: issues.slice(0, 5), loading };
}

export interface SectionScore { label: string; score: number; max: number; icon: string; tips: string[]; }

export function useSectionCompleteness(resume: ResumeData | undefined): SectionScore[] {
  return useMemo(() => {
    if (!resume) return [];
    return [
      { label: "Contact", score:(resume.name?1:0)+(resume.email?1:0)+(resume.phone?1:0), max:3, icon:"User", tips:!resume.email?["Add email"]:[] },
      { label: "Summary", score:((resume.summary||"").split(/\s+/).filter(Boolean).length>40?3:0), max:3, icon:"FileText", tips:!resume.summary?["Write summary"]:[] },
      { label: "Experience", score:Math.min((resume.experience||[]).length,3), max:3, icon:"Briefcase", tips:[] },
      { label: "Education", score:Math.min((resume.education||[]).length,2), max:2, icon:"GraduationCap", tips:[] },
      { label: "Skills", score:Math.min(Math.ceil((resume.skills||[]).length/3),3), max:3, icon:"Tags", tips:(resume.skills||[]).length<3?["Add 5+ skills"]:[] },
      { label: "Languages", score:(resume.languages||[]).length>0?2:0, max:2, icon:"Languages", tips:(resume.languages||[]).length===0?["Add languages"]:[] },
    ];
  }, [resume]);
}

export function useDragReorder<T extends { id: string }>(items: T[], onReorder: (items: T[]) => void) {
  const [dragIndex, setDragIndex] = useState<number|null>(null);
  const dragStart = useCallback((i:number)=>setDragIndex(i),[]);
  const dragOver = useCallback((e:React.DragEvent,i:number)=>{e.preventDefault();if(dragIndex===null||dragIndex===i)return;const n=[...items];const[m]=n.splice(dragIndex,1);n.splice(i,0,m);onReorder(n);setDragIndex(i);},[items,dragIndex,onReorder]);
  const dragEnd = useCallback(()=>setDragIndex(null),[]);
  return { dragStart, dragOver, dragEnd, dragIndex };
}

export function useKeyboardShortcuts(handlers: Record<string,()=>void>) {
  useEffect(()=>{const h=(e:KeyboardEvent)=>{const k=(e.ctrlKey||e.metaKey?"Ctrl+":"")+e.key;(handlers[k]||handlers[e.key])?.();e.preventDefault();};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[handlers]);
}

export function validateField(field:string,value:string):string|null{switch(field){case"email":return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?null:"Invalid email";case"phone":return/^[\+\d\s\-\(\)]{7,20}$/.test(value)?null:"Invalid phone";case"date":return/^(19|20)\d{2}-?(0[1-9]|1[0-2])?$/.test(value)||/\d{4}$/.test(value)?null:"Use YYYY or YYYY-MM";default:return null;}}

export const TEMPLATE_GALLERY=[{id:"infohas-pro",name:"InfoHAS Pro",desc:"Dark red headers, Times New Roman, A4",tags:["Professional"],layout:"single-column"},{id:"modern",name:"Modern",desc:"Clean sans-serif, blue accents",tags:["Modern"],layout:"two-column"},{id:"professional",name:"Classic",desc:"Traditional serif",tags:["Corporate"],layout:"single-column"},{id:"minimal",name:"Minimal",desc:"Ultra-clean, grayscale",tags:["Minimal"],layout:"single-column"},{id:"ats-friendly",name:"ATS-Optimized",desc:"Max keyword parsing",tags:["ATS"],layout:"single-column"}];

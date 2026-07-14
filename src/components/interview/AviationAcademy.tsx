"use client";

import { recordAI, setFlightScope } from "@/lib/ai/flight-recorder";
setFlightScope({ scope: "interview", feature: "Aviation Academy", module: "src.components.interview.AviationAcademy" });

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";
import { callAI } from "@/lib/ai";

// ============================================================================
// Data Constants
// ============================================================================

const SECTORS = [
  { id: "eu-hubs", label: "European Hubs (LHR, CDG, FRA)", duration: "Medium-Haul (6-8 hours)", focus: "High business travel volume, strict schedule compliance, meal service synchronization." },
  { id: "transatlantic", label: "Transatlantic Sectors (JFK, ORD, LAX)", duration: "Long-Haul (8-14 hours)", focus: "Premium cabin turn downs, crew fatigue management, rest periods, VIP/CIP handling." },
  { id: "me-short", label: "GCC / Middle East Short-Haul (DOH, RUH, KWI)", duration: "Short-Haul (1-3 hours)", focus: "Rapid service turnaround, high passenger loads, family/infant seating constraints." },
  { id: "asia-long", label: "East Asian Long-Haul (NRT, SIN, HKG)", duration: "Ultra-Long-Haul (10-16 hours)", focus: "Cross-cultural service customs, severe turbulence prep, dietary request compliance." }
];

const FLEETS = [
  { id: "a380", label: "Airbus A380 (Superjumbo)", crewSize: "24-26 Cabin Crew", keyFeature: "Double-deck, upper deck luxury lounges, first-class shower spas." },
  { id: "b777", label: "Boeing 777-300ER (Workhorse)", crewSize: "14-16 Cabin Crew", keyFeature: "High passenger density, complex galley synchronization." },
  { id: "b787", label: "Boeing 787 Dreamliner (Modern)", crewSize: "10-12 Cabin Crew", keyFeature: "Advanced cabin pressure, dimmable windows, low-humidity service." },
  { id: "a350", label: "Airbus A350-1000 (New Fleet)", crewSize: "12-14 Cabin Crew", keyFeature: "Intelligent ambient lighting, quietest twin-aisle cabin." }
];

const SONRU_QUESTIONS = [
  { id: "q1", text: "Why do you want to represent our airline and live in our hub city?", category: "Brand Alignment" },
  { id: "q2", text: "Describe a situation where you had to adapt quickly to a sudden crew operational change.", category: "Adaptability & CRM" },
  { id: "q3", text: "How would you handle a passenger refusing to turn off their phone during pre-departure safety sweeps?", category: "Safety Compliance" },
  { id: "q4", text: "Tell us about a time you went above and beyond to recover a guest's poor experience.", category: "Service Recovery" }
];

const GROUP_SCENARIOS = [
  {
    id: "sc-overbook",
    title: "Overbooked Flight Dilemma",
    scenario: "Flight EK003 to London is overbooked by 2 seats. You have 4 passengers waiting standby: a corporate executive (Frequent Flyer Platinum), a mother traveling with an infant, an elderly passenger requesting wheelchair assistance, and a student on a study abroad program. The gate agent is busy. How do you decide who gets boarded?",
    members: [
      { name: "Sarah (Purser)", role: "Facilitator", input: "I think we should prioritize safety and vulnerable passengers first, but we must protect the Platinum guest's brand loyalty." },
      { name: "Omar (Cabin Crew)", role: "Collaborator", input: "What if we offer a travel voucher upgrade to the student to travel on the next flight, allowing us to accommodate the mother and the elderly passenger?" }
    ]
  },
  {
    id: "sc-unruly",
    title: "Seat Allocation Conflict",
    scenario: "During boarding, a passenger in Economy Class complains loudly that they did not get their pre-ordered special meal (halal/kosher). They are refusing to sit, blocking the aisle and delaying the departure schedule. The flight is 100% full. How do you resolve this with the crew?",
    members: [
      { name: "Sarah (Purser)", role: "Facilitator", input: "We cannot delay takeoff. We need to seat the passenger immediately. Can we borrow a meal from Crew catering?" },
      { name: "Omar (Cabin Crew)", role: "Collaborator", input: "I can check if there are spare meals in the Business Class galley, or offer a premium dessert as service recovery." }
    ]
  }
];

const GROOMING_STANDARDS: Record<string, { lips: string; hair: string; nails: string; skin: string; jewelry: string }> = {
  emirates: {
    lips: "Classic bright red lipstick matching Emirates corporate red tone (neutral/cool red).",
    hair: "Neat low bun with red scrunchie/net, or structured French twist. No flyaways.",
    nails: "Clear polish, French manicure, or matching classic red polish.",
    skin: "Smooth, matte foundation finish, fresh appearance.",
    jewelry: "Classic pearl studs or simple gold/silver studs. Single watch."
  },
  qatar: {
    lips: "Deep red or burgundy tones. Lip liner is highly recommended.",
    hair: "Sleek low bun placed exactly at the nape of the neck. Hair gel required for clean look.",
    nails: "Nude, neutral pink, or clear gloss only. No red nails allowed.",
    skin: "Flawless, fully coverage foundation with rose-colored blush.",
    jewelry: "Pearl earrings (max 6mm diameter). No rings other than wedding bands."
  },
  etihad: {
    lips: "Warm red or warm coral lip tones matching uniform styling guidelines.",
    hair: "Sleek low ponytail or side-parted low bun. Natural hair colors only.",
    nails: "Neutral tones, French manicure, or soft plum tones.",
    skin: "Dewy, natural skin finish with subtle highlighting.",
    jewelry: "Simple gold, silver or pearl studs. Neutral leather strap watch."
  },
  generic: {
    lips: "Professional neutral pink, plum, or classic red shades.",
    hair: "Neat bun, ponytail, or short styled cut off the collar.",
    nails: "Clean, trimmed nails with clear or neutral polish.",
    skin: "Even, professional coverage with natural tones.",
    jewelry: "Minimalist studs. Classic analog wristwatch."
  }
};

// ============================================================================
// Component Definition
// ============================================================================

export function AviationAcademy() {
  // Sector Customizer States
  const [selectedSector, setSelectedSector] = useState(SECTORS[2].id);
  const [selectedFleet, setSelectedFleet] = useState(FLEETS[1].id);

  // Sonru Simulator States
  const [selectedSonruQ, setSelectedSonruQ] = useState(SONRU_QUESTIONS[0].id);
  const [prepTime, setPrepTime] = useState(30);
  const [recordTime, setRecordTime] = useState(120);
  const [timerActive, setTimerActive] = useState(false);
  const [timerMode, setTimerMode] = useState<"prep" | "record" | "idle">("idle");
  const [responseScript, setResponseScript] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<{ score: number; review: string; detectedKeywords: string[]; recommendations: string[] } | null>(null);

  // Audio/Speech States
  const [isSimulatingAudio, setIsSimulatingAudio] = useState(false);
  const [fillerCount, setFillerCount] = useState(0);
  const [wpmSpeed, setWpmSpeed] = useState(0);

  // Stress Mode States
  const [stressModeActive, setStressModeActive] = useState(false);
  const [stressFollowUp, setStressFollowUp] = useState<string | null>(null);
  const [stressResponse, setStressResponse] = useState("");
  const [answeringStress, setAnsweringStress] = useState(false);
  const [stressVerdict, setStressVerdict] = useState<string | null>(null);

  // STAR Builder States
  const [starStep, setStarStep] = useState<"idle" | "situation" | "task" | "action" | "result" | "review">("idle");
  const [starSituation, setStarSituation] = useState("");
  const [starTask, setStarTask] = useState("");
  const [starAction, setStarAction] = useState("");
  const [starResultText, setStarResultText] = useState("");
  const [starAnalysis, setStarAnalysis] = useState<{ score: number; feedback: string; finalOutput: string } | null>(null);
  const [analyzingStar, setAnalyzingStar] = useState(false);

  // Group Task States
  const [selectedScenario, setSelectedScenario] = useState(GROUP_SCENARIOS[0].id);
  const [userContribution, setUserContribution] = useState("");
  const [groupLogs, setGroupLogs] = useState<{ sender: string; role: string; message: string }[]>([]);
  const [crmScore, setCrmScore] = useState<number | null>(null);
  const [crmFeedback, setCrmFeedback] = useState<string>("");
  const [submittingCrm, setSubmittingCrm] = useState(false);

  // Grooming States
  const [selectedAirlineGrooming, setSelectedAirlineGrooming] = useState("emirates");
  const [checkedGrooming, setCheckedGrooming] = useState<Record<string, boolean>>({});

  // Reset Sonru Timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timerActive) {
      interval = setInterval(() => {
        if (timerMode === "prep") {
          setPrepTime((p) => {
            if (p <= 1) {
              setTimerMode("record");
              return 120;
            }
            return p - 1;
          });
        } else if (timerMode === "record") {
          setRecordTime((r) => {
            if (r <= 1) {
              setTimerActive(false);
              setTimerMode("idle");
              toast.success("Recording completed! Click 'Evaluate Response' to check keywords.");
              return 0;
            }
            return r - 1;
          });
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerActive, timerMode]);

  const startSonruPractice = () => {
    setPrepTime(30);
    setRecordTime(120);
    setTimerMode("prep");
    setTimerActive(true);
    setEvalResult(null);
    setStressFollowUp(null);
    setStressVerdict(null);
    setIsSimulatingAudio(false);
    setWpmSpeed(0);
    setFillerCount(0);
  };

  const stopSonruPractice = () => {
    setTimerActive(false);
    setTimerMode("idle");
  };

  const evaluateSonruScript = async () => {
    if (!responseScript.trim()) {
      toast.error("Please enter a response script to evaluate.");
      return;
    }
    setEvaluating(true);
    try {
      const qText = SONRU_QUESTIONS.find((q) => q.id === selectedSonruQ)?.text || "";
      const result = await recordAI({
        systemPrompt: `You are an Expert Airline Interview Coach. Evaluate the candidate's script response to a Sonru asynchronous video interview question. Score out of 100 based on CRM awareness, Passenger Safety (SEP), Service Recovery, and professional vocabulary. If stress mode is active, include a critical, demanding stress follow-up question. Return ONLY JSON: {"score": 85, "review": "...", "detectedKeywords": ["...", "..."], "recommendations": ["...", "..."] ${stressModeActive ? ', "stressFollowUp": "..."' : ""}}`,
        userPrompt: `QUESTION: ${qText}
RESPONSE SCRIPT: ${responseScript}
TARGET SECTOR: ${selectedSector}
AIRCRAFT FLEET: ${selectedFleet}
STRESS MODE IS: ${stressModeActive ? "ACTIVE" : "INACTIVE"}
Return only JSON.`,
        temperature: 0.3
      });

      let data;
      try {
        data = JSON.parse(result.text);
      } catch {
        const clean = result.text.match(/\{[\s\S]*\}/)?.[0] || "{}";
        data = JSON.parse(clean);
      }

      setEvalResult({
        score: data.score ?? 70,
        review: data.review ?? "Nice attempt.",
        detectedKeywords: data.detectedKeywords ?? [],
        recommendations: data.recommendations ?? []
      });

      if (stressModeActive && data.stressFollowUp) {
        setStressFollowUp(data.stressFollowUp);
        toast.info("🚨 Panel Stress Mode follow-up generated!");
      }

      toast.success("Evaluation complete!");
    } catch (e) {
      toast.error("Evaluation failed.");
    } finally {
      setEvaluating(false);
    }
  };

  // Simulated Voice Input Analyzer
  const startVoiceSimulation = () => {
    if (!responseScript.trim()) {
      toast.error("Please draft a response script to simulate voice recording.");
      return;
    }
    setIsSimulatingAudio(true);
    toast.info("🎙️ Simulating speech-to-text recording... speak now.");

    setTimeout(() => {
      // Analyze fillers count
      const text = responseScript.toLowerCase();
      const fillers = ["um", "ah", "like", "so", "basically", "you know"];
      let count = 0;
      fillers.forEach((f) => {
        const matches = text.match(new RegExp(`\\b${f}\\b`, "g"));
        if (matches) count += matches.length;
      });
      setFillerCount(count);

      // Compute words per minute (typical target: 130-150 WPM)
      const words = responseScript.split(/\s+/).length;
      setWpmSpeed(Math.round(words / 1.5)); // simulated duration of 1.5 minutes
      setIsSimulatingAudio(false);
      toast.success("Voice analysis complete! See details below.");
    }, 3000);
  };

  // Submit Stress Response
  const submitStressResponse = async () => {
    if (!stressResponse.trim()) {
      toast.error("Please type your response to the follow-up.");
      return;
    }
    setAnsweringStress(true);
    try {
      const result = await recordAI({
        systemPrompt: `You are a demanding airline recruitment panel interviewer. Evaluate the candidate's defensive response to your tough follow-up. Grade out of 100 based on safety compliance, operational maturity, and composure. Return ONLY JSON: {"verdict": "..."}`,
        userPrompt: `TIGHT FOLLOW-UP: ${stressFollowUp}
CANDIDATE'S DEFENSIVE RESPONSE: ${stressResponse}
Return only JSON.`,
        temperature: 0.4
      });

      let data;
      try {
        data = JSON.parse(result.text);
      } catch {
        const clean = result.text.match(/\{[\s\S]*\}/)?.[0] || "{}";
        data = JSON.parse(clean);
      }
      setStressVerdict(data.verdict || "Composed response.");
      toast.success("Stress response graded!");
    } catch (e) {
      toast.error("Grading failed.");
    } finally {
      setAnsweringStress(false);
    }
  };

  // STAR Builder Analyzer
  const analyzeStarStory = async () => {
    if (!starSituation || !starTask || !starAction || !starResultText) {
      toast.error("Please fill in all STAR phases to analyze.");
      return;
    }
    setAnalyzingStar(true);
    try {
      const result = await recordAI({
        systemPrompt: `You are an Expert Interview Coach. Analyze the step-by-step STAR method entries. Assemble them into one cohesive, high-quality interview answer. Score out of 100. Return ONLY JSON: {"score": 88, "feedback": "...", "finalOutput": "..."}`,
        userPrompt: `SITUATION: ${starSituation}
TASK: ${starTask}
ACTION: ${starAction}
RESULT: ${starResultText}
Return only JSON.`,
        temperature: 0.3
      });

      let data;
      try {
        data = JSON.parse(result.text);
      } catch {
        const clean = result.text.match(/\{[\s\S]*\}/)?.[0] || "{}";
        data = JSON.parse(clean);
      }

      setStarAnalysis({
        score: data.score ?? 75,
        feedback: data.feedback ?? "Solid STAR structure.",
        finalOutput: data.finalOutput ?? `${starSituation} ${starTask} ${starAction} ${starResultText}`
      });
      setStarStep("review");
      toast.success("STAR analysis complete!");
    } catch (e) {
      toast.error("Failed to analyze STAR story.");
    } finally {
      setAnalyzingStar(false);
    }
  };

  // Group Task logic
  const activeScenario = GROUP_SCENARIOS.find((s) => s.id === selectedScenario) || GROUP_SCENARIOS[0];

  useEffect(() => {
    setGroupLogs(activeScenario.members.map((m) => ({ sender: m.name, role: m.role, message: m.input })));
    setCrmScore(null);
    setCrmFeedback("");
    setUserContribution("");
  }, [selectedScenario]);

  const submitContribution = async () => {
    if (!userContribution.trim()) {
      toast.error("Please type your response before submitting.");
      return;
    }
    setSubmittingCrm(true);
    try {
      const chatHistory = groupLogs.map((l) => `${l.sender} (${l.role}): ${l.message}`).join("\n");
      const result = await recordAI({
        systemPrompt: `You are an Airline Recruiter sitting in an Assessment Centre. Grade the candidate's contribution to the group discussion scenario. Score out of 100 based on diplomacy, active listening references, safety compliance, and team consensus facilitation. Return ONLY JSON: {"score": 82, "feedback": "...", "replyFromPurser": "..."}`,
        userPrompt: `SCENARIO: ${activeScenario.scenario}
GROUP CHAT LOGS:
${chatHistory}
CANDIDATE'S CONTRIBUTION: ${userContribution}
Return only JSON.`,
        temperature: 0.4
      });

      let data;
      try {
        data = JSON.parse(result.text);
      } catch {
        const clean = result.text.match(/\{[\s\S]*\}/)?.[0] || "{}";
        data = JSON.parse(clean);
      }

      setCrmScore(data.score ?? 75);
      setCrmFeedback(data.feedback ?? "Good collaboration.");

      setGroupLogs((prev) => [
        ...prev,
        { sender: "You (Candidate)", role: "Team Player", message: userContribution },
        { sender: "Sarah (Purser)", role: "Facilitator", message: data.replyFromPurser || "Excellent point, team. Let's write that down as our final decision." }
      ]);
      setUserContribution("");
      toast.success("CRM Contribution evaluated!");
    } catch (e) {
      toast.error("Failed to submit CRM entry.");
    } finally {
      setSubmittingCrm(false);
    }
  };

  // Grooming handler
  const currentGrooming = GROOMING_STANDARDS[selectedAirlineGrooming] || GROOMING_STANDARDS.generic;

  const toggleGroomingCheck = (key: string) => {
    const checkId = `${selectedAirlineGrooming}-${key}`;
    setCheckedGrooming((prev) => ({ ...prev, [checkId]: !prev[checkId] }));
  };

  const groomingCompletion = Object.keys(currentGrooming).filter((k) => checkedGrooming[`${selectedAirlineGrooming}-${k}`]).length;
  const groomingPct = Math.round((groomingCompletion / 5) * 100);

  return (
    <div className="space-y-6">
      {/* ====================================================================
          1. FLIGHT ROUTE & SECTOR CUSTOMIZATION
          ==================================================================== */}
      <Card className="overflow-hidden border-brand/20">
        <CardHeader className="bg-brand/5 border-b border-brand/10">
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Compass" className="w-5 h-5 text-brand" /> 1. Sector & Fleet Customizer
          </CardTitle>
          <CardDescription>Configure your target aircraft fleet and route network to dynamically align resume phrasing.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 grid sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Target Sector Network</label>
              <select
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                className="w-full h-9 mt-1 px-2 rounded-md border border-input bg-background text-sm"
              >
                {SECTORS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Route focus:</strong> {SECTORS.find((s) => s.id === selectedSector)?.focus}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Aircraft Fleet Focus</label>
              <select
                value={selectedFleet}
                onChange={(e) => setSelectedFleet(e.target.value)}
                className="w-full h-9 mt-1 px-2 rounded-md border border-input bg-background text-sm"
              >
                {FLEETS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Galley focus:</strong> {FLEETS.find((f) => f.id === selectedFleet)?.keyFeature}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ====================================================================
            2. SONRU VIDEO INTERVIEW SIMULATOR (WITH VOICE RECON & STRESS MODE)
            ==================================================================== */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon name="Video" className="w-5 h-5 text-red-500" /> 2. Sonru Video & Voice Screen Simulator
            </CardTitle>
            <CardDescription>Rehearse asynchronous video prompts with active speech coaching and stress mode options.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">SELECT AIRLINE PROMPT</label>
                <select
                  value={selectedSonruQ}
                  onChange={(e) => setSelectedSonruQ(e.target.value)}
                  className="w-full h-9 mt-1 px-2 rounded-md border border-input bg-background text-sm"
                >
                  {SONRU_QUESTIONS.map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 mt-4 sm:mt-6 bg-secondary/30 border border-border p-2 rounded-lg">
                <input
                  type="checkbox"
                  id="stress-toggle"
                  checked={stressModeActive}
                  onChange={(e) => setStressModeActive(e.target.checked)}
                  className="rounded border-input text-brand focus:ring-brand w-4 h-4"
                />
                <label htmlFor="stress-toggle" className="text-xs font-semibold text-amber-600 select-none cursor-pointer flex items-center gap-1">
                  <Icon name="AlertCircle" className="w-3.5 h-3.5" /> Recruiter Stress Mode
                </label>
              </div>
            </div>

            {/* Video Feed Box */}
            <div className="relative rounded-lg aspect-video bg-neutral-900 overflow-hidden border border-neutral-800 flex flex-col items-center justify-center text-white">
              {timerMode === "idle" && (
                <div className="text-center p-4">
                  <Icon name="CameraOff" className="w-10 h-10 text-neutral-600 mx-auto mb-2" />
                  <p className="text-xs text-neutral-400">Camera is off. Click below to begin the assessment flow.</p>
                </div>
              )}

              {timerMode === "prep" && (
                <div className="text-center p-4 animate-pulse">
                  <Icon name="Hourglass" className="w-10 h-10 text-amber-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold">PREPARATION COUNTDOWN</p>
                  <p className="text-3xl font-mono mt-1 text-amber-500">{prepTime}s</p>
                </div>
              )}

              {timerMode === "record" && (
                <div className="text-center p-4">
                  <div className="absolute top-3 right-3 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-red-500 font-mono">RECORDING</span>
                  </div>
                  <Icon name="Video" className="w-12 h-12 text-red-500 mx-auto mb-2" />
                  <p className="text-sm">Speak clearly into your microphone...</p>
                  <p className="text-3xl font-mono mt-1 text-red-500">{recordTime}s</p>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {timerMode === "idle" ? (
                <Button onClick={startSonruPractice} className="bg-red-600 hover:bg-red-700 text-white flex-1 gap-2">
                  <Icon name="Play" className="w-4 h-4" /> Start Sonru Flow
                </Button>
              ) : (
                <Button onClick={stopSonruPractice} variant="outline" className="border-neutral-300 text-neutral-700 flex-1 gap-2">
                  <Icon name="Square" className="w-4 h-4" /> Cancel Assessment
                </Button>
              )}
            </div>

            {/* Script Text Area */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-muted-foreground">PASTE OR WRITE RESPONSE SCRIPT FOR EVALUATION</label>
                <button
                  onClick={startVoiceSimulation}
                  disabled={isSimulatingAudio || !responseScript}
                  className="text-xs text-brand hover:text-brand-dark flex items-center gap-1 font-semibold"
                >
                  <Icon name={isSimulatingAudio ? "Loader2" : "Mic"} className={`w-3.5 h-3.5 ${isSimulatingAudio ? "animate-spin" : ""}`} />
                  {isSimulatingAudio ? "Recording..." : "Analyze Spoken Speed"}
                </button>
              </div>
              <textarea
                value={responseScript}
                onChange={(e) => setResponseScript(e.target.value)}
                placeholder="Write your planned spoken response here. Focus on STAR method structure..."
                className="w-full h-24 p-2 rounded-md border border-input bg-background text-sm font-mono text-xs focus:ring-1 focus:ring-brand focus:outline-none"
              />
            </div>

            {wpmSpeed > 0 && (
              <div className="grid grid-cols-2 gap-3 text-xs bg-secondary/50 p-2.5 rounded-lg border border-border">
                <div className="flex items-center gap-1.5">
                  <Icon name="Activity" className="text-brand w-4 h-4" />
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">Speech Pace</span>
                    <strong className="text-foreground">{wpmSpeed} WPM</strong> (Target: ~140)
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Icon name="Smile" className="text-amber-500 w-4 h-4" />
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">Filler Words</span>
                    <strong className="text-amber-600">{fillerCount} detected</strong>
                  </div>
                </div>
              </div>
            )}

            <Button onClick={evaluateSonruScript} disabled={evaluating || !responseScript} className="w-full bg-brand hover:bg-brand-dark text-white">
              {evaluating ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
              {evaluating ? "Analyzing Script..." : "Evaluate Response"}
            </Button>

            {evalResult && (
              <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand uppercase">Simulator Report</span>
                  <Badge variant="success">Score: {evalResult.score}/100</Badge>
                </div>
                <p className="text-xs">{evalResult.review}</p>
                {evalResult.detectedKeywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    <span className="font-semibold text-muted-foreground mr-1">Weaved:</span>
                    {evalResult.detectedKeywords.map((k) => <Badge key={k} variant="default">{k}</Badge>)}
                  </div>
                )}
                {evalResult.recommendations.length > 0 && (
                  <div className="text-[10px] space-y-1 mt-1 border-t border-border pt-1">
                    <p className="font-semibold text-muted-foreground">Recommendations:</p>
                    {evalResult.recommendations.map((r, idx) => <p key={idx} className="text-muted-foreground">· {r}</p>)}
                  </div>
                )}
              </div>
            )}

            {/* Stress Follow-up widget */}
            {stressFollowUp && (
              <div className="rounded-lg border border-amber-400 bg-amber-50/20 dark:bg-amber-950/10 p-3 space-y-2 text-xs">
                <div className="flex items-center gap-1.5 text-amber-600 font-bold uppercase text-[10px]">
                  <Icon name="ShieldAlert" className="w-4 h-4" /> Recruiter Stress Follow-Up
                </div>
                <p className="italic text-neutral-800 leading-normal bg-background p-2 rounded border border-amber-200">{stressFollowUp}</p>
                
                <textarea
                  value={stressResponse}
                  onChange={(e) => setStressResponse(e.target.value)}
                  placeholder="Draft your composed safety-first response here..."
                  className="w-full h-16 p-2 rounded-md border border-input bg-background text-xs focus:ring-1 focus:ring-brand focus:outline-none"
                />
                
                <Button onClick={submitStressResponse} disabled={answeringStress || !stressResponse} size="sm" className="w-full bg-amber-600 hover:bg-amber-700 text-white">
                  {answeringStress ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : "Submit Composed Answer"}
                </Button>

                {stressVerdict && (
                  <div className="bg-background border border-border p-2.5 rounded-md mt-2 text-[11px] text-neutral-700">
                    <strong className="text-brand text-[10px] uppercase block mb-0.5">Stress Recovery Verdict</strong>
                    {stressVerdict}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ====================================================================
            3. ASSESSMENT DAY GROUP TASK SIMULATOR
            ==================================================================== */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon name="Users" className="w-5 h-5 text-brand" /> 3. Assessment Day Group Exercise Simulator
            </CardTitle>
            <CardDescription>Collaborate with flight Purser and crew candidates to reach team consensus.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground">SELECT EXERCISE SCENARIO</label>
              <select
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value)}
                className="w-full h-9 mt-1 px-2 rounded-md border border-input bg-background text-sm"
              >
                {GROUP_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>

            <div className="rounded-lg bg-secondary/30 border border-border p-3">
              <span className="text-[10px] uppercase font-bold text-brand block mb-1">Scenario Parameters</span>
              <p className="text-xs text-neutral-700 leading-relaxed">{activeScenario.scenario}</p>
            </div>

            {/* Chat Log Window */}
            <div className="rounded-lg border border-border bg-background p-3 h-48 overflow-y-auto space-y-2">
              {groupLogs.map((l, idx) => (
                <div key={idx} className={`p-2 rounded-md text-xs ${l.sender.includes("You") ? "bg-brand/10 border-l-2 border-brand ml-4" : "bg-secondary/40 border border-border mr-4"}`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-[10px] uppercase">{l.sender}</span>
                    <span className="text-[9px] text-muted-foreground tracking-wide italic">{l.role}</span>
                  </div>
                  <p className="text-neutral-700 leading-normal">{l.message}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <textarea
                value={userContribution}
                onChange={(e) => setUserContribution(e.target.value)}
                placeholder="Write your contribution. Tip: practice active listening, cite others, support team building..."
                className="w-full h-16 p-2 rounded-md border border-input bg-background text-sm text-xs focus:ring-1 focus:ring-brand focus:outline-none"
              />
              <Button onClick={submitContribution} disabled={submittingCrm || !userContribution} className="w-full bg-brand hover:bg-brand-dark text-white gap-2">
                {submittingCrm ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Send" className="w-4 h-4" />}
                {submittingCrm ? "Submitting CRM..." : "Speak / Share to Group"}
              </Button>
            </div>

            {crmScore !== null && (
              <div className="rounded-lg border border-brand/20 bg-brand/5 p-3 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-brand uppercase text-[10px]">Recruiter Assessment Verdict</span>
                  <Badge variant={crmScore >= 80 ? "success" : "warning"}>CRM Score: {crmScore}/100</Badge>
                </div>
                <p className="text-neutral-700 leading-relaxed">{crmFeedback}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ====================================================================
          4. INTERACTIVE GROOMING & APPEARANCE AUDITOR
          ==================================================================== */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Smile" className="w-5 h-5 text-amber-500" /> 4. Grooming & Brand Compliance Checklist
          </CardTitle>
          <CardDescription>Ensure your appearance aligns with the strict requirements of your target airline.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-muted-foreground">SELECT TARGET AIRLINE FOR COMPLIANCE</label>
              <select
                value={selectedAirlineGrooming}
                onChange={(e) => setSelectedAirlineGrooming(e.target.value)}
                className="w-full h-9 mt-1 px-2 rounded-md border border-input bg-background text-sm"
              >
                <option value="emirates">Emirates</option>
                <option value="qatar">Qatar Airways</option>
                <option value="etihad">Etihad Airways</option>
                <option value="generic">Generic Standards</option>
              </select>
            </div>
            {/* Progress Meter */}
            <div className="rounded-lg bg-secondary/40 px-4 py-2 border border-border flex flex-col items-center justify-center">
              <span className="text-[10px] text-muted-foreground uppercase font-bold">Brand Ready</span>
              <span className="text-lg font-bold text-brand font-mono">{groomingPct}%</span>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {Object.entries(currentGrooming).map(([key, standardText]) => {
              const checkId = `${selectedAirlineGrooming}-${key}`;
              const checked = !!checkedGrooming[checkId];
              return (
                <div
                  key={key}
                  onClick={() => toggleGroomingCheck(key)}
                  className={`rounded-lg border p-3 flex flex-col justify-between cursor-pointer transition-all duration-200 ${
                    checked
                      ? "border-brand/40 bg-brand/5 shadow-sm"
                      : "border-border bg-background hover:bg-secondary/20"
                  }`}
                >
                  <div>
                    <span className="text-[10px] uppercase font-bold text-brand block mb-1">{key}</span>
                    <p className="text-xs text-neutral-700 leading-normal">{standardText}</p>
                  </div>
                  <div className="flex items-center justify-end mt-2">
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${checked ? "bg-brand border-brand text-white" : "border-neutral-300 text-transparent"}`}>
                      <Icon name="Check" className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ====================================================================
          5. INTERACTIVE STAR METHOD ANSWER BUILDER
          ==================================================================== */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="MessagesSquare" className="w-5 h-5 text-brand" /> 5. STAR Method Behavior Answer Builder
          </CardTitle>
          <CardDescription>Structure your personal career stories step-by-step to construct a robust behavioral response.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {starStep === "idle" && (
            <div className="py-8 text-center space-y-3 bg-secondary/10 border border-dashed rounded-lg">
              <Icon name="FileEdit" className="w-10 h-10 text-muted-foreground/60 mx-auto" />
              <div className="text-sm font-semibold">Start building your STAR story</div>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">Structure your answers step-by-step to be safety-recurrent and operationally aligned.</p>
              <Button onClick={() => setStarStep("situation")} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
                Build STAR Story
              </Button>
            </div>
          )}

          {starStep !== "idle" && starStep !== "review" && (
            <div className="space-y-4">
              {/* STAR step indicators */}
              <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-bold text-muted-foreground">
                <span className={`p-1.5 rounded border ${starStep === "situation" ? "bg-brand/10 border-brand text-brand" : "bg-background border-border"}`}>S (Situation)</span>
                <span className={`p-1.5 rounded border ${starStep === "task" ? "bg-brand/10 border-brand text-brand" : "bg-background border-border"}`}>T (Task)</span>
                <span className={`p-1.5 rounded border ${starStep === "action" ? "bg-brand/10 border-brand text-brand" : "bg-background border-border"}`}>A (Action)</span>
                <span className={`p-1.5 rounded border ${starStep === "result" ? "bg-brand/10 border-brand text-brand" : "bg-background border-border"}`}>R (Result)</span>
              </div>

              {starStep === "situation" && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground block">Describe the Situation (S): Where and when did this event take place?</label>
                  <textarea
                    value={starSituation}
                    onChange={(e) => setStarSituation(e.target.value)}
                    placeholder="Example: During flight EK007, we encountered severe, unforecasted turbulence..."
                    className="w-full h-20 p-2 border border-input rounded text-xs focus:ring-1 focus:ring-brand focus:outline-none"
                  />
                  <div className="flex justify-end">
                    <Button onClick={() => setStarStep("task")} disabled={!starSituation} className="bg-brand text-white">Next: Task</Button>
                  </div>
                </div>
              )}

              {starStep === "task" && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground block">Describe the Task (T): What was your responsibility or the immediate challenge?</label>
                  <textarea
                    value={starTask}
                    onChange={(e) => setStarTask(e.target.value)}
                    placeholder="Example: As the Cabin Crew member in charge of the aft galley, I had to secure all loose carts..."
                    className="w-full h-20 p-2 border border-input rounded text-xs focus:ring-1 focus:ring-brand focus:outline-none"
                  />
                  <div className="flex justify-between">
                    <Button onClick={() => setStarStep("situation")} variant="outline">Back</Button>
                    <Button onClick={() => setStarStep("action")} disabled={!starTask} className="bg-brand text-white">Next: Action</Button>
                  </div>
                </div>
              )}

              {starStep === "action" && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground block">Describe the Action (A): What specific steps did you execute? Cite safety regulations / CRM.</label>
                  <textarea
                    value={starAction}
                    onChange={(e) => setStarAction(e.target.value)}
                    placeholder="Example: I immediately locked the cart breaks, secured the cabin using standard SEP protocols, and coordinated with the Purser..."
                    className="w-full h-20 p-2 border border-input rounded text-xs focus:ring-1 focus:ring-brand focus:outline-none"
                  />
                  <div className="flex justify-between">
                    <Button onClick={() => setStarStep("task")} variant="outline">Back</Button>
                    <Button onClick={() => setStarStep("result")} disabled={!starAction} className="bg-brand text-white">Next: Result</Button>
                  </div>
                </div>
              )}

              {starStep === "result" && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground block">Describe the Result (R): What was the final outcome? Quantify if possible.</label>
                  <textarea
                    value={starResultText}
                    onChange={(e) => setStarResultText(e.target.value)}
                    placeholder="Example: All loose service gear was locked within 45 seconds. Cabin safety was maintained with zero crew or guest injuries."
                    className="w-full h-20 p-2 border border-input rounded text-xs focus:ring-1 focus:ring-brand focus:outline-none"
                  />
                  <div className="flex justify-between">
                    <Button onClick={() => setStarStep("action")} variant="outline">Back</Button>
                    <Button onClick={analyzeStarStory} disabled={analyzingStar || !starResultText} className="bg-brand text-white gap-1.5">
                      {analyzingStar && <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" />}
                      {analyzingStar ? "Assembling Answer..." : "Finish STAR Story"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {starStep === "review" && starAnalysis && (
            <div className="rounded-lg border border-brand/20 bg-brand/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-brand uppercase">Assembled STAR Answer</span>
                <Badge variant="success">STAR Score: {starAnalysis.score}/100</Badge>
              </div>
              <p className="text-xs text-neutral-800 leading-relaxed bg-background p-3 rounded border border-border">{starAnalysis.finalOutput}</p>
              
              <div className="text-xs space-y-1">
                <strong className="text-muted-foreground text-[10px] uppercase">Recruiter Feedback</strong>
                <p className="text-muted-foreground leading-relaxed">{starAnalysis.feedback}</p>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  onClick={() => {
                    setResponseScript(starAnalysis.finalOutput);
                    toast.success("STAR story copied into your Sonru script area!");
                  }}
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                >
                  <Icon name="Copy" className="w-3.5 h-3.5" /> Use in Sonru Script
                </Button>
                <Button
                  onClick={() => {
                    setStarSituation("");
                    setStarTask("");
                    setStarAction("");
                    setStarResultText("");
                    setStarAnalysis(null);
                    setStarStep("situation");
                  }}
                  size="sm"
                  className="bg-brand text-white"
                >
                  Build New Story
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

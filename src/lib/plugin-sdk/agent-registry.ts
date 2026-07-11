// ============================================================================
// Plugin SDK — Agent Registry
// ============================================================================
// Formal registry for all AI agents in the Unified AI Career OS.
// Provides metadata discovery, dynamic capabilities listing, and lifecycle hook
// bindings.
// ============================================================================

"use client";

export interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  capabilities: string[];
  systemPrompt?: string;
  inputs?: string[];
  outputs?: string[];
}

export class AgentRegistry {
  private static agents = new Map<string, AgentMetadata>();

  /**
   * Register a new agent metadata descriptor.
   */
  static register(metadata: AgentMetadata): void {
    if (this.agents.has(metadata.id)) {
      throw new Error(`AgentRegistry: duplicate agent ID "${metadata.id}"`);
    }
    this.agents.set(metadata.id, metadata);
    console.info(`[AgentRegistry] Registered agent: ${metadata.name} (${metadata.id})`);
  }

  /**
   * Resolve agent metadata by ID.
   */
  static getAgent(id: string): AgentMetadata | undefined {
    return this.agents.get(id);
  }

  /**
   * Check if an agent ID exists.
   */
  static has(id: string): boolean {
    return this.agents.has(id);
  }

  /**
   * List all registered agents.
   */
  static listAgents(): AgentMetadata[] {
    // Populate defaults if empty (lazy initialization)
    if (this.agents.size === 0) {
      this.registerDefaults();
    }
    return Array.from(this.agents.values());
  }

  /**
   * Clear all registered agents.
   */
  static clear(): void {
    this.agents.clear();
  }

  /**
   * Register default agents of the Career OS pipeline.
   */
  private static registerDefaults(): void {
    const defaults: AgentMetadata[] = [
      {
        id: "supervisor",
        name: "Supervisor",
        description: "Orchestrates overall workflow execution, tracking progress and coordinating fallback routines.",
        icon: "Cpu",
        version: "3.0.0",
        capabilities: ["workflow_routing", "dependency_resolution", "persistence_recovery"],
      },
      {
        id: "planner",
        name: "Planner",
        description: "Formulates step-by-step agent execution plans based on user events and current context.",
        icon: "ClipboardList",
        version: "3.0.0",
        capabilities: ["plan_generation", "task_estimation"],
      },
      {
        id: "memory",
        name: "Memory",
        description: "Manages persistent profile memory, resume snapshots, and historical job match intelligence.",
        icon: "Database",
        version: "3.0.0",
        capabilities: ["context_persistence", "profile_ingestion"],
      },
      {
        id: "research",
        name: "Research",
        description: "Fetches and analyzes web resources, scraping job descriptions and career documents.",
        icon: "Search",
        version: "3.0.0",
        capabilities: ["web_scraping", "url_parsing"],
      },
      {
        id: "resume-parser",
        name: "Resume Parser",
        description: "Extracts structured sections from PDF, DOCX, TXT, or scanned resume images.",
        icon: "FileText",
        version: "3.0.0",
        capabilities: ["pdf_extraction", "docx_extraction", "ocr"],
      },
      {
        id: "resume-repair",
        name: "Resume Repair",
        description: "Safeguards original dates, titles, and institutions against data loss or AI hallucination.",
        icon: "Wrench",
        version: "3.0.0",
        capabilities: ["integrity_healing", "metadata_restoration"],
      },
      {
        id: "content-expansion",
        name: "Content Expansion",
        description: "Enriches sparse resume descriptions using verified professional context from user profile.",
        icon: "Expand",
        version: "3.0.0",
        capabilities: ["bullet_elaboration", "impact_metrics_weaving"],
      },
      {
        id: "job-intelligence",
        name: "Job Intelligence",
        description: "Analyzes JD raw text to identify missing keywords, required credentials, and soft skills.",
        icon: "Briefcase",
        version: "3.0.0",
        capabilities: ["keyword_extraction", "role_classification"],
      },
      {
        id: "company-intelligence",
        name: "Company Intelligence",
        description: "Researches specific employers to extract culture fit parameters and business objectives.",
        icon: "Building2",
        version: "3.0.0",
        capabilities: ["employer_research", "culture_alignment"],
      },
      {
        id: "skill-gap",
        name: "Skill Gap",
        description: "Compares current resume skills against target role requirements to highlight key gaps.",
        icon: "GitCompare",
        version: "3.0.0",
        capabilities: ["gap_analysis", "credential_recommendation"],
      },
      {
        id: "ats-analysis",
        name: "ATS Analysis",
        description: "Evaluates resume formatting, spelling, keywords, structure, and readability for ATS matching.",
        icon: "ScanText",
        version: "3.0.0",
        capabilities: ["formatting_audit", "keyword_coverage_check"],
      },
      {
        id: "optimizer",
        name: "Optimizer",
        description: "Tailors experiences, headline, and competencies for maximum alignment with job descriptions.",
        icon: "Wand2",
        version: "3.0.0",
        capabilities: ["experience_rewriting", "headline_customization"],
      },
      {
        id: "qa",
        name: "Quality Assurance",
        description: "Verifies constraints, page limit compliance, and factual accuracy against original source documents.",
        icon: "ShieldCheck",
        version: "3.0.0",
        capabilities: ["page_limit_enforcement", "fact_checking"],
      },
      {
        id: "reflection",
        name: "Reflection",
        description: "Critiques agent modifications, triggering repairs and adjustments to optimize final output.",
        icon: "Brain",
        version: "3.0.0",
        capabilities: ["self_correction", "quality_gating"],
      },
      {
        id: "cover-letter",
        name: "Cover Letter",
        description: "Generates custom cover letters matching user profile background and target job description.",
        icon: "Mail",
        version: "3.0.0",
        capabilities: ["pitch_generation", "tone_balancing"],
      },
      {
        id: "interview",
        name: "Interview Prep",
        description: "Constructs tailored mock interview questions, model answers, and strategic guides.",
        icon: "MessageSquare",
        version: "3.0.0",
        capabilities: ["question_generation", "strategy_building"],
      },
    ];

    for (const d of defaults) {
      this.register(d);
    }
  }
}

// ResumeAI Pro — QA Barrel Exports
// Single entry point for all QA infrastructure.

export * from "./types";
export { testProvider, runProviderTests, validateProviderCoverage } from "./provider-tests";
export { validatePipelineStages, createExpectedPipelineStages, pipelineToQATests, validatePipelineOrder, validatePipelineOutputIntegrity } from "./pipeline-tests";
export { validateExportConsistency, validateExportResult, exportToQATests } from "./export-tests";
export { validateCacheKeyStructure, assertOfflineNotCached, assertFailedNotCached, validateCacheStats, cacheToQATests } from "./cache-tests";
export { scanSourceForSilentFailures, scanMultipleSources, silentFailureToQATests } from "./silent-failure-scanner";
export { recordMetric, createPerformanceReport, isOptimizationSuspiciouslyFast, performanceToQATests, PERFORMANCE_THRESHOLDS } from "./performance-monitor";
export { healProviderFailure, healCacheCorruption, healAllCacheCorruption, healInvalidOptimization, healInvalidExport, healPipelineFailure, healingToQATests, isProviderDisabled, getDisabledProviders, getHealingEvents, clearHealingLog } from "./self-healing";
export { runQualityGates, qualityGatesToQATests } from "./optimization-validators";
export { validateIndustryModes, scanForHardcodedIndustry, validateAutoDetection, atsModeToQATests } from "./ats-tests";
export { runFullQASuite, runQuickQACheck } from "./test-runner";
export { GOLDEN_CORPUS, getGoldenResume, getGoldenResumesByIndustry, getGoldenResumesByTag, getAllGoldenIndustries } from "./golden-corpus";
export { validateSectionParity, validateImmutability, validateContentPreservation, validateAgainstGoldenCorpus, pipelineValidatorToQATests, validateSemanticPreservation } from "./pipeline-validator";
export { calculateQualityScore, evaluateDeployment, QUALITY_THRESHOLD } from "./quality-score";

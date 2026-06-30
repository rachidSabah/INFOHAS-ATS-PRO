// ============================================================================
// Jobs Module — Barrel Exports
// ============================================================================

export { BackgroundJobManager } from './background-job-manager';
export type {
  Job, JobType, JobResult, JobHandler,
  OptimizeJobPayload, ExportJobPayload, MaintenanceJobPayload,
} from './background-job-manager';

export { CpuTimeTracker, processInBatches, parallelMap } from './cpu-time-optimization';
export type { CpuTimeBudget, CpuTimeReport, BatchOperation } from './cpu-time-optimization';

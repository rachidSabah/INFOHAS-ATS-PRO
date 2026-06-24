// ResumeAI Pro — Logger Utility
// Exposes error, warn, info, and log methods for standardized logging.

export const logger = {
  error: (msg: any, ...args: any[]) => {
    console.error(`[ERROR]`, msg, ...args);
  },
  warn: (msg: any, ...args: any[]) => {
    console.warn(`[WARN]`, msg, ...args);
  },
  info: (msg: any, ...args: any[]) => {
    console.info(`[INFO]`, msg, ...args);
  },
  log: (msg: any, ...args: any[]) => {
    console.log(`[LOG]`, msg, ...args);
  },
};

"use client";

import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import type { ReactNode } from "react";

/**
 * SafeRender — legacy wrapper around ErrorBoundary.
 *
 * Kept for backward compatibility. Use ErrorBoundary directly for new code.
 *
 * Usage:
 *   <SafeRender label="Company Intelligence">
 *     <CompanyResearch />
 *   </SafeRender>
 */
interface Props { children: ReactNode; label?: string; }

export function SafeRender({ children, label }: Props) {
  return <ErrorBoundary label={label}>{children}</ErrorBoundary>;
}

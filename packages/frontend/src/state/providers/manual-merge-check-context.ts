import { createContext } from "react";
import { useRequiredContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import type { useManualMergeCheck } from "../operations/use-manual-merge-check";

// The context lives apart from its provider component, so a hot reload of the provider keeps the
// same context object for its consumers.
export const ManualMergeCheckContext = createContext<ReturnType<typeof useManualMergeCheck> | null>(
  null,
);

export const useManualMergeCheckState = (): ReturnType<typeof useManualMergeCheck> =>
  useRequiredContext(ManualMergeCheckContext, "useManualMergeCheckState");

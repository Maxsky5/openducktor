import { useQueryClient } from "@tanstack/react-query";
import { createContext, type PropsWithChildren, type ReactElement } from "react";
import { useRequiredContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useManualMergeCheck } from "../operations/use-manual-merge-check";

/** Keeps the manual merge check running and its pending scope while the palette closes. */
export function ManualMergeCheckProvider({ children }: PropsWithChildren): ReactElement {
  const operation = useManualMergeCheck(useQueryClient());
  return <ManualMergeCheckContext value={operation}>{children}</ManualMergeCheckContext>;
}

export const useManualMergeCheckState = (): ReturnType<typeof useManualMergeCheck> =>
  useRequiredContext(ManualMergeCheckContext, "useManualMergeCheckState");

const ManualMergeCheckContext = createContext<ReturnType<typeof useManualMergeCheck> | null>(null);

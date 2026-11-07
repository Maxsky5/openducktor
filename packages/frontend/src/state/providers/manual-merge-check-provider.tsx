import { useQueryClient } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { useManualMergeCheck } from "../operations/use-manual-merge-check";
import { ManualMergeCheckContext } from "./manual-merge-check-context";

/** Keeps the manual merge check running and its pending scope while the palette closes. */
export function ManualMergeCheckProvider({ children }: PropsWithChildren): ReactElement {
  const operation = useManualMergeCheck(useQueryClient());
  return <ManualMergeCheckContext value={operation}>{children}</ManualMergeCheckContext>;
}

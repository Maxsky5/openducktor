import { createContext, type PropsWithChildren, type ReactElement } from "react";
import { hostClient } from "@/lib/host-client";
import { useRequiredContext } from "../app-state-contexts";
import { useManualPullRequestSync } from "../operations/use-manual-pull-request-sync";

export function ManualPullRequestSyncProvider({ children }: PropsWithChildren): ReactElement {
  const operation = useManualPullRequestSync(hostClient);
  return <ManualPullRequestSyncContext value={operation}>{children}</ManualPullRequestSyncContext>;
}

export const useManualPullRequestSyncState = (): ReturnType<typeof useManualPullRequestSync> =>
  useRequiredContext(ManualPullRequestSyncContext, "useManualPullRequestSyncState");

const ManualPullRequestSyncContext = createContext<ReturnType<
  typeof useManualPullRequestSync
> | null>(null);

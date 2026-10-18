import { createContext, type PropsWithChildren, type ReactElement } from "react";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import { useRequiredContext } from "../app-state-contexts";
import { useManualPullRequestSync } from "../operations/use-manual-pull-request-sync";

export function ManualPullRequestSyncProvider({ children }: PropsWithChildren): ReactElement {
  const operation = useManualPullRequestSync(useHostClient());
  return <ManualPullRequestSyncContext value={operation}>{children}</ManualPullRequestSyncContext>;
}

export const useManualPullRequestSyncState = (): ReturnType<typeof useManualPullRequestSync> =>
  useRequiredContext(ManualPullRequestSyncContext, "useManualPullRequestSyncState");

const ManualPullRequestSyncContext = createContext<ReturnType<
  typeof useManualPullRequestSync
> | null>(null);

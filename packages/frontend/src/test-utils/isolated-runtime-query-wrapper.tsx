import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";
import { HostRuntimeStatusContext } from "@/state/app-state-contexts";
import { createHostRuntimeStatusContextValue } from "./shared-test-fixtures";

const readyRuntimeStatus = createHostRuntimeStatusContextValue();

/** An isolated query client with every runtime kind ready, for hooks that read runtime catalogs. */
export function IsolatedRuntimeQueryWrapper({ children }: PropsWithChildren): ReactElement {
  return (
    <QueryProvider useIsolatedClient>
      <HostRuntimeStatusContext value={readyRuntimeStatus}>{children}</HostRuntimeStatusContext>
    </QueryProvider>
  );
}

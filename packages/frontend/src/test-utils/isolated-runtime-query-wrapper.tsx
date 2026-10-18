import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { HostRuntimeStatusContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { createHostRuntimeStatusContextValue } from "@/test-utils/shared-test-fixtures";

const readyRuntimeStatus = createHostRuntimeStatusContextValue();

/** An isolated query client with every runtime kind ready, for hooks that read runtime catalogs. */
export function IsolatedRuntimeQueryWrapper({ children }: PropsWithChildren): ReactElement {
  return (
    <QueryProvider>
      <HostRuntimeStatusContext value={readyRuntimeStatus}>{children}</HostRuntimeStatusContext>
    </QueryProvider>
  );
}

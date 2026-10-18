import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "@openducktor/frontend-core/test-support/test-client-connection";
import type { HostClient } from "@openducktor/host-client";
import { type PropsWithChildren, useState } from "react";

const reactActEnvironment: typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
} = globalThis;
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Renders under a test connection whose host client is `host` itself, not a copy. A test can
 * replace a command of `host` after it renders.
 */
export function WorkspaceHostProvider({ host, children }: PropsWithChildren<{ host: HostClient }>) {
  const [connection] = useState(() =>
    createTestClientConnection({ host: { ...createTestHostConnection(), client: host } }),
  );
  return <ClientConnectionProvider connection={connection}>{children}</ClientConnectionProvider>;
}

import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { type PropsWithChildren, type ReactElement, useState } from "react";

/**
 * Gives a test tree a client connection with an isolated query cache. Pass `connection` to supply
 * host fakes, for example from `createTestClientConnection({ client: { ... } })`.
 */
export function QueryProvider({
  children,
  connection,
}: PropsWithChildren<{
  connection?: ClientConnection;
}>): ReactElement {
  const [mounted] = useState(() => connection ?? createTestClientConnection());
  return <ClientConnectionProvider connection={mounted}>{children}</ClientConnectionProvider>;
}

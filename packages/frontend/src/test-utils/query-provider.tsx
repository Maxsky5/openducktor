import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { type PropsWithChildren, type ReactElement, useState } from "react";
import { sonnerFeedback } from "@/lib/sonner-feedback";

/**
 * Gives a test tree a client connection with an isolated query cache. Pass `connection` to supply
 * host fakes, for example from `createTestClientConnection({ client: { ... } })`. The default
 * connection shows feedback with sonner, as the desktop app does.
 */
export function QueryProvider({
  children,
  connection,
}: PropsWithChildren<{
  connection?: ClientConnection;
}>): ReactElement {
  const [mounted] = useState(
    () => connection ?? createTestClientConnection({ feedback: sonnerFeedback }),
  );
  return <ClientConnectionProvider connection={mounted}>{children}</ClientConnectionProvider>;
}

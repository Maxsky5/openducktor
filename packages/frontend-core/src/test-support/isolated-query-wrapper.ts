import { createElement, type PropsWithChildren, type ReactElement, useState } from "react";
import { ClientConnectionProvider } from "../connection/client-connection-react";
import { createTestClientConnection } from "./test-client-connection";

export function IsolatedQueryWrapper({ children }: PropsWithChildren): ReactElement {
  const [connection] = useState(() => createTestClientConnection());
  return createElement(ClientConnectionProvider, { connection }, children);
}

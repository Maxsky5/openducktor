import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, createElement, type ReactElement, type ReactNode, use } from "react";
import type { HostClient } from "@openducktor/host-client";
import type { ClientConnection } from "./client-connection";
import type { HostConnection } from "./host-connection";

const ClientConnectionContext = createContext<ClientConnection | null>(null);

/** Gives the tree one host connection and the query client of that connection. */
export function ClientConnectionProvider({
  connection,
  children,
}: {
  connection: ClientConnection;
  children?: ReactNode;
}): ReactElement {
  return createElement(
    ClientConnectionContext.Provider,
    { value: connection },
    createElement(QueryClientProvider, { client: connection.queryClient }, children),
  );
}

export const useClientConnection = (): ClientConnection => {
  const connection = use(ClientConnectionContext);
  if (!connection) {
    throw new Error("useClientConnection must be used inside ClientConnectionProvider.");
  }
  return connection;
};

export const useHostConnection = (): HostConnection => useClientConnection().host;

export const useHostClient = (): HostClient => useClientConnection().host.client;

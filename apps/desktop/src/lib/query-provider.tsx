import { QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren, type ReactElement, useState } from "react";
import { appQueryClient, createQueryClient } from "./query-client";

type QueryProviderProps = PropsWithChildren<{
  useIsolatedClient?: boolean;
}>;

export function QueryProvider({
  children,
  useIsolatedClient = false,
}: QueryProviderProps): ReactElement {
  const [queryClient] = useState(() => (useIsolatedClient ? createQueryClient() : appQueryClient));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

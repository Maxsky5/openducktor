import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "@/lib/query-provider";

export function IsolatedQueryWrapper({ children }: PropsWithChildren): ReactElement {
  return <QueryProvider useIsolatedClient>{children}</QueryProvider>;
}

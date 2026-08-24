import type { PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";

const reactActEnvironment: typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
} = globalThis;
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

export const IsolatedQueryWrapper = ({ children }: PropsWithChildren) => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

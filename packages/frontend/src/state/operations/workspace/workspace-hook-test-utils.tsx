import type { PropsWithChildren } from "react";
import { QueryProvider } from "@/lib/query-provider";

// SAFETY: This test controls the fixture and supplies `typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; }` used by this case.
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

export const IsolatedQueryWrapper = ({ children }: PropsWithChildren) => (
  <QueryProvider useIsolatedClient>{children}</QueryProvider>
);

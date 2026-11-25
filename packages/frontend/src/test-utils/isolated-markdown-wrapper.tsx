import type { PropsWithChildren, ReactElement } from "react";
import { QueryProvider } from "./query-provider";

/** Gives a Markdown view the providers that the app gives it, with an isolated query cache. */
export function IsolatedMarkdownWrapper({ children }: PropsWithChildren): ReactElement {
  return <QueryProvider>{children}</QueryProvider>;
}

import type { PropsWithChildren, ReactElement } from "react";
import { MermaidSvgCacheProvider } from "@/components/ui/markdown-mermaid-svg-cache";
import { QueryProvider } from "./query-provider";

/** Gives a Markdown view the providers that the app gives it, with an isolated query cache. */
export function IsolatedMarkdownWrapper({ children }: PropsWithChildren): ReactElement {
  return (
    <QueryProvider>
      <MermaidSvgCacheProvider>{children}</MermaidSvgCacheProvider>
    </QueryProvider>
  );
}

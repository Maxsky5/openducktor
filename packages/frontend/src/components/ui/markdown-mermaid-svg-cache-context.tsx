import { createContext, type ReactNode, useContext, useState } from "react";
import type { MermaidSvgCache } from "./markdown-mermaid-svg-cache";

const MermaidSvgCacheContext = createContext<MermaidSvgCache | null>(null);

export function MermaidSvgCacheProvider({ children }: { children: ReactNode }): ReactNode {
  const [cache] = useState<MermaidSvgCache>(() => new Map());
  return (
    <MermaidSvgCacheContext.Provider value={cache}>{children}</MermaidSvgCacheContext.Provider>
  );
}

export const useMermaidSvgCache = (): MermaidSvgCache => {
  const cache = useContext(MermaidSvgCacheContext);
  if (cache === null) {
    throw new Error("MarkdownMermaid must render inside MermaidSvgCacheProvider.");
  }
  return cache;
};

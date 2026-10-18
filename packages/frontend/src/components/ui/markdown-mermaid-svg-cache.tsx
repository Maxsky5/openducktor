import { createContext, type ReactNode, useContext, useState } from "react";
import { renderMermaidSvg } from "./markdown-mermaid-render";

/**
 * Mermaid SVGs by source, drawn or still drawing. A diagram that mounts again, for example when
 * the chat transcript scrolls a row back into its window, shows its SVG at once. Diagrams with the
 * same source run Mermaid once.
 */
export type MermaidSvgCache = Map<string, Drawing>;

type Drawing = {
  /** Render id of the SVG. Mermaid puts it in the ids and styles of the SVG. */
  renderId: string;
  svg: Promise<string>;
  /** The SVG after Mermaid has drawn it. */
  drawnSvg: string | null;
};

const MAX_CACHED_SVGS = 100;

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

/** Gives a copy of the drawn SVG of `source` with `renderId`, or null. Does not change the cache. */
export const peekMermaidSvg = (
  cache: MermaidSvgCache,
  source: string,
  renderId: string,
): string | null => {
  const drawing = cache.get(source);
  if (!drawing?.drawnSvg) {
    return null;
  }
  return withRenderId(drawing, drawing.drawnSvg, renderId);
};

/**
 * Gives the SVG of `source` with `renderId`. Mermaid runs only when no diagram has drawn the source
 * or is drawing it. A failed drawing leaves the cache, so the next diagram tries again.
 */
export const drawMermaidSvg = async (
  cache: MermaidSvgCache,
  source: string,
  renderId: string,
): Promise<string> => {
  const drawing = cache.get(source) ?? startDrawing(cache, source, renderId);
  cache.delete(source);
  cache.set(source, drawing);
  const oldestSource = cache.keys().next().value;
  if (cache.size > MAX_CACHED_SVGS && oldestSource !== undefined) {
    cache.delete(oldestSource);
  }
  return withRenderId(drawing, await drawing.svg, renderId);
};

const startDrawing = (cache: MermaidSvgCache, source: string, renderId: string): Drawing => {
  const drawing: Drawing = {
    renderId,
    svg: renderMermaidSvg(renderId, source),
    drawnSvg: null,
  };
  drawing.svg.then(
    (svg) => {
      drawing.drawnSvg = svg;
    },
    () => {
      if (cache.get(source) === drawing) {
        cache.delete(source);
      }
    },
  );
  return drawing;
};

// Each copy on the page needs its own element ids.
const withRenderId = (drawing: Drawing, svg: string, renderId: string): string =>
  svg.replaceAll(drawing.renderId, renderId);

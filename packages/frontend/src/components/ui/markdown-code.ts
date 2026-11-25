/**
 * Highlights fenced code with `@pierre/highlights`, the highlighter of the diff views, in the same
 * Pierre themes. The highlighter loads the first time that a view shows a code fence.
 */
import type { CodeHighlighterPlugin } from "@pierre/words/html";
import { createLazyModule, type LazyModuleState } from "./markdown-lazy-module";

const highlighter = createLazyModule(async (): Promise<CodeHighlighterPlugin> => {
  const [{ createHighlightsPlugin }, { default: light }, { default: dark }] = await Promise.all([
    import("@pierre/words/highlights"),
    import("@pierre/highlights/themes/pierre-light"),
    import("@pierre/highlights/themes/pierre-dark"),
  ]);
  // `light-dark()` follows the `color-scheme` of the theme, so a theme change needs no new render.
  return createHighlightsPlugin({ themes: { light, dark }, defaultColor: "light-dark()" });
});

/** The code highlighter. It starts to load when `needed` is true. */
export const useCodeHighlighter = (needed: boolean): LazyModuleState<CodeHighlighterPlugin> =>
  highlighter.useModule(needed);

/** True when the text can hold a fenced code block. */
export const mayHaveCodeFence = (markdown: string): boolean =>
  markdown.includes("```") || markdown.includes("~~~");

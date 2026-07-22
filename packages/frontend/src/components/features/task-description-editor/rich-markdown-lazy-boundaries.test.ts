import { describe, expect, test } from "bun:test";

const readSource = (relativePath: string): Promise<string> =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

describe("rich Markdown lazy module boundaries", () => {
  test("keeps TipTap out of the source-mode editor module graph", async () => {
    const sourceShell = await readSource("./task-description-editor.tsx");
    const compatibility = await readSource("./task-description-markdown-compatibility.ts");

    expect(sourceShell).toContain('lazy(() => import("./task-description-visual-editor"))');
    expect(sourceShell).toContain('import("./task-description-markdown")');
    expect(sourceShell).not.toContain('from "./task-description-markdown"');
    expect(sourceShell).not.toContain("@tiptap/");
    expect(compatibility).not.toContain("@tiptap/");
  });

  test("keeps KaTeX out of plain contextual rendering", async () => {
    const renderer = await readSource("../../ui/markdown-renderer.tsx");
    const contextualRenderer = await readSource("../../ui/markdown-renderer-rich.tsx");
    const mathRenderer = await readSource("../../ui/markdown-renderer-math.tsx");

    expect(renderer).toContain('lazy(() => import("./markdown-renderer-math"))');
    expect(contextualRenderer).not.toContain("katex");
    expect(contextualRenderer).not.toContain("remark-math");
    expect(contextualRenderer).not.toContain("rehype-katex");
    expect(mathRenderer).toContain('import "katex/dist/katex.min.css"');
    expect(mathRenderer).toContain('from "remark-math"');
    expect(mathRenderer).toContain('from "rehype-katex"');
  });
});

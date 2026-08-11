import { describe, expect, test } from "bun:test";

const readSource = (relativePath: string): Promise<string> =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

const FRONTEND_SRC_URL = new URL("../../../", import.meta.url);

const resolveLocalModule = async (specifier: string, parentUrl: URL): Promise<URL | undefined> => {
  let sourceUrl: URL;
  if (specifier.startsWith(".")) {
    sourceUrl = new URL(specifier, parentUrl);
  } else if (specifier.startsWith("@/")) {
    sourceUrl = new URL(specifier.slice(2), FRONTEND_SRC_URL);
  } else {
    return undefined;
  }

  if (specifier.endsWith(".css")) {
    return undefined;
  }
  if (specifier.endsWith(".ts") || specifier.endsWith(".tsx")) {
    return sourceUrl;
  }
  const tsxUrl = new URL(sourceUrl);
  tsxUrl.pathname += ".tsx";
  if (await Bun.file(tsxUrl).exists()) {
    return tsxUrl;
  }
  const tsUrl = new URL(sourceUrl);
  tsUrl.pathname += ".ts";
  return tsUrl;
};

const readStaticModuleGraph = async (
  relativePath: string,
  visited = new Set<string>(),
): Promise<{ files: Set<string>; packages: Set<string> }> => {
  const url = new URL(relativePath, import.meta.url);
  const path = url.pathname;
  if (visited.has(path)) {
    return { files: visited, packages: new Set() };
  }
  visited.add(path);

  const source = await Bun.file(url).text();
  const packages = new Set<string>();
  const loader = url.pathname.endsWith(".tsx") ? "tsx" : "ts";
  const imports = new Bun.Transpiler({ loader }).scan(source).imports;
  for (const importedModule of imports) {
    if (importedModule.kind !== "import-statement") {
      continue;
    }
    const specifier = importedModule.path;
    const childUrl = await resolveLocalModule(specifier, url);
    if (!childUrl) {
      packages.add(specifier);
      continue;
    }
    const childGraph = await readStaticModuleGraph(childUrl.href, visited);
    for (const packageName of childGraph.packages) {
      packages.add(packageName);
    }
  }

  return { files: visited, packages };
};

describe("rich Markdown lazy module boundaries", () => {
  test("loads the lightweight editor shell with the task form", async () => {
    const taskForm = await readSource("../task-composer/task-details-form.tsx");

    expect(taskForm).toContain(
      'import TaskDescriptionEditor from "@/components/features/task-description-editor/task-description-editor"',
    );
    expect(taskForm).not.toContain(
      'import("@/components/features/task-description-editor/task-description-editor")',
    );
  });

  test("keeps TipTap out of the source-mode editor module graph", async () => {
    const sourceShell = await readSource("./task-description-editor.tsx");
    const compatibility = await readSource("./task-description-markdown-compatibility.ts");

    expect(sourceShell).toContain(
      'const loadTaskDescriptionVisualEditor = () => import("./task-description-visual-editor")',
    );
    expect(sourceShell).toContain("lazy(loadTaskDescriptionVisualEditor)");
    expect(sourceShell).toContain('import("./task-description-markdown")');
    expect(sourceShell).not.toContain('from "./task-description-markdown"');
    expect(sourceShell).not.toContain("@tiptap/");
    expect(compatibility).not.toContain("@tiptap/");
  });

  test("keeps parser-backed math detection and KaTeX out of the base renderer graph", async () => {
    const renderer = await readSource("../../ui/markdown-renderer.tsx");
    const candidateRenderer = await readSource("../../ui/markdown-renderer-math-candidate.tsx");
    const mathRenderer = await readSource("../../ui/markdown-renderer-math.tsx");
    const baseGraph = await readStaticModuleGraph("../../ui/markdown-renderer.tsx");
    const candidateGraph = await readStaticModuleGraph(
      "../../ui/markdown-renderer-math-candidate.tsx",
    );

    expect(renderer).toContain('import("./markdown-renderer-math-candidate")');
    expect(renderer).not.toContain("markdown-math-detection");
    expect(baseGraph.packages).not.toContain("remark-math");
    expect(baseGraph.packages).not.toContain("remark-parse");
    expect(baseGraph.packages).not.toContain("unified");
    expect(baseGraph.packages).not.toContain("unist-util-visit");
    expect(baseGraph.packages).not.toContain("rehype-katex");
    expect(baseGraph.packages).not.toContain("katex/dist/katex.min.css");
    expect(candidateRenderer).toContain('lazy(() => import("./markdown-renderer-math"))');
    expect(candidateGraph.packages).toContain("remark-math");
    expect(candidateGraph.packages).not.toContain("rehype-katex");
    expect(candidateGraph.packages).not.toContain("katex/dist/katex.min.css");
    expect(candidateRenderer).toContain("fallback={fallback ?? fallbackContent}");
    expect(mathRenderer).toContain('import "katex/dist/katex.min.css"');
    expect(mathRenderer).toContain('from "remark-math"');
    expect(mathRenderer).toContain('from "rehype-katex"');
  });

  test("keeps parser-backed Mermaid detection out of the base renderer graph", async () => {
    const renderer = await readSource("../../ui/markdown-renderer.tsx");
    const baseGraph = await readStaticModuleGraph("../../ui/markdown-renderer.tsx");
    const candidateGraph = await readStaticModuleGraph(
      "../../ui/markdown-renderer-mermaid-candidate.tsx",
    );

    expect(renderer).toContain('import("./markdown-renderer-mermaid-candidate")');
    expect(baseGraph.packages).not.toContain("remark-parse");
    expect(baseGraph.packages).not.toContain("unified");
    expect(baseGraph.packages).not.toContain("unist-util-visit");
    expect(candidateGraph.packages).toContain("remark-parse");
    expect(candidateGraph.packages).toContain("unist-util-visit");
  });

  test("requires pinned TipTap Markdown list hooks without empty-output fallbacks", async () => {
    const extensions = await readSource("./task-description-markdown-extensions.ts");

    expect(extensions).toContain("requireMarkdownHook");
    expect(extensions).not.toContain("defaultListItemParseMarkdown?.(");
    expect(extensions).not.toContain("defaultListItemRenderMarkdown?.(");
    expect(extensions).not.toContain("defaultOrderedListParseMarkdown?.(");
    expect(extensions).not.toContain("defaultTaskItemParseMarkdown?.(");
    expect(extensions).not.toContain("defaultTaskItemRenderMarkdown?.(");
  });
});

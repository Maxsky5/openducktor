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

  test("loads diagrams and code highlighting only when a Markdown view shows them", async () => {
    for (const entry of [
      "../../ui/markdown-renderer.tsx",
      "../../ui/markdown-stream-renderer.tsx",
    ]) {
      const graph = await readStaticModuleGraph(entry);
      for (const packageName of [
        "pele",
        "@pierre/highlights",
        "@pierre/words/highlights",
        "katex",
        "remark-parse",
        "unified",
      ]) {
        expect(graph.packages).not.toContain(packageName);
      }
    }
    const diagrams = await readSource("../../ui/markdown-diagram.ts");
    const code = await readSource("../../ui/markdown-code.ts");
    expect(diagrams).toContain('import("pele")');
    expect(code).toContain('import("@pierre/words/highlights")');
  });
});

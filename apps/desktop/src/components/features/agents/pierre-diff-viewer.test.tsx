import { describe, expect, mock, test } from "bun:test";
import { buildHunkResetSeparator, getRenderableFileDiff } from "./pierre-diff-viewer";

class FakeElement {
  tagName: string;
  className = "";
  textContent = "";
  disabled = false;
  attributes = new Map<string, string>();
  children: Array<FakeElement | string> = [];
  private clickListener: ((event: { preventDefault: () => void }) => void) | null = null;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...nodes: Array<FakeElement | string>): void {
    this.children.push(...nodes);
  }

  addEventListener(
    eventName: string,
    listener: (event: { preventDefault: () => void }) => void,
  ): void {
    if (eventName === "click") {
      this.clickListener = listener;
    }
  }

  click(): void {
    this.clickListener?.({ preventDefault: () => {} });
  }
}

const createFakeDocument = (): Pick<Document, "createElement"> => ({
  createElement: (tagName: string) => new FakeElement(tagName) as unknown as HTMLElement,
});

describe("getRenderableFileDiff", () => {
  test("parses valid git patches", () => {
    const patch =
      "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";

    const result = getRenderableFileDiff(patch, "src/app.ts");

    expect(result.normalizedPatch).toBe(patch);
    expect(result.fallbackPatch).toBe(patch);
    expect(result.fileDiff?.name.endsWith("src/app.ts")).toBe(true);
  });

  test("normalizes hunk-only patches with the current file path", () => {
    const result = getRenderableFileDiff("@@ -1 +1 @@\n-old\n+new\n", "src/hunk.ts");

    expect(result.normalizedPatch).toBe(
      "--- a/src/hunk.ts\n+++ b/src/hunk.ts\n@@ -1 +1 @@\n-old\n+new\n",
    );
    expect(result.fileDiff?.name.endsWith("src/hunk.ts")).toBe(true);
  });

  test("keeps normalized raw diff text when parsing still fails", () => {
    const result = getRenderableFileDiff(
      "Index: src/app.ts\n=====\ninvalid diff body",
      "src/app.ts",
    );

    expect(result.fileDiff).toBeNull();
    expect(result.fallbackPatch).toBe("Index: src/app.ts\n=====\ninvalid diff body\n");
  });

  test("builds hunk reset separators with an actionable reset button", () => {
    const onResetHunk = mock((_hunkIndex: number) => {});
    const renderIcon = mock((_node: unknown) => {});
    const separator = buildHunkResetSeparator(
      "src/app.ts",
      2,
      false,
      onResetHunk,
      createFakeDocument(),
      () => ({ render: renderIcon }),
    ) as unknown as FakeElement;

    expect(separator.className).toContain("border-border/50");

    const [label, button] = separator.children as [FakeElement, FakeElement];
    expect(label.textContent).toBe("Chunk 3");
    expect(button.attributes.get("aria-label")).toBe("Reset chunk");
    expect(button.attributes.get("data-testid")).toBe("agent-studio-git-reset-hunk-button");
    expect(renderIcon).toHaveBeenCalledTimes(1);

    button.click();

    expect(onResetHunk).toHaveBeenCalledWith(2);
  });

  test("keeps disabled hunk reset separators non-interactive", () => {
    const onResetHunk = mock((_hunkIndex: number) => {});
    const separator = buildHunkResetSeparator(
      "src/app.ts",
      0,
      true,
      onResetHunk,
      createFakeDocument(),
      () => ({ render: () => {} }),
    ) as unknown as FakeElement;

    const button = separator.children[1] as FakeElement;
    expect(button.disabled).toBe(true);

    button.click();

    expect(onResetHunk).toHaveBeenCalledTimes(0);
  });
});

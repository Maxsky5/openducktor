import { describe, expect, test } from "bun:test";
import { classifyImageSource } from "./image-source";

describe("classifyImageSource", () => {
  test("reads task asset references", () => {
    expect(classifyImageSource("odt-asset:3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toEqual({
      kind: "task_asset",
      assetId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
    expect(classifyImageSource("odt-asset:not-a-uuid")).toEqual({
      kind: "unsupported",
      reason: "The task image reference is not valid.",
    });
  });

  test("reads web images", () => {
    expect(classifyImageSource("https://example.com/a.png")).toEqual({
      kind: "remote",
      url: "https://example.com/a.png",
    });
  });

  test("loads GitHub issue attachments through the host for a task from a GitHub issue", () => {
    const url = "https://github.com/user-attachments/assets/0f3c2a5e-1b2c-4d5e-8f90-123456789abc";
    const context = {
      workspaceId: "w",
      taskId: "t",
      issue: { repoPath: "/repo", providerId: "github" },
    };
    expect(classifyImageSource(url, context)).toEqual({ kind: "issue_image", url });
    expect(classifyImageSource(url, { ...context, issue: null }).kind).toBe("remote");
    expect(
      classifyImageSource(url, { ...context, issue: { repoPath: "/repo", providerId: "azure" } })
        .kind,
    ).toBe("remote");
  });

  test.each(["data:image/png;base64,AAAA", "file:///tmp/a.png", "images/a.png", "javascript:x"])(
    "does not show %s",
    (url) => {
      expect(classifyImageSource(url).kind).toBe("unsupported");
    },
  );
});

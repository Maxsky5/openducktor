import { describe, expect, test } from "bun:test";
import {
  hostInvokeFailureSchema,
  workspaceTextFileReadResultSchema,
  workspaceTextFileWriteInputSchema,
  workspaceTextFileWriteResultSchema,
} from "./index";

const textResult = {
  kind: "text" as const,
  rootPath: "/repo",
  relativePath: "src/index.ts",
  contents: "export {};",
  size: 10,
  mtimeMs: 1,
  revision: `sha256:${"a".repeat(64)}`,
};

describe("workspace text file contracts", () => {
  test("requires an opaque revision on text reads and writes", () => {
    expect(workspaceTextFileReadResultSchema.parse(textResult)).toEqual(textResult);
    expect(workspaceTextFileWriteResultSchema.parse(textResult)).toEqual(textResult);
    expect(
      workspaceTextFileWriteInputSchema.parse({
        rootPath: textResult.rootPath,
        relativePath: textResult.relativePath,
        contents: textResult.contents,
        revision: textResult.revision,
      }),
    ).toMatchObject({ revision: textResult.revision });
    expect(
      workspaceTextFileReadResultSchema.safeParse({ ...textResult, revision: undefined }).success,
    ).toBe(false);
  });

  test("rejects unknown write input fields", () => {
    expect(
      workspaceTextFileWriteInputSchema.safeParse({
        rootPath: "/repo",
        relativePath: "README.md",
        contents: "ok",
        revision: "revision-1",
        force: true,
      }).success,
    ).toBe(false);
  });

  test("rejects unknown write result fields", () => {
    expect(
      workspaceTextFileWriteResultSchema.safeParse({ ...textResult, unexpected: true }).success,
    ).toBe(false);
  });

  test("parses structured workspace write failures", () => {
    expect(
      hostInvokeFailureSchema.parse({
        kind: "workspace_text_file_write",
        workspaceTextFileWriteFailure: {
          code: "stale_revision",
          message: "The file changed after it was loaded.",
          rootPath: "/repo",
          relativePath: "README.md",
        },
      }),
    ).toMatchObject({
      kind: "workspace_text_file_write",
      workspaceTextFileWriteFailure: { code: "stale_revision" },
    });
  });
});

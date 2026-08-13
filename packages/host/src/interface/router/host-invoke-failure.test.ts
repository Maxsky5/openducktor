import { describe, expect, test } from "bun:test";
import { WorkspaceTextFileWriteError } from "../../application/filesystem/workspace-text-file-service";
import { hostInvokeFailureFromError } from "./host-invoke-failure";

describe("hostInvokeFailureFromError", () => {
  test("preserves structured workspace text file write failures", () => {
    expect(
      hostInvokeFailureFromError(
        new WorkspaceTextFileWriteError({
          message: "The file changed after it was loaded.",
          failure: {
            code: "stale_revision",
            message: "The file changed after it was loaded.",
            rootPath: "/repo",
            relativePath: "file.txt",
          },
        }),
      ),
    ).toEqual({
      kind: "workspace_text_file_write",
      workspaceTextFileWriteFailure: {
        code: "stale_revision",
        message: "The file changed after it was loaded.",
        rootPath: "/repo",
        relativePath: "file.txt",
      },
    });
  });
});

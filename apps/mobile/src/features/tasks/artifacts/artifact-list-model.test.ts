import { describe, expect, test } from "bun:test";
import type { FreeTaskArtifact, WorkflowTaskArtifact } from "@openducktor/contracts";
import { artifactDetail, artifactIcon, workflowDocumentKey } from "./artifact-list-model";

const now = Date.parse("2026-10-24T12:00:00.000Z");

describe("artifact list model", () => {
  test("describes a file by format, size, and age", () => {
    const file: FreeTaskArtifact = {
      artifactId: "file-1",
      taskId: "task-1",
      name: "Login",
      revision: 1,
      updatedAt: "2026-10-24T11:57:00.000Z",
      classification: "free",
      code: "login",
      fileName: "login.png",
      mediaType: "image/png",
      byteSize: 12_288,
    };

    expect(artifactDetail(file, now)).toBe("PNG · 12.0 KiB · 3m ago");
    expect(artifactDetail({ ...file, updatedAt: null, mediaType: "application/zip" }, now)).toBe(
      "File · 12.0 KiB",
    );
    expect(artifactIcon(file.mediaType)).toBe("file-image");
    expect(artifactIcon("text/html")).toBe("file-code-2");
  });

  test("opens each workflow artifact in its Documents view", () => {
    const plan: WorkflowTaskArtifact = {
      artifactId: "workflow:task-1:implementation_plan",
      taskId: "task-1",
      name: "Implementation Plan",
      revision: 2,
      updatedAt: null,
      classification: "workflow",
      code: "plan",
      mediaType: "text/markdown",
    };

    expect(artifactDetail(plan, now)).toBe("Markdown");
    expect([
      workflowDocumentKey("spec"),
      workflowDocumentKey("plan"),
      workflowDocumentKey("qaReport"),
    ]).toEqual(["spec", "plan", "qa"]);
  });
});

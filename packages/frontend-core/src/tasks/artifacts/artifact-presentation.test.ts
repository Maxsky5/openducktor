import { describe, expect, test } from "bun:test";
import type { FreeTaskArtifact, WorkflowTaskArtifact } from "@openducktor/contracts";
import {
  artifactFormatLabel,
  artifactPreviewKind,
  decodeArtifactText,
  groupTaskArtifacts,
} from "./artifact-presentation";

const workflow = (code: string): WorkflowTaskArtifact => ({
  artifactId: `workflow:task-1:${code}`,
  taskId: "task-1",
  name: code,
  revision: 1,
  updatedAt: null,
  classification: "workflow",
  code,
  mediaType: "text/markdown",
});

const file = (name: string): FreeTaskArtifact => ({
  artifactId: `file:${name}`,
  taskId: "task-1",
  name,
  revision: 1,
  updatedAt: null,
  classification: "free",
  code: name.toLowerCase(),
  fileName: `${name}.txt`,
  mediaType: "text/plain",
  byteSize: 1,
});

describe("artifact presentation", () => {
  test("lists workflow artifacts in workflow order and files by name", () => {
    const groups = groupTaskArtifacts([
      file("Notes"),
      workflow("qaReport"),
      file("Diagram"),
      workflow("spec"),
      workflow("plan"),
    ]);

    expect(groups.workflow.map((item) => item.code)).toEqual(["spec", "plan", "qaReport"]);
    expect(groups.files.map((item) => item.name)).toEqual(["Diagram", "Notes"]);
  });

  test("previews the desktop formats and names other formats as files", () => {
    expect(
      ["TEXT/MARKDOWN", "text/plain", "text/html", "image/svg+xml", "application/json"].map(
        artifactPreviewKind,
      ),
    ).toEqual(["markdown", "text", "html", "image", "none"]);
    expect(artifactFormatLabel("image/PNG")).toBe("PNG");
    expect(artifactFormatLabel("application/zip")).toBe("File");
  });

  test("keeps the literal text and refuses invalid UTF-8", () => {
    expect(decodeArtifactText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("﻿a");
    expect(decodeArtifactText(new Uint8Array([0x61, 0xff]))).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import {
  artifactReadResultSchema,
  artifactReadRequestSchema,
  freeArtifactContentInputSchema,
  TASK_ARTIFACT_MAX_FILE_BYTES,
  taskArtifactSchema,
} from "./task-artifact-schemas";
import {
  ReadTaskArtifactsInputSchema,
  readTaskArtifactsOutputSchema,
  readTaskArtifactsResultSchema,
  SetTaskArtifactInputSchema,
} from "./odt-artifact-schemas";

const artifact = {
  artifactId: "free-1",
  code: "notes",
  taskId: "task-1",
  classification: "free" as const,
  name: "Specification",
  revision: 1,
  updatedAt: "2026-10-22T12:00:00.000Z",
  fileName: "notes.txt",
  mediaType: "text/plain",
  byteSize: 5,
};

describe("task artifact transport contracts", () => {
  test("free metadata cannot claim workflow authority through a name or extra fields", () => {
    expect(taskArtifactSchema.parse(artifact).classification).toBe("free");
    expect(taskArtifactSchema.safeParse({ ...artifact, workflowKind: "spec" }).success).toBe(false);
    expect(taskArtifactSchema.safeParse({ ...artifact, verdict: "approved" }).success).toBe(false);
    expect(taskArtifactSchema.safeParse({ ...artifact, classification: "workflow" }).success).toBe(
      false,
    );
  });

  test("write schemas bound decoded bytes and preserve empty file content", () => {
    const input = { fileName: "data.bin", mediaType: "application/octet-stream", dataBase64: "" };
    expect(freeArtifactContentInputSchema.parse(input).dataBase64).toBe("");
    const bytes = Buffer.alloc(TASK_ARTIFACT_MAX_FILE_BYTES);
    expect(
      freeArtifactContentInputSchema.safeParse({ ...input, dataBase64: bytes.toString("base64") })
        .success,
    ).toBe(true);
    expect(
      freeArtifactContentInputSchema.safeParse({
        ...input,
        dataBase64: Buffer.concat([bytes, Buffer.from([1])]).toString("base64"),
      }).success,
    ).toBe(false);
    expect(
      freeArtifactContentInputSchema.safeParse({ ...input, dataBase64: "not base64" }).success,
    ).toBe(false);
  });

  test("text writes enforce UTF-8 byte size and reject unsafe filenames", () => {
    const input = {
      taskId: "task-1",
      code: "notes",
      name: "Notes",
      fileName: "notes.txt",
      mediaType: "text/plain",
      content: "\uFEFFhello\r\n",
    };
    expect(SetTaskArtifactInputSchema.parse(input).content).toEqual(input.content);
    const { content: _content, ...file } = input;
    expect(SetTaskArtifactInputSchema.parse({ ...file, dataBase64: "AP8=" }).dataBase64).toBe(
      "AP8=",
    );
    expect(SetTaskArtifactInputSchema.safeParse({ ...input, dataBase64: "AP8=" }).success).toBe(
      false,
    );
    expect(
      SetTaskArtifactInputSchema.safeParse({
        ...input,
        content: { encoding: "utf8", text: input.content },
      }).success,
    ).toBe(false);
    expect(
      SetTaskArtifactInputSchema.safeParse({
        ...input,
        content: "text\ud800",
      }).success,
    ).toBe(false);
    expect(
      SetTaskArtifactInputSchema.parse({
        ...input,
        content: "\u{1f600}",
      }).content,
    ).toEqual("\u{1f600}");
    expect(
      SetTaskArtifactInputSchema.safeParse({
        ...input,
        content: "\u00e9".repeat(TASK_ARTIFACT_MAX_FILE_BYTES / 2 + 1),
      }).success,
    ).toBe(false);
    for (const fileName of ["../notes.txt", "folder\\notes.txt", "bad\u0000.txt", "..", "."]) {
      expect(SetTaskArtifactInputSchema.safeParse({ ...input, fileName }).success).toBe(false);
    }
  });

  test("reads reject range and continuation options", () => {
    const input = { taskId: "task-1", codes: ["notes"] };
    const hostInput = {
      workspaceId: "ws",
      repoPath: "/repo",
      taskId: "task-1",
      artifactId: "free-1",
    };
    expect(ReadTaskArtifactsInputSchema.parse(input)).toEqual(input);
    expect(artifactReadRequestSchema.parse(hostInput)).toEqual(hostInput);
    for (const field of [{ byteOffset: 0 }, { maxBytes: 4 }, { expectedVersion: "old" }]) {
      expect(ReadTaskArtifactsInputSchema.safeParse({ ...input, ...field }).success).toBe(false);
      expect(artifactReadRequestSchema.safeParse({ ...hostInput, ...field }).success).toBe(false);
    }
  });

  test("reads select distinct codes", () => {
    const input = { taskId: "task-1" };
    for (const fields of [
      {},
      { codes: [] },
      { codes: ["spec", "spec"] },
      { artifactIds: ["free-1"] },
      { maxBytes: 4 },
      { byteOffset: 0 },
      { expectedVersion: "v1" },
      { codes: ["spec", "plan"], byteOffset: 0 },
      { codes: ["spec", "notes"], expectedVersion: "v1" },
    ]) {
      expect(ReadTaskArtifactsInputSchema.safeParse({ ...input, ...fields }).success).toBe(false);
    }
    const selection = {
      ...input,
      codes: ["spec", "plan", "qaReport", "notes", "preview"],
    };
    expect(ReadTaskArtifactsInputSchema.parse(selection)).toEqual(selection);
  });

  test("batch output accepts optional decoded text and excludes original and preview bodies", () => {
    const { artifactId: _artifactId, ...publicArtifact } = artifact;
    const chunk = {
      artifact: publicArtifact,
    };
    expect(
      readTaskArtifactsResultSchema.safeParse({
        artifacts: [{ ...chunk, dataBase64: "aGVsbG8=" }],
      }).success,
    ).toBe(true);
    const text = "\ufeffhello\r\né😀\u0000";
    const output = {
      artifacts: [
        {
          ...chunk,
          artifact: { ...publicArtifact, byteSize: Buffer.byteLength(text) },
          content: text,
        },
        chunk,
        {
          ...chunk,
          artifact: { ...publicArtifact, byteSize: 0 },
          content: "",
        },
      ],
    };
    expect(readTaskArtifactsOutputSchema.parse(output)).toEqual(output);
    for (const fields of [
      { content: { text: "hello" } },
      { imagePreview: { state: "not-image" } },
      { dataBase64: "aGVsbG8=" },
    ]) {
      expect(
        readTaskArtifactsOutputSchema.safeParse({ artifacts: [{ ...chunk, ...fields }] }).success,
      ).toBe(false);
    }
    expect(
      readTaskArtifactsResultSchema.safeParse({
        artifacts: [{ artifact: publicArtifact, version: "v1" }],
      }).success,
    ).toBe(false);
    expect(
      readTaskArtifactsResultSchema.safeParse({
        artifacts: [{ ...chunk, dataBase64: "aGVsbG8=" }],
        canManageFree: true,
      }).success,
    ).toBe(false);
  });

  test("reads require the complete bytes, including empty files", () => {
    const full = { artifact, dataBase64: "aGVsbG8=" };
    expect(artifactReadResultSchema.parse(full)).toEqual(full);
    for (const dataBase64 of ["aGVsbA==", "", "aGVsbG8h"]) {
      expect(artifactReadResultSchema.safeParse({ ...full, dataBase64 }).success).toBe(false);
    }
    expect(
      artifactReadResultSchema.safeParse({
        artifact: { ...artifact, byteSize: 0 },
        dataBase64: "",
      }).success,
    ).toBe(true);
  });
});

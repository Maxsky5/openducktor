import { describe, expect, test } from "bun:test";
import {
  artifactContentChunkSchema,
  artifactReadMetadataSchema,
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

  test("continued reads require a version and MCP budgets stay within the public limits", () => {
    const input = { taskId: "task-1", codes: ["notes"] };
    expect(ReadTaskArtifactsInputSchema.safeParse({ ...input, byteOffset: 4 }).success).toBe(false);
    expect(
      artifactReadRequestSchema.safeParse({
        taskId: input.taskId,
        artifactId: "free-1",
        repoPath: "/repo",
        byteOffset: 4,
      }).success,
    ).toBe(false);
    expect(
      ReadTaskArtifactsInputSchema.parse({
        ...input,
        byteOffset: 4,
        expectedVersion: "v1",
        maxBytes: 4,
      }).maxBytes,
    ).toBe(4);
    for (const maxBytes of [0, 3, 1024 * 1024 + 1]) {
      expect(ReadTaskArtifactsInputSchema.safeParse({ ...input, maxBytes }).success).toBe(false);
    }
    expect(
      ReadTaskArtifactsInputSchema.safeParse({ ...input, maxBytes: 1024 * 1024 }).success,
    ).toBe(true);
  });

  test("reads select distinct codes and limit continuation to one artifact", () => {
    const input = { taskId: "task-1" };
    for (const fields of [
      {},
      { codes: [] },
      { codes: ["spec", "spec"] },
      { codes: ["Invalid Code"] },
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
      maxBytes: 4,
    };
    expect(ReadTaskArtifactsInputSchema.parse(selection)).toEqual(selection);
  });

  test("batch output accepts optional decoded text and excludes original and preview bodies", () => {
    const { artifactId: _artifactId, ...publicArtifact } = artifact;
    const chunk = {
      artifact: publicArtifact,
      version: "v1",
      byteOffset: 0,
      nextByteOffset: null,
      totalBytes: 5,
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
          totalBytes: Buffer.byteLength(text),
          content: text,
        },
        chunk,
        {
          ...chunk,
          artifact: { ...publicArtifact, byteSize: 0 },
          totalBytes: 0,
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

  test("read chunks validate offsets while metadata excludes original and preview bodies", () => {
    const chunk = {
      artifact,
      version: "v1",
      byteOffset: 0,
      nextByteOffset: 4,
      totalBytes: 5,
      dataBase64: "aGVsbA==",
    };
    expect(artifactContentChunkSchema.safeParse(chunk).success).toBe(true);
    for (const patch of [
      { nextByteOffset: null },
      { nextByteOffset: 3 },
      { totalBytes: 3 },
      { dataBase64: "" },
    ]) {
      expect(artifactContentChunkSchema.safeParse({ ...chunk, ...patch }).success).toBe(false);
    }
    expect(
      artifactContentChunkSchema.safeParse({
        ...chunk,
        byteOffset: 4,
        nextByteOffset: null,
        dataBase64: "bw==",
      }).success,
    ).toBe(true);
    expect(
      artifactContentChunkSchema.safeParse({
        ...chunk,
        artifact: { ...artifact, byteSize: 0 },
        totalBytes: 0,
        nextByteOffset: null,
        dataBase64: "",
      }).success,
    ).toBe(true);
    expect(artifactReadMetadataSchema.safeParse(chunk).success).toBe(false);
  });
});

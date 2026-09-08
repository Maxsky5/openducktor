import { expect, test } from "bun:test";
import { codexImageGenerationPart, type CodexImageGenerationItem } from "./codex-image-generation";
import { createCodexEventMapperPipeline } from "./codex-event-mapper-pipeline";

const item = (status: string): CodexImageGenerationItem => ({
  type: "imageGeneration",
  id: "image",
  status,
  revisedPrompt: null,
  result: "",
  failure: null,
  transparentBackground: null,
});

test("terminal turns take precedence over unknown image statuses and live starts", () => {
  for (const status of ["future_status", "", "in_progress"]) {
    expect(
      codexImageGenerationPart(item(status), { turnStatus: "interrupted", liveStart: true }),
    ).toMatchObject({ status: "interrupted" });
    expect(
      codexImageGenerationPart(item(status), { turnStatus: "failed", liveStart: true }),
    ).toMatchObject({ status: "incomplete", incompleteReason: "runtime_failure" });
    expect(
      codexImageGenerationPart(item(status), { turnStatus: "completed", liveStart: true }),
    ).toMatchObject({ status: "incomplete", incompleteReason: "incomplete_history" });
  }
  for (const turnStatus of ["interrupted", "failed", "completed", "inProgress"] as const) {
    for (const status of ["completed", "failed"]) {
      expect(codexImageGenerationPart(item(status), { turnStatus }).status).toBe(status);
    }
  }
  expect(
    codexImageGenerationPart(item("future_status"), { turnStatus: "inProgress" }),
  ).toMatchObject({ status: "incomplete", incompleteReason: "unknown_status" });
});

test("native status and turn context define truthful outcomes", () => {
  for (const status of ["", "in_progress"]) {
    expect(codexImageGenerationPart(item(status), { liveStart: true }).status).toBe("running");
    expect(codexImageGenerationPart(item(status)).status).toBe("incomplete");
    expect(codexImageGenerationPart(item(status), { turnStatus: "interrupted" }).status).toBe(
      "interrupted",
    );
    expect(codexImageGenerationPart(item(status), { turnStatus: "failed" }).incompleteReason).toBe(
      "runtime_failure",
    );
  }
  expect(codexImageGenerationPart(item("unknown"), { liveStart: true }).incompleteReason).toBe(
    "unknown_status",
  );
  expect(codexImageGenerationPart(item("completed")).status).toBe("completed");
  expect(codexImageGenerationPart(item("completed")).output).toBeUndefined();
  expect(
    codexImageGenerationPart({ ...item("failed"), result: "bytes", savedPath: "/image.png" })
      .output,
  ).toBeUndefined();
});

test("saved output wins, inline bytes stay outside the transcript, and null metadata stays absent", () => {
  const native = {
    ...item("completed"),
    result: "private-bytes",
    revisedPrompt: "A duck",
    savedPath: "/image.png",
  };
  const part = codexImageGenerationPart(native);
  expect(part).toMatchObject({
    revisedPrompt: "A duck",
    savedPath: "/image.png",
  });
  expect(part.transparentBackground).toBeUndefined();
  expect(part.output!.revision.length).toBeGreaterThan(0);
  expect(Object.keys(part.output!)).toEqual(["revision"]);
  expect(JSON.stringify(part)).not.toContain("private-bytes");
  expect(part.output).toEqual(codexImageGenerationPart({ ...native, result: "" }).output);
  expect(part.output).not.toEqual(
    codexImageGenerationPart({ ...native, savedPath: "/other.png" }).output,
  );
});

test("inline output revisions track reported bytes without exposing them", () => {
  const native = { ...item("completed"), result: "private-bytes" };
  const first = codexImageGenerationPart(native).output;
  expect(first).toEqual({ revision: expect.any(String) });
  expect(first!.revision.length).toBeGreaterThan(0);
  expect(codexImageGenerationPart({ ...native, revisedPrompt: "A duck" }).output).toEqual(first);
  expect(codexImageGenerationPart({ ...native, result: "different-bytes" }).output).not.toEqual(
    first,
  );
  expect(codexImageGenerationPart({ ...native, savedPath: native.result }).output).not.toEqual(
    first,
  );
  expect(JSON.stringify(first)).not.toContain(native.result);
});

test("usage limits preserve only supplied reset times", () => {
  for (const resetsAt of [null, 1788644100]) {
    const part = codexImageGenerationPart({
      ...item("failed"),
      failure: { type: "usageLimitExceeded", limitId: "images", resetsAt },
    });
    expect(part.failure?.kind).toBe("usage_limit");
    expect(part.failure?.resetsAtEpochSeconds).toBe(resetsAt ?? undefined);
    expect(part.failure).not.toHaveProperty("limitId");
  }
});

test("live and public history use the same normalized item identity and metadata", () => {
  const pipeline = createCodexEventMapperPipeline();
  const native = { ...item("completed"), result: "bytes" };
  const ctx = { threadId: "thread", turnId: "turn" };
  const live = pipeline.runLive(
    { kind: "item_completed", item: native },
    { ...ctx, source: "live" },
  );
  const history = pipeline.runThreadItem(
    { item: native, index: 0 },
    { ...ctx, source: "thread_read" },
  );
  expect(live).toHaveLength(1);
  expect(history).toEqual(live.map((event) => ({ ...event, source: "thread_read" })));
});

test("general failure without native details is explicit in live and history", () => {
  const pipeline = createCodexEventMapperPipeline();
  const native = item("failed");
  const context = { threadId: "thread", turnId: "turn" };
  const failure = codexImageGenerationPart(native).failure;
  expect(failure).toEqual({
    kind: "generation_failed",
    message:
      "Codex could not generate this image. It did not include a reason in the image result.",
  });
  const live = pipeline.runLive(
    { kind: "item_completed", item: native },
    { ...context, source: "live" },
  );
  const history = pipeline.runThreadItem(
    { item: native, index: 0 },
    { ...context, source: "thread_read" },
  );
  expect(live).toHaveLength(1);
  expect(history).toEqual(live.map((event) => ({ ...event, source: "thread_read" })));
  expect(JSON.stringify(live)).toContain(failure!.message);
});

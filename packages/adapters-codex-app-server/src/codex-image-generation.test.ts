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
    output: { representation: "saved_file", itemId: "image" },
  });
  expect(part.transparentBackground).toBeUndefined();
  expect(JSON.stringify(part)).not.toContain("private-bytes");
  expect(
    codexImageGenerationPart({ ...item("completed"), result: "bytes" }).output?.representation,
  ).toBe("inline");
});

test("usage limits preserve only supplied reset times", () => {
  for (const resetsAt of [null, 1788644100]) {
    const part = codexImageGenerationPart({
      ...item("failed"),
      failure: { type: "usageLimitExceeded", limitId: "images", resetsAt },
    });
    expect(part.failure?.kind).toBe("usage_limit");
    expect(part.failure?.resetsAtEpochSeconds).toBe(resetsAt ?? undefined);
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

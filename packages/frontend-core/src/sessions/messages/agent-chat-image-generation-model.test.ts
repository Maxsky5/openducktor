import { describe, expect, test } from "bun:test";
import type { AgentImageGenerationPart, AgentSessionLiveRef } from "@openducktor/contracts";
import {
  imageGenerationFailureText,
  imageGenerationStatusLabel,
  resolveGeneratedImagePreviewPlan,
} from "./agent-chat-image-generation-model";

const ref: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo",
  externalSessionId: "session-1",
};

const OUTPUT = { revision: "r1" };

const part = (overrides: Partial<AgentImageGenerationPart>): AgentImageGenerationPart => ({
  kind: "image_generation",
  messageId: "message-1",
  partId: "part-1",
  itemId: "item-1",
  status: "completed",
  ...overrides,
});

describe("image generation model", () => {
  test("labels each status", () => {
    expect(imageGenerationStatusLabel(part({ status: "running" }))).toBe("Generating image…");
    expect(
      imageGenerationStatusLabel(
        part({ status: "failed", failure: { kind: "usage_limit", message: "x" } }),
      ),
    ).toBe("Image generation limit reached");
  });

  test("plans a metadata read for a saved image without output", () => {
    expect(
      resolveGeneratedImagePreviewPlan(part({ savedPath: "/tmp/a.png", turnId: "t1" }), ref, true),
    ).toEqual({
      kind: "metadata",
      ref,
      itemId: "item-1",
      turnId: "t1",
    });
  });

  test("plans a revision read for an image with output", () => {
    expect(resolveGeneratedImagePreviewPlan(part({ output: OUTPUT }), ref, true)).toEqual({
      kind: "revision",
      ref,
      itemId: "item-1",
      revision: "r1",
    });
  });

  test("reports a runtime without image previews", () => {
    expect(resolveGeneratedImagePreviewPlan(part({}), ref, false).kind).toBe("unsupported");
  });

  test("gives the next steps of a failure", () => {
    const text = imageGenerationFailureText(
      { kind: "usage_limit", message: "Limit", resetsAtEpochSeconds: 10 },
      () => "later",
    );
    expect(text).toEqual({
      message: "Limit",
      nextSteps: ["Wait until later before requesting another image."],
    });
  });
});

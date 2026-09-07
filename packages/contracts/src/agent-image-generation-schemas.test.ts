import { expect, test } from "bun:test";
import {
  agentImageGenerationPartSchema,
  agentGeneratedImageReadInputSchema,
} from "./agent-image-generation-schemas";
import {
  mandatoryRuntimeCapabilityKeys,
  optionalRuntimeCapabilityKeys,
  runtimeCapabilityClasses,
} from "./agent-runtime-schemas";

test("image generation is an optional output capability", () => {
  expect(optionalRuntimeCapabilityKeys).toContain("optionalSurfaces.supportsImageGeneration");
  expect(mandatoryRuntimeCapabilityKeys).not.toContain("optionalSurfaces.supportsImageGeneration");
  expect(runtimeCapabilityClasses["optionalSurfaces.supportsImageGeneration"]).toBe(
    "optional_enhancement",
  );
});

test("image output requires completion and an opaque revision without runtime source fields", () => {
  const part = {
    kind: "image_generation",
    messageId: "image",
    partId: "image",
    itemId: "image",
    status: "completed",
    output: { revision: "output-v1" },
  };
  expect(agentImageGenerationPartSchema.safeParse(part).success).toBe(true);
  for (const status of ["failed", "running", "incomplete", "interrupted"]) {
    expect(agentImageGenerationPartSchema.safeParse({ ...part, status }).success).toBe(false);
  }
  for (const output of [
    {},
    { revision: "" },
    { revision: "output-v1", itemId: "image" },
    { revision: "output-v1", representation: "inline" },
    { revision: "output-v1", base64: "bytes" },
  ]) {
    expect(agentImageGenerationPartSchema.safeParse({ ...part, output }).success).toBe(false);
  }
  expect(agentImageGenerationPartSchema.safeParse({ ...part, base64: "bytes" }).success).toBe(
    false,
  );
});

test("normalized failures do not expose native limit identifiers", () => {
  const part = {
    kind: "image_generation",
    messageId: "message",
    partId: "part",
    itemId: "image",
    status: "failed",
    failure: { kind: "usage_limit", message: "Image quota exhausted.", resetsAtEpochSeconds: 1 },
  };
  expect(agentImageGenerationPartSchema.safeParse(part).success).toBe(true);
  expect(
    agentImageGenerationPartSchema.safeParse({
      ...part,
      failure: { ...part.failure, limitId: "native-limit" },
    }).success,
  ).toBe(false);
});

test("image reads require identity and revision but reject path and URL authority", () => {
  const input = {
    ref: {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "session",
    },
    itemId: "image",
    revision: "output-v1",
  };
  expect(agentGeneratedImageReadInputSchema.safeParse(input).success).toBe(true);
  const { revision: _revision, ...withoutRevision } = input;
  expect(agentGeneratedImageReadInputSchema.safeParse(withoutRevision).success).toBe(false);
  expect(agentGeneratedImageReadInputSchema.safeParse({ ...input, revision: "" }).success).toBe(
    false,
  );
  for (const field of ["path", "url", "base64", "runtimeId", "taskId"]) {
    expect(
      agentGeneratedImageReadInputSchema.safeParse({ ...input, [field]: "forged" }).success,
    ).toBe(false);
  }
});

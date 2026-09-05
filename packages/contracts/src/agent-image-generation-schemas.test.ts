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

test("image output requires matching completed identity and carries no image bytes", () => {
  const part = {
    kind: "image_generation",
    messageId: "image",
    partId: "image",
    itemId: "image",
    status: "completed",
    output: { itemId: "image", representation: "inline" },
  };
  expect(agentImageGenerationPartSchema.safeParse(part).success).toBe(true);
  for (const status of ["failed", "running", "incomplete", "interrupted"]) {
    expect(agentImageGenerationPartSchema.safeParse({ ...part, status }).success).toBe(false);
  }
  expect(
    agentImageGenerationPartSchema.safeParse({
      ...part,
      output: { itemId: "other", representation: "inline" },
    }).success,
  ).toBe(false);
  expect(agentImageGenerationPartSchema.safeParse({ ...part, base64: "bytes" }).success).toBe(
    false,
  );
});

test("image reads accept identity but reject path and URL authority", () => {
  const input = {
    ref: {
      repoPath: "/repo",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      externalSessionId: "session",
    },
    itemId: "image",
  };
  expect(agentGeneratedImageReadInputSchema.safeParse(input).success).toBe(true);
  for (const field of ["path", "url", "base64", "runtimeId", "taskId"]) {
    expect(
      agentGeneratedImageReadInputSchema.safeParse({ ...input, [field]: "forged" }).success,
    ).toBe(false);
  }
});

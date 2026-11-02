import { expect } from "bun:test";
import type { AgentSessionRecord, DirectMergeRecord, PullRequest } from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { z } from "zod";

const firstFailure = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected Effect failure.");
  }
  const failureOption = Cause.findErrorOption(exit.cause);
  if (failureOption._tag !== "Some") {
    throw new Error("Expected Effect failure cause.");
  }
  return failureOption.value;
};

const failureTagSchema = z.object({ _tag: z.string() }).passthrough();

const readTag = (
  result: z.ZodSafeParseResult<z.output<typeof failureTagSchema>>,
): string | undefined => (result.success ? result.data._tag : undefined);

export const expectFailureTag = async <A, E>(
  effect: Effect.Effect<A, E>,
  expectedTag: string,
): Promise<E> => {
  const failure = await firstFailure(effect);
  expect(readTag(failureTagSchema.safeParse(failure))).toBe(expectedTag);
  return failure;
};

export const createAgentSessionRecord = (
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord => ({
  externalSessionId: "session-1",
  role: "build",
  startedAt: "2026-06-10T10:00:00.000Z",
  runtimeKind: "opencode",
  workingDirectory: "/repos/fairnest/worktrees/session-1",
  selectedModel: null,
  ...overrides,
});

export const createPullRequestRecord = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  providerId: "github",
  number: 42,
  url: "https://github.com/acme/fairnest/pull/42",
  state: "open",
  createdAt: "2026-06-10T10:00:00.000Z",
  updatedAt: "2026-06-10T10:00:00.000Z",
  ...overrides,
});

export const createDirectMergeRecord = (
  overrides: Partial<DirectMergeRecord> = {},
): DirectMergeRecord => ({
  method: "squash",
  sourceBranch: "task/fairnest-1",
  targetBranch: { remote: "origin", branch: "main" },
  mergedAt: "2026-06-10T11:00:00.000Z",
  ...overrides,
});

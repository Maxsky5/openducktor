import { describe, expect, test } from "bun:test";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { AgentTextGenerationInput } from "@openducktor/contracts";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { createNamingService } from "./naming-service";

const namingModel = { runtimeKind: "opencode", providerId: "openai", modelId: "mini" } as const;

const service = (answer: Effect.Effect<string, HostOperationError>) => {
  const inputs: AgentTextGenerationInput[] = [];
  const naming = createNamingService({
    timeout: "20 millis",
    settingsConfig: { readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()) },
    textGeneration: {
      generate: (input) => Effect.sync(() => inputs.push(input)).pipe(Effect.andThen(answer)),
    },
  });
  return { naming, inputs };
};

const request = (overrides = {}) => ({
  repoConfig: repoConfigFixture({ namingModel, ...overrides }),
  outputs: { title: true, branch: false },
  workText: "First message:\nFix login",
});

describe("naming service", () => {
  test("asks the naming model of the workspace and reads its answer", async () => {
    const { naming, inputs } = service(Effect.succeed('{"title":"Login fix"}'));
    expect(await Effect.runPromise(naming.generate(request()))).toEqual({
      kind: "generated",
      title: "Login fix",
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.model).toEqual(namingModel);
    expect(inputs[0]?.instructions).toContain('"title"');
    expect(inputs[0]?.instructions).not.toContain('"branch"');
    expect(inputs[0]?.prompt).toContain("First message:\nFix login");
  });

  test("makes no call without a naming model", async () => {
    const { naming, inputs } = service(Effect.succeed("{}"));
    const outcome = await Effect.runPromise(
      naming.generate({ ...request(), repoConfig: repoConfigFixture() }),
    );
    expect(outcome).toEqual({ kind: "disabled" });
    expect(inputs).toEqual([]);
  });

  test("gives up after the deadline", async () => {
    const { naming } = service(Effect.never);
    expect(await Effect.runPromise(naming.generate(request()))).toEqual({ kind: "timed_out" });
  });

  test("reports a runtime error and an unusable answer", async () => {
    const failed = service(
      Effect.fail(new HostOperationError({ operation: "test", message: "Runtime stopped." })),
    );
    expect(await Effect.runPromise(failed.naming.generate(request()))).toEqual({
      kind: "failed",
      message: "Runtime stopped.",
    });
    const unusable = service(Effect.succeed("I cannot help."));
    expect(await Effect.runPromise(unusable.naming.generate(request()))).toMatchObject({
      kind: "failed",
    });
  });

  test("uses a workspace prompt override", async () => {
    const { naming, inputs } = service(Effect.succeed('{"title":"Login fix"}'));
    await Effect.runPromise(
      naming.generate(
        request({
          promptOverrides: {
            '["workflow","odt.naming","workspace-session-title"]': {
              template: "Team title rules.\n{{workText}}",
              baseVersion: 1,
            },
          },
        }),
      ),
    );
    expect(inputs[0]?.prompt).toContain("Team title rules.\nFirst message:\nFix login");
  });
});

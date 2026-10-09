import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { createSettingsConfigTestDouble } from "../../test-support/service-test-doubles";
import { createClaudeLaunchPolicy } from "./claude-launch-policy";

test("reads saved Claude settings for each new launch", async () => {
  const config = createDefaultGlobalConfig();
  config.agentRuntimes.claude.defaults = { permissionMode: "acceptEdits" };
  config.agentRuntimes.claude.roleOverrides.qa = { permissions: { allow: [] } };
  const readConfig = mock(() => Effect.succeed(config));
  const policies = createClaudeLaunchPolicy(createSettingsConfigTestDouble({ readConfig }));
  const first = await Effect.runPromise(policies.resolve({ role: null }));
  config.agentRuntimes.claude.defaults = {
    permissionMode: "dontAsk",
    toolAvailability: { Artifact: true, RetiredTool: false },
  };
  const next = await Effect.runPromise(policies.resolve({ role: "qa" }));
  expect(first).toEqual({
    permissionMode: "acceptEdits",
    toolAvailability: { Artifact: false, ArtifactComments: false, ArtifactData: false },
  });
  expect(next).toEqual({
    permissionMode: "dontAsk",
    permissions: { allow: [] },
    toolAvailability: { Artifact: true, RetiredTool: false },
  });
  expect(readConfig).toHaveBeenCalledTimes(2);
});

test("reports missing saved settings before launching Claude", async () => {
  const policies = createClaudeLaunchPolicy(
    createSettingsConfigTestDouble({
      readConfig: () => Effect.succeed(null),
    }),
  );
  await expect(Effect.runPromise(policies.resolve({ role: null }))).rejects.toThrow(
    "Open Settings and save before starting Claude",
  );
});

test("propagates settings read failures without using another policy", async () => {
  const policies = createClaudeLaunchPolicy(
    createSettingsConfigTestDouble({
      readConfig: () =>
        Effect.fail(
          new HostOperationError({
            operation: "settings.read",
            message: "Cannot read saved settings",
          }),
        ),
    }),
  );
  await expect(Effect.runPromise(policies.resolve({ role: null }))).rejects.toThrow(
    "Cannot read saved settings",
  );
});

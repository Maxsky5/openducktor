import { describe, expect, test } from "bun:test";
import { globalConfigSchema, persistedGlobalConfigV3Schema } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSettingsConfigTestDouble } from "../../test-support/service-test-doubles";
import { createWorkspaceOwnershipLock } from "./workspace-ownership-lock";
import { createWorkspaceSettingsService } from "./workspace-settings-service";

const setup = () => {
  let config = globalConfigSchema.parse({ version: 4 });
  const service = createWorkspaceSettingsService(
    createSettingsConfigTestDouble({
      readConfig: () => Effect.sync(() => structuredClone(config)),
      writeConfig: (next) =>
        Effect.sync(() => {
          config = structuredClone(next);
        }),
    }),
    createWorkspaceOwnershipLock(),
  );
  return { service, config: () => config };
};

describe("global Custom Agent Roles", () => {
  test("trims names, sorts roles, retains IDs on edit, and gives replacements new IDs", async () => {
    const { service } = setup();
    const zebra = await Effect.runPromise(
      service.createCustomAgentRole({ name: " Zebra ", systemPrompt: "Keep this prompt." }),
    );
    const alpha = await Effect.runPromise(
      service.createCustomAgentRole({ name: "Alpha", systemPrompt: "Another prompt." }),
    );
    expect(
      (await Effect.runPromise(service.listCustomAgentRoles())).map((role) => role.name),
    ).toEqual(["Alpha", "Zebra"]);
    const edited = await Effect.runPromise(
      service.updateCustomAgentRole(zebra.id, { name: "Zed", systemPrompt: "Changed prompt." }),
    );
    expect(edited.id).toBe(zebra.id);
    expect(zebra).toEqual({ id: zebra.id, name: "Zebra", systemPrompt: "Keep this prompt." });
    await Effect.runPromise(service.deleteCustomAgentRole(alpha.id));
    const replacement = await Effect.runPromise(
      service.createCustomAgentRole({ name: "Alpha", systemPrompt: "New prompt." }),
    );
    expect(replacement.id).not.toBe(alpha.id);
  });

  test("rejects duplicate trimmed names regardless of case without changing saved data", async () => {
    const { service, config } = setup();
    await Effect.runPromise(
      service.createCustomAgentRole({ name: "Reviewer", systemPrompt: "Review." }),
    );
    const other = await Effect.runPromise(
      service.createCustomAgentRole({ name: "Writer", systemPrompt: "Write." }),
    );
    const before = structuredClone(config());
    await expect(
      Effect.runPromise(
        service.createCustomAgentRole({ name: " reviewer ", systemPrompt: "Different." }),
      ),
    ).rejects.toThrow("already exists");
    await expect(
      Effect.runPromise(
        service.updateCustomAgentRole(other.id, { name: "REVIEWER", systemPrompt: "Different." }),
      ),
    ).rejects.toThrow("already exists");
    expect(config()).toEqual(before);
  });

  test("rejects invalid input and missing role updates or deletion", async () => {
    const { service, config } = setup();
    await expect(
      Effect.runPromise(service.createCustomAgentRole({ name: " ", systemPrompt: "Prompt" })),
    ).rejects.toThrow("requires a name");
    await expect(
      Effect.runPromise(
        service.updateCustomAgentRole("missing", { name: "Name", systemPrompt: "Prompt" }),
      ),
    ).rejects.toThrow("not found");
    await expect(Effect.runPromise(service.deleteCustomAgentRole("missing"))).rejects.toThrow(
      "not found",
    );
    expect(config().customAgentRoles).toEqual([]);
  });

  test("serializes role and settings writes without losing either change", async () => {
    const { service, config } = setup();
    const { customAgentRoles, ...snapshot } = await Effect.runPromise(
      service.getSettingsSnapshot(),
    );
    expect(customAgentRoles).toEqual([]);
    await Effect.runPromise(
      Effect.all(
        [
          service.createCustomAgentRole({ name: "One", systemPrompt: "One" }),
          service.saveSettingsSnapshot({
            ...snapshot,
            chat: { ...snapshot.chat, showThinkingMessages: true },
          }),
          service.createCustomAgentRole({ name: "Two", systemPrompt: "Two" }),
        ],
        { concurrency: "unbounded" },
      ),
    );
    expect(config().chat.showThinkingMessages).toBe(true);
    expect(config().customAgentRoles.map((role) => role.name)).toEqual(["One", "Two"]);
  });

  test("validates duplicate names and IDs in persisted config and defaults old config to no roles", () => {
    expect(persistedGlobalConfigV3Schema.parse({ version: 3 }).customAgentRoles).toEqual([]);
    const role = { id: "one", name: "Name", systemPrompt: "Prompt" };
    expect(
      globalConfigSchema.safeParse({
        version: 4,
        customAgentRoles: [role, { ...role, id: "two", name: " NAME " }],
      }).success,
    ).toBe(false);
    expect(
      globalConfigSchema.safeParse({
        version: 4,
        customAgentRoles: [role, { ...role, name: "Other" }],
      }).success,
    ).toBe(false);
  });
});

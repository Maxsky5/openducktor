import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createHostRuntimeServiceTestDouble } from "../../test-support/host-runtime-service-test-double";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import {
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";
import { createWorkspaceSettingsCommandHandlers } from "./workspace-settings-command-handlers";

test("routes role commands with validated input and rejects client-supplied IDs on create", async () => {
  const role = { id: "role-1", name: "Reviewer", systemPrompt: "Review code." };
  const calls: unknown[] = [];
  const service = createWorkspaceSettingsServiceTestDouble({
    listCustomAgentRoles: () => Effect.succeed([role]),
    createCustomAgentRole: (input) =>
      Effect.sync(() => {
        calls.push(input);
        return role;
      }),
    updateCustomAgentRole: (id, input) =>
      Effect.sync(() => {
        calls.push({ id, input });
        return role;
      }),
    deleteCustomAgentRole: (id) =>
      Effect.sync(() => {
        calls.push(id);
      }),
  });
  const router = toPromiseHostCommandRouter(
    createEffectHostCommandRouter({
      handlers: createWorkspaceSettingsCommandHandlers(
        service,
        createHostRuntimeServiceTestDouble(),
      ),
    }),
  );
  const input = { name: role.name, systemPrompt: role.systemPrompt };
  expect(await router.invoke("custom_agent_role_list")).toEqual([role]);
  expect(await router.invoke("custom_agent_role_create", { input })).toEqual(role);
  expect(await router.invoke("custom_agent_role_update", { id: role.id, input })).toEqual(role);
  await router.invoke("custom_agent_role_delete", { id: role.id });
  expect(calls).toEqual([input, { id: role.id, input }, role.id]);
  await expect(router.invoke("custom_agent_role_create", { input: role })).rejects.toThrow();
  await expect(router.invoke("custom_agent_role_update", { input })).rejects.toThrow();
  await expect(router.invoke("custom_agent_role_list", { unexpected: true })).rejects.toThrow();
  expect(calls).toHaveLength(3);
});

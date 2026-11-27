import { afterEach, describe, expect, test } from "bun:test";
import type { AgentSessionModelSelection } from "@openducktor/contracts";
import { createManualTimers } from "../test-support/manual-timers";
import { createDemoSessionAdapter } from "./demo-session-adapter";

const lifetimes: AbortController[] = [];
afterEach(() => {
  for (const lifetime of lifetimes.splice(0)) lifetime.abort();
});

const openClient = () => {
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  return createDemoSessionAdapter(lifetime.signal, createManualTimers().timers).host.client;
};

describe("demo models", () => {
  // The demo catalogs come from the sample models of the product scenes. A seeded model that the
  // catalog of its runtime does not list shows its raw ID and no effort in the model field.
  test("every sample session uses a model that the catalog of its runtime lists", async () => {
    const client = openClient();
    const selections: AgentSessionModelSelection[] = [];
    for (const workspace of await client.workspaceList()) {
      const scope = { workspaceId: workspace.workspaceId, repoPath: workspace.repoPath };
      const tasks = await client.tasksList(scope);
      const records = await client.agentSessionsListForTasks(
        scope,
        tasks.map((task) => task.id),
      );
      for (const record of records)
        for (const session of record.agentSessions)
          if (session.selectedModel) selections.push(session.selectedModel);
      for (const chat of await client.workspaceSessionListActive(workspace.workspaceId))
        if (chat.selectedModel) selections.push(chat.selectedModel);
    }
    expect(selections.length).toBeGreaterThan(0);
    const workingDirectory = "/Users/sam/code/fieldnotes";
    for (const selection of selections) {
      const catalog = await client.agentRuntimeLoadCatalog({
        repoPath: workingDirectory,
        runtimeKind: selection.runtimeKind ?? "opencode",
        workingDirectory,
      });
      const models = catalog.models?.status === "available" ? catalog.models.catalog.models : [];
      expect(models.map((model) => `${model.providerId}/${model.modelId}`)).toContain(
        `${selection.providerId}/${selection.modelId}`,
      );
    }
  });
});

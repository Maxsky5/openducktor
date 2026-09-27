import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createAzureDevOpsCredentialIndex } from "./credential-index";

test("lists and removes every credential scope for one workspace", async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-azure-index-"));
  try {
    const index = createAzureDevOpsCredentialIndex({ configDir });
    const first = {
      scope: "workspace-1\n/repo\nazure_devops::server::first",
      deployment: "server",
    } as const;
    const second = {
      scope: "workspace-1\n/repo\nazure_devops::services::second",
      deployment: "services",
    } as const;
    await Effect.runPromise(index.register("workspace-1", first));
    await Effect.runPromise(index.register("workspace-1", second));
    await Effect.runPromise(
      index.register("workspace-2", {
        scope: "workspace-2\n/repo\nazure_devops::server::other",
        deployment: "server",
      }),
    );

    const scopes = await Effect.runPromise(index.list("workspace-1"));
    expect(scopes.sort((left, right) => left.scope.localeCompare(right.scope))).toEqual([
      first,
      second,
    ]);
    await Effect.runPromise(index.forget("workspace-1", first.scope));
    await Effect.runPromise(index.forget("workspace-1", second.scope));

    await expect(Effect.runPromise(index.list("workspace-1"))).resolves.toEqual([]);
    await expect(Effect.runPromise(index.list("workspace-2"))).resolves.toHaveLength(1);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});

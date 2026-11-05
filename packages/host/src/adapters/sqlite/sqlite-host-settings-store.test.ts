import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promptOverrideKey, repoConfigSchema, type GlobalConfig } from "@openducktor/contracts";
import {
  SPEC_PLAN_BUILD_PROMPT_OVERRIDE_KEYS,
  BUILTIN_ROLE_IDS,
  specPlanBuildPromptKey,
  rolePromptKey,
} from "@openducktor/workflows/test-support";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { applyTaskWorkflowSettings } from "../../config/workflow-settings";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { openHostDatabaseConnection } from "./sqlite-host-database-connection";
import {
  agentRuntimeSettings,
  globalPromptOverrides,
  workspaceAzureConfig,
  workspacePromptOverrides,
} from "./sqlite-host-settings-schema";
import { createSqliteGitlabAccountStore } from "./sqlite-gitlab-account-store";
import { createSqliteSharedSettingsDatabase } from "./sqlite-shared-settings-database";
import { hostMetadata, type HostDatabaseSession } from "./sqlite-host-database-schema";
import { readRuntimePolicies } from "./sqlite-host-settings-store-policies";
import {
  applyHostSharedConfigEdits,
  importHostSharedConfig,
  readHostSharedConfig,
} from "./sqlite-host-settings-store";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

const withDatabase = async (
  run: (connection: Effect.Success<ReturnType<typeof openHostDatabaseConnection>>) => Promise<void>,
) => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-host-settings-"));
  const connection = await Effect.runPromise(
    openHostDatabaseConnection(path.join(root, "database.sqlite")),
  );
  try {
    await run(connection);
  } finally {
    await Effect.runPromise(connection.release);
    await rm(root, { recursive: true, force: true });
  }
};

/** Without an `initial` config, the edit changes the saved settings. */
const measureSettingsEdits = async (
  session: HostDatabaseSession,
  change: (current: GlobalConfig) => GlobalConfig,
  initial?: GlobalConfig,
) => {
  let requests = 0;
  const result = await Effect.runPromise(
    session.transaction("test.editKeys", (transaction) =>
      Effect.gen(function* () {
        let current: GlobalConfig | null = null;
        let next = initial;
        if (!next) {
          current = yield* readHostSharedConfig(transaction);
          next = change(structuredClone(current));
        }
        const before = yield* transaction.execute(
          (db) => db.values<[number]>(sql`select total_changes()`),
          "test.rowChanges",
        );
        yield* applyHostSharedConfigEdits(
          {
            ...transaction,
            execute: (run, operation, details) => {
              requests += 1;
              return transaction.execute(run, operation, details);
            },
          },
          current,
          next,
        );
        const after = yield* transaction.execute(
          (db) => db.values<[number]>(sql`select total_changes()`),
          "test.rowChanges",
        );
        return { next, rows: after[0]![0] - before[0]![0] };
      }),
    ),
  );
  const stored = await Effect.runPromise(readHostSharedConfig(session));
  expect(JSON.parse(JSON.stringify(stored))).toEqual(JSON.parse(JSON.stringify(result.next)));
  return { requests, rows: result.rows };
};

/** The key of a prompt of a workflow that no catalog checks. */
const customPromptKey = (index: number) =>
  promptOverrideKey({
    ownerKind: "workflow",
    ownerId: "custom",
    promptId: index === 349 ? "constructor" : `template-${index}`,
  });

describe("shared host settings", () => {
  test("writes only changed prompt and role keys and preserves other workspaces", async () => {
    await withDatabase(async ({ session }) => {
      const config = createDefaultGlobalConfig();
      const prompts = Object.fromEntries(
        SPEC_PLAN_BUILD_PROMPT_OVERRIDE_KEYS.map((id) => [
          id,
          { template: `Prompt ${id}`, baseVersion: 1, enabled: false },
        ]),
      );
      const models = Object.fromEntries(
        BUILTIN_ROLE_IDS.map((id) => [
          id,
          {
            runtimeKind: "codex" as const,
            providerId: "openai",
            modelId: `model-${id}`,
            variant: "high",
            profileId: "profile",
          },
        ]),
      );
      config.globalPromptOverrides = prompts;
      for (const workspaceId of ["one", "two"])
        config.workspaces[workspaceId] = repoConfigFixture({
          workspaceId,
          workspaceName: workspaceId,
          repoPath: `/${workspaceId}`,
          promptOverrides: prompts,
          agentDefaults: models,
        });
      await Effect.runPromise(
        session.transaction("test.import", (transaction) =>
          importHostSharedConfig(
            transaction,
            applyTaskWorkflowSettings(config, builtinTaskWorkflows),
          ),
        ),
      );
      const edit = (change: (next: GlobalConfig) => void) =>
        measureSettingsEdits(session, (current) => {
          change(current);
          applyTaskWorkflowSettings(current, builtinTaskWorkflows);
          return current;
        });
      const promptId = rolePromptKey("build");
      const costs = [
        await edit((next) => {
          next.globalPromptOverrides[promptId]!.template = "Global edit";
          delete next.globalPromptOverrides[promptId]!.enabled;
        }),
        await edit((next) => {
          next.workspaces.one!.promptOverrides[promptId]!.template = "Workspace edit";
          delete next.workspaces.one!.promptOverrides[promptId]!.enabled;
        }),
        await edit((next) => {
          const model = next.workspaces.one!.agentDefaults.build!;
          model.modelId = "updated";
          delete model.variant;
          delete model.profileId;
        }),
      ];
      expect(costs).toEqual(Array.from({ length: 3 }, () => ({ requests: 1, rows: 1 })));
      expect(
        await edit((next) => {
          delete next.globalPromptOverrides[promptId];
          delete next.workspaces.one!.promptOverrides[promptId];
          delete next.workspaces.one!.agentDefaults.build;
        }),
      ).toEqual({ requests: 3, rows: 3 });
      expect(
        await edit((next) => {
          next.globalPromptOverrides[promptId] = { template: "Added", baseVersion: 2 };
          next.workspaces.one!.promptOverrides[promptId] = {
            template: "Added",
            baseVersion: 2,
            enabled: false,
          };
          next.workspaces.one!.agentDefaults.build = {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "added",
          };
        }),
      ).toEqual({ requests: 3, rows: 3 });
      expect(await edit(() => {})).toEqual({ requests: 0, rows: 0 });
    });
  });

  test("stores role and workflow prompt overrides by owner and reads back their keys", async () => {
    await withDatabase(async ({ session }) => {
      const config = createDefaultGlobalConfig();
      const overrides = {
        [rolePromptKey("build")]: { template: "Build", baseVersion: 2, enabled: true },
        [specPlanBuildPromptKey("messages.qa_review")]: { template: "QA", baseVersion: 3 },
      };
      config.globalPromptOverrides = overrides;
      config.workspaces.one = repoConfigFixture({
        workspaceId: "one",
        workspaceName: "One",
        repoPath: "/one",
        promptOverrides: overrides,
      });
      await Effect.runPromise(
        session.transaction("test.import", (transaction) =>
          importHostSharedConfig(
            transaction,
            applyTaskWorkflowSettings(config, builtinTaskWorkflows),
          ),
        ),
      );

      const owners = (rows: readonly { ownerKind: string; ownerId: string; promptId: string }[]) =>
        rows.map(({ ownerKind, ownerId, promptId }) => [ownerKind, ownerId, promptId]).sort();
      const expectedOwners = [
        ["role", "build", "instructions"],
        ["workflow", "openducktor-spec-plan-build", "messages.qa_review"],
      ];
      expect(
        owners(
          await Effect.runPromise(
            session.execute((db) => db.select().from(globalPromptOverrides), "test.globalRows"),
          ),
        ),
      ).toEqual(expectedOwners);
      expect(
        owners(
          await Effect.runPromise(
            session.execute(
              (db) => db.select().from(workspacePromptOverrides),
              "test.workspaceRows",
            ),
          ),
        ),
      ).toEqual(expectedOwners);
      const stored = await Effect.runPromise(readHostSharedConfig(session));
      expect(stored.globalPromptOverrides).toEqual(overrides);
      expect(stored.workspaces.one?.promptOverrides).toEqual(overrides);
    });
  });

  test("batches large keyed maps during import, mixed edits, and removal", async () => {
    await withDatabase(async ({ session }) => {
      const config = createDefaultGlobalConfig();
      config.hostId = "f24f4d32-64f7-4d8a-ae78-cbcd22003c0a";
      config.globalPromptOverrides = Object.fromEntries(
        Array.from({ length: 350 }, (_, index) => [
          customPromptKey(index),
          { template: `Prompt ${index}`, baseVersion: 1, enabled: false },
        ]),
      );
      config.workspaces.one = repoConfigFixture({
        workspaceId: "one",
        workspaceName: "One",
        repoPath: "/one",
        closed: false,
        promptOverrides: config.globalPromptOverrides,
        agentDefaults: Object.fromEntries(
          Array.from({ length: 350 }, (_, index) => [
            index === 349 ? "constructor" : `role-${index}`,
            {
              runtimeKind: "codex",
              providerId: "openai",
              modelId: `model-${index}`,
              variant: "high",
              profileId: "profile",
            },
          ]),
        ),
      });
      const imported = await measureSettingsEdits(session, (current) => current, config);
      expect(imported.rows).toBe(1055);
      expect(imported.requests).toBeLessThanOrEqual(19);
      const mixed = await measureSettingsEdits(session, (current) => {
        const next = current;
        const workspace = next.workspaces.one!;
        for (let index = 0; index < 350; index++) {
          const removedKey = customPromptKey(index);
          const addedKey = customPromptKey(index + 350);
          delete next.globalPromptOverrides[removedKey];
          next.globalPromptOverrides[addedKey] = {
            template: `Replacement ${index}`,
            baseVersion: 2,
          };
          if (index % 2) next.globalPromptOverrides[addedKey]!.enabled = true;
          delete workspace.promptOverrides[removedKey];
          workspace.promptOverrides[addedKey] = {
            template: `Replacement ${index}`,
            baseVersion: 2,
            enabled: true,
          };
          const roleId = index === 349 ? "constructor" : `role-${index}`;
          const model = workspace.agentDefaults[roleId]!;
          model.modelId = `updated-${index}`;
          if (index % 2) model.variant = "low";
          else delete model.variant;
          if (index % 3) model.profileId = "updated-profile";
          else delete model.profileId;
        }
        return next;
      });
      expect(mixed.rows).toBe(1750);
      expect(mixed.requests).toBeLessThanOrEqual(20);
      const removed = await measureSettingsEdits(session, (current) => {
        current.globalPromptOverrides = {};
        current.workspaces.one!.promptOverrides = {};
        current.workspaces.one!.agentDefaults = {};
        return current;
      });
      expect(removed.rows).toBe(1050);
      expect(removed.requests).toBeLessThanOrEqual(12);
    });
  });

  test("scopes settings edits and keeps all other workspace data", async () => {
    await withDatabase(async ({ session }) => {
      const config = createDefaultGlobalConfig();
      config.hostId = "f24f4d32-64f7-4d8a-ae78-cbcd22003c0a";
      for (const id of ["one", "two"])
        config.workspaces[id] = repoConfigFixture({
          workspaceId: id,
          workspaceName: id,
          repoPath: `/${id}`,
          promptOverrides: {
            [rolePromptKey("build")]: { template: `${id} prompt`, baseVersion: 1 },
          },
        });
      await Effect.runPromise(
        session.transaction("test.import", (tx) => importHostSharedConfig(tx, config)),
      );
      await Effect.runPromise(
        session.execute(
          (db) =>
            db
              .insert(hostMetadata)
              .values({ singletonId: 1, importComplete: true, catalogRevision: 0 }),
          "test.metadata",
        ),
      );
      const settings = createSqliteSharedSettingsDatabase({
        withHostDatabase: (_operation, use) => use(session),
      });
      const before = await Effect.runPromise(settings.readConfig());
      await Effect.runPromise(
        settings.updateConfig((current) => {
          expect(current.workspaces).toEqual({});
          return { ...current, git: { ...current.git, removeWorktreeOnClose: false } };
        }, []),
      );
      await Effect.runPromise(
        settings.updateConfig(
          (current, catalog) => {
            expect(Object.keys(current.workspaces)).toEqual(["one"]);
            expect(catalog.map(({ workspaceId }) => workspaceId).sort()).toEqual(["one", "two"]);
            current.workspaces.one!.workspaceName = "Edited";
            return current;
          },
          ["one"],
        ),
      );
      const stored = await Effect.runPromise(settings.readConfig());
      expect(stored?.workspaces.two).toEqual(before?.workspaces.two);
      expect(stored?.workspaces.one?.workspaceName).toBe("Edited");
      expect(stored?.workspaces.one?.promptOverrides).toEqual(
        config.workspaces.one?.promptOverrides,
      );
      expect(stored?.git.removeWorktreeOnClose).toBe(false);
    });
  });

  test("preserves shared settings and writes only changed groups", async () => {
    await withDatabase(async ({ session }) => {
      let queries = 0;
      const counted = (current: HostDatabaseSession): HostDatabaseSession => ({
        ...current,
        execute: (run, operation, details) => {
          queries += 1;
          return current.execute(run, operation, details);
        },
        readTransaction: (operation, use) =>
          current.readTransaction(operation, (snapshot) => use(counted(snapshot))),
      });
      const settings = createSqliteSharedSettingsDatabase({
        withHostDatabase: (_operation, use) => use(counted(session)),
      });
      const measure = async <A, E>(read: Effect.Effect<A, E>) => {
        queries = 0;
        const value = await Effect.runPromise(read);
        return { value, queries };
      };
      expect(
        (await Effect.runPromise(settings.readWorkspaceCatalogSnapshot().pipe(Effect.result)))._tag,
      ).toBe("Failure");
      const config = createDefaultGlobalConfig();
      config.hostId = "f24f4d32-64f7-4d8a-ae78-cbcd22003c0a";
      config.workspaces.one = repoConfigSchema.parse({
        workspaceId: "one",
        workspaceName: "One",
        repoPath: "/same/repo",
        defaultTargetBranch: { branch: "@{upstream}" },
        closed: true,
        abbreviation: "ONE",
        tileColor: "#3b82f6",
        removal: { removeTaskWorktrees: false, phase: "attachments", pendingWorktreePath: null },
        defaultModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
        agentDefaults: {
          build: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5", variant: "fast" },
        },
        promptOverrides: {
          [rolePromptKey("build")]: { template: "", baseVersion: 1, enabled: false },
        },
        git: {
          provider: {
            id: "github",
            repository: { host: "github.com", owner: "owner", name: "one" },
          },
        },
        hooks: { postComplete: ["echo done", "echo done"] },
        worktreeCopyPaths: [".env", ".env"],
        actions: {
          items: [
            {
              id: "start",
              icon: "play",
              name: "Start",
              command: "bun start",
              runOnWorktreeCreate: true,
              waitBeforeAgentStart: false,
            },
          ],
          defaultActionId: "start",
        },
      });
      config.workspaces.two = repoConfigFixture({
        workspaceId: "two",
        workspaceName: "Two",
        repoPath: "/same/repo",
        closed: false,
      });
      config.globalPromptOverrides = {
        [rolePromptKey("build")]: { template: "", baseVersion: 1, enabled: false },
      };
      config.remoteAccess = {
        enabled: false,
        configuration: { listenHost: "192.168.1.9", listenPort: 9000, webOrigins: [] },
      };
      config.agentRuntimes.claude.defaults = {
        toolAvailability: {},
        permissions: { allow: [] },
        sandbox: {
          enabled: false,
          filesystem: {},
          network: { allowUnixSockets: [], strictAllowlist: false },
        },
      };
      config.agentRuntimes.claude.roleOverrides = {
        build: {
          toolAvailability: { Read: false, Write: true },
          permissions: {
            allow: ["Bash(git *)", "Bash(git *)"],
            ask: ["Write"],
            deny: ["Read(.env)"],
          },
          sandbox: {
            excludedCommands: ["bun", "git", "bun"],
            filesystem: {
              allowWrite: ["/tmp/z", "/tmp/a"],
              denyWrite: ["/private"],
              denyRead: ["/secret"],
              allowRead: ["/public"],
            },
            network: {
              allowedDomains: ["z.example", "a.example"],
              deniedDomains: ["private.example"],
              allowUnixSockets: ["/tmp/z.sock", "/tmp/a.sock"],
            },
          },
        },
        qa: {},
      };
      config.agentRuntimes.codex.roleOverrides = { build: { commandNetworkAccess: false }, qa: {} };
      config.agentRuntimes.opencode.defaults.rules = [
        { permission: "bash", pattern: "git *", action: "ask" },
        { permission: "bash", pattern: "git *", action: "ask" },
      ];
      config.agentRuntimes.custom = { enabled: true, executablePath: "/opt/custom" };
      config.autopilot.rules = [
        {
          workflowId: "openducktor-spec-plan-build",
          eventId: "build.completed",
          actionIds: ["qa"],
        },
        { workflowId: "custom", eventId: "build.completed", actionIds: ["qa"] },
      ];
      await Effect.runPromise(
        session.transaction("test.import", (transaction) =>
          Effect.gen(function* () {
            yield* importHostSharedConfig(transaction, createDefaultGlobalConfig());
            yield* transaction.execute(
              (db) =>
                db
                  .insert(hostMetadata)
                  .values({ singletonId: 1, importComplete: true, catalogRevision: 9 }),
              "test.metadata",
            );
          }),
        ),
      );
      expect(await Effect.runPromise(settings.readWorkspaceCatalogSnapshot())).toEqual({
        catalogRevision: 9,
        workspaces: [],
      });
      const expected = structuredClone(config);
      await Effect.runPromise(settings.updateConfig(() => config));
      const storedRuntimes = await Effect.runPromise(
        session.execute((db) => db.select().from(agentRuntimeSettings), "test.runtimeRows"),
      );
      expect(
        Object.fromEntries(
          storedRuntimes.map(({ runtimeKind, policyJson }) => [
            runtimeKind,
            policyJson === null ? null : JSON.parse(policyJson),
          ]),
        ),
      ).toEqual({
        opencode: {
          defaults: config.agentRuntimes.opencode.defaults,
          roleOverrides: config.agentRuntimes.opencode.roleOverrides,
        },
        codex: {
          defaults: config.agentRuntimes.codex.defaults,
          roleOverrides: config.agentRuntimes.codex.roleOverrides,
        },
        claude: {
          defaults: config.agentRuntimes.claude.defaults,
          roleOverrides: config.agentRuntimes.claude.roleOverrides,
        },
        custom: null,
      });
      expect(storedRuntimes.find(({ runtimeKind }) => runtimeKind === "custom")).toEqual({
        runtimeKind: "custom",
        enabled: true,
        executablePath: "/opt/custom",
        policyJson: null,
      });
      expect(await Effect.runPromise(settings.readRepoConfig("missing"))).toBeNull();
      expect(await Effect.runPromise(settings.readRepoConfigByRepoPath("/missing"))).toBeNull();
      const ambiguous = await Effect.runPromise(
        settings.readRepoConfigByRepoPath("/same/repo").pipe(Effect.result),
      );
      expect(ambiguous._tag).toBe("Failure");
      if (ambiguous._tag === "Failure")
        expect(ambiguous.failure.message).toContain("multiple workspaces");
      const catalog = await measure(settings.readWorkspaceCatalogSnapshot());
      expect(catalog.queries).toBe(1);
      expect(catalog.value).toEqual({
        catalogRevision: 10,
        workspaces: [
          {
            workspaceId: "one",
            workspaceName: "One",
            repoPath: "/same/repo",
            abbreviation: "ONE",
            tileColor: "#3b82f6",
            closed: true,
            removal: {
              removeTaskWorktrees: false,
              phase: "attachments",
              pendingWorktreePath: null,
            },
          },
          { workspaceId: "two", workspaceName: "Two", repoPath: "/same/repo", closed: false },
        ],
      });
      const full = await measure(settings.readConfig());
      expect(full.queries).toBe(3);
      // SQLite reads materialize absent optional columns as undefined.
      expect(JSON.parse(JSON.stringify(full.value))).toEqual(expected);
      const { agentStudioState: _ui, ...workspace } = expected.workspaces.one!;
      const selected = await measure(settings.readRepoConfig("one"));
      expect(selected.queries).toBe(1);
      expect(selected.value).toEqual(workspace);
      expect(selected.value).not.toHaveProperty("agentStudioState");
      const global = await measure(settings.readGlobalConfig());
      expect(global.queries).toBe(2);
      const autopilot = await measure(settings.readAutopilotSettings());
      expect(autopilot.queries).toBe(1);
      expect(autopilot.value).toEqual(config.autopilot);
      expect(global.value).not.toHaveProperty("workspaces");
      const runtimes = await measure(readRuntimePolicies(counted(session)));
      expect(runtimes.queries).toBe(1);
      expect(runtimes.value).toEqual(config.agentRuntimes);

      const edit = async (change: (next: GlobalConfig) => void, expectedWrites?: number) => {
        let writes = 0;
        const expected = await Effect.runPromise(
          session.transaction("test.edit", (transaction) =>
            Effect.gen(function* () {
              const current = yield* readHostSharedConfig(transaction);
              const next = structuredClone(current);
              change(next);
              const counted: HostDatabaseSession = {
                ...transaction,
                execute: (run, operation, details) => {
                  writes += 1;
                  return transaction.execute(run, operation, details);
                },
              };
              const expected = structuredClone(next);
              const changes = yield* applyHostSharedConfigEdits(counted, current, next);
              expect(changes.changed).toBe(writes > 0);
              return expected;
            }),
          ),
        );
        expect(await Effect.runPromise(readHostSharedConfig(session))).toEqual(expected);
        if (expectedWrites !== undefined) expect(writes).toBe(expectedWrites);
        return writes;
      };
      await edit(() => {}, 0);
      await edit((next) => {
        next.git.defaultMergeMethod = "squash";
      }, 1);
      await edit((next) => {
        next.remoteAccess.enabled = !next.remoteAccess.enabled;
      }, 1);
      await edit((next) => {
        next.remoteAccess.configuration!.listenPort = 9001;
      }, 2);
      await edit((next) => {
        next.workspaces.one!.workspaceName = "Renamed";
        next.workspaces.one!.closed = false;
      }, 1);
      await edit((next) => {
        next.workspaces.one!.hooks.postComplete = [
          "echo third",
          "echo first",
          "echo third",
          "echo fourth",
        ];
      }, 2);
      await edit((next) => {
        next.workspaces.one!.actions = {
          items: [{ ...next.workspaces.one!.actions.items[0]!, id: "test", command: "bun test" }],
          defaultActionId: "test",
        };
      }, 4);
      expect(
        await edit((next) => {
          next.workspaces.one!.worktreeCopyPaths = Array.from(
            { length: 350 },
            (_, index) => `file-${index % 7}`,
          );
        }),
      ).toBeLessThanOrEqual(5);
      await edit((next) => {
        next.workspaces.one!.git.provider = {
          id: "azure_devops",
          enabled: true,
          autoDetected: false,
          repository: {
            providerId: "azure_devops",
            deployment: "services",
            serviceUrl: "https://dev.azure.com",
            organization: "org",
            project: "project",
            name: "repo",
          },
        };
      }, 3);
      await edit((next) => {
        delete next.workspaces.one!.git.provider;
        delete next.workspaces.one!.defaultModel;
        next.workspaces.one!.agentDefaults = {};
      }, 3);
      await edit((next) => {
        next.customAgentRoles = Array.from({ length: 4 }, (_, index) => ({
          id: `custom-${index}`,
          name: `Custom ${index}`,
          systemPrompt: `Prompt ${index}`,
        }));
      }, 2);
      await edit((next) => {
        next.customAgentRoles.reverse();
      }, 2);
      await edit((next) => {
        next.autopilot.rules.push({
          workflowId: "custom",
          eventId: "done",
          actionIds: ["qa", "review", "ship"],
        });
      }, 2);
      await edit((next) => {
        next.autopilot.rules.find((rule) => rule.eventId === "done")!.actionIds = ["ship", "qa"];
      }, 2);
      await edit((next) => {
        next.agentRuntimes.opencode.defaults.rules = Array.from({ length: 350 }, (_, index) => ({
          permission: "bash",
          pattern: `command-${index}`,
          action: "ask",
        }));
      }, 1);
      await Effect.runPromise(
        session.transaction("test.update", (transaction) =>
          Effect.gen(function* () {
            const current = yield* readHostSharedConfig(transaction);
            const next = structuredClone(current);
            delete next.workspaces.one;
            yield* applyHostSharedConfigEdits(transaction, current, next);
          }),
        ),
      );
      expect(
        Object.keys((await Effect.runPromise(readHostSharedConfig(session))).workspaces),
      ).toEqual(["two"]);
    });
  });

  test("rejects incomplete and invalid persisted runtime policies", async () => {
    await withDatabase(async ({ session }) => {
      const config = createDefaultGlobalConfig();
      await Effect.runPromise(
        session.transaction("test.import", (transaction) =>
          importHostSharedConfig(transaction, config),
        ),
      );
      const writePolicy = (runtimeKind: string, policyJson: string | null) =>
        session.execute(
          (db) =>
            db
              .update(agentRuntimeSettings)
              .set({ policyJson })
              .where(eq(agentRuntimeSettings.runtimeKind, runtimeKind)),
          "test.corruptPolicy",
        );
      // The read schemas, not SQL, require a policy for each known runtime.
      await Effect.runPromise(writePolicy("codex", null));
      const missing = await Effect.runPromise(readHostSharedConfig(session).pipe(Effect.result));
      expect(missing._tag).toBe("Failure");
      if (missing._tag === "Failure") expect(missing.failure.message).toContain("codex");
      await Effect.runPromise(
        writePolicy(
          "codex",
          JSON.stringify({
            defaults: config.agentRuntimes.codex.defaults,
            roleOverrides: config.agentRuntimes.codex.roleOverrides,
          }),
        ),
      );
      for (const policyJson of [
        "{invalid JSON",
        JSON.stringify({ defaults: {} }),
        JSON.stringify({ roleOverrides: {} }),
      ]) {
        const result = await Effect.runPromise(
          writePolicy("codex", policyJson).pipe(Effect.result),
        );
        expect(result._tag).toBe("Failure");
      }
      const { commandNetworkAccess: _network, ...incomplete } = config.agentRuntimes.codex.defaults;
      for (const [runtimeKind, policy] of [
        ["codex", { defaults: incomplete, roleOverrides: {} }],
        [
          "codex",
          {
            defaults: { ...config.agentRuntimes.codex.defaults, approvalPolicy: "invalid" },
            roleOverrides: {},
          },
        ],
        ["opencode", { defaults: {}, roleOverrides: {} }],
        ["opencode", { defaults: { rules: [] }, roleOverrides: { build: {} } }],
      ] as const) {
        await Effect.runPromise(writePolicy(runtimeKind, JSON.stringify(policy)));
        const result = await Effect.runPromise(readHostSharedConfig(session).pipe(Effect.result));
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure._tag).toBe("HostValidationError");
          expect(result.failure.message).toContain(runtimeKind);
          expect(result.failure.message).toContain("Restore a valid database");
        }
        const saved = config.agentRuntimes[runtimeKind];
        await Effect.runPromise(
          writePolicy(
            runtimeKind,
            JSON.stringify({ defaults: saved.defaults, roleOverrides: saved.roleOverrides }),
          ),
        );
      }
      await Effect.runPromise(
        session.execute(
          (db) =>
            db.delete(agentRuntimeSettings).where(eq(agentRuntimeSettings.runtimeKind, "claude")),
          "test.removeRuntime",
        ),
      );
      const result = await Effect.runPromise(readHostSharedConfig(session).pipe(Effect.result));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("HostValidationError");
        expect(result.failure.message).toContain("claude");
        expect(result.failure.message).toContain("Restore a valid database");
      }
    });
  });

  test("reports malformed Azure mappings with workspace identity", async () => {
    await withDatabase(async ({ session }) => {
      const config = createDefaultGlobalConfig();
      config.workspaces.other = repoConfigFixture({
        workspaceId: "other",
        workspaceName: "Other",
        repoPath: "/other",
      });
      config.workspaces.azure = repoConfigFixture({
        workspaceId: "azure",
        workspaceName: "Azure",
        repoPath: "/azure",
        git: {
          provider: {
            id: "azure_devops",
            repository: {
              providerId: "azure_devops",
              deployment: "services",
              serviceUrl: "https://dev.azure.com",
              organization: "org",
              project: "project",
              name: "repo",
            },
          },
        },
      });
      await Effect.runPromise(
        session.transaction("test.import", (transaction) =>
          importHostSharedConfig(transaction, config),
        ),
      );
      await Effect.runPromise(
        session.execute(
          (db) =>
            db
              .update(workspaceAzureConfig)
              .set({ remoteMappingsJson: '[{"remoteName":"origin"}]' })
              .where(eq(workspaceAzureConfig.workspaceId, "azure")),
          "test.corrupt",
        ),
      );
      await Effect.runPromise(
        session.execute(
          (db) =>
            db
              .insert(hostMetadata)
              .values({ singletonId: 1, importComplete: true, catalogRevision: 1 }),
          "test.metadata",
        ),
      );
      const settings = createSqliteSharedSettingsDatabase({
        withHostDatabase: (_operation, use) => use(session),
      });
      expect(
        (await Effect.runPromise(settings.readWorkspaceCatalogSnapshot())).workspaces
          .map((workspace) => workspace.workspaceId)
          .sort(),
      ).toEqual(["azure", "other"]);
      expect(await Effect.runPromise(settings.readGlobalConfig())).not.toBeNull();
      expect((await Effect.runPromise(settings.readRepoConfig("other")))?.workspaceId).toBe(
        "other",
      );
      const result = await Effect.runPromise(readHostSharedConfig(session).pipe(Effect.result));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.message).toContain("workspace azure");
    });
  });

  test("saves a GitLab project and account link, and checks the link", async () => {
    await withDatabase(async ({ session }) => {
      const accounts = createSqliteGitlabAccountStore({
        withHostDatabase: (_operation, use) => use(session),
      });
      const account = await Effect.runPromise(
        accounts.upsert(
          {
            instanceUrl: "https://code.corp/gitlab",
            userId: 7,
            username: "alice",
            displayName: "Alice",
            authKind: "token",
            tokenExpiresAt: null,
          },
          "4b0b1d5a-1c49-4f43-9f7b-5f1d2d4f0c11",
        ),
      );
      const gitlabWorkspace = (accountId: string, instanceUrl = "https://code.corp/gitlab") =>
        repoConfigSchema.parse({
          workspaceId: "gitlab",
          workspaceName: "GitLab",
          repoPath: "/gitlab",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {
            provider: {
              id: "gitlab",
              enabled: true,
              repository: { providerId: "gitlab", instanceUrl, projectPath: "group/sub/app" },
              settings: { accountId, remoteName: "work" },
            },
          },
        });
      const config = createDefaultGlobalConfig();
      config.workspaces.gitlab = gitlabWorkspace(account.accountId);
      await Effect.runPromise(
        session.transaction("test.import", (transaction) =>
          importHostSharedConfig(transaction, config),
        ),
      );
      const stored = await Effect.runPromise(readHostSharedConfig(session));
      expect(stored.workspaces.gitlab?.git.provider).toEqual(config.workspaces.gitlab.git.provider);
      expect(await Effect.runPromise(accounts.listUnreferenced())).toEqual([]);
      expect(await Effect.runPromise(accounts.listKnownInstances())).toEqual([
        "https://code.corp/gitlab",
      ]);

      // The link blocks the account delete.
      const blocked = await Effect.runPromise(Effect.result(accounts.delete(account.accountId)));
      expect(blocked._tag).toBe("Failure");

      const current = await Effect.runPromise(readHostSharedConfig(session));
      const next = structuredClone(current);
      next.workspaces.gitlab = gitlabWorkspace(account.accountId, "https://gitlab.com");
      const otherInstance = await Effect.runPromise(
        Effect.result(
          session.transaction("test.otherInstance", (transaction) =>
            applyHostSharedConfigEdits(transaction, current, next),
          ),
        ),
      );
      expect(otherInstance._tag === "Failure" && otherInstance.failure.message).toContain(
        "another GitLab instance",
      );
    });
  });
});

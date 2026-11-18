import {
  type AgentModelFavorite,
  type AgentRuntimeCatalog,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  type HostRuntimeStatus,
  OPENCODE_RUNTIME_DESCRIPTOR,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
  type SettingsSnapshot,
  settingsSnapshotSchema,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { CATALOGS } from "@openducktor/product-scenes/sample/models";
import { runtimeIdOf } from "./demo-sessions";
import { DEMO_DONE_VISIBLE_DAYS } from "./demo-tasks";
import {
  DEMO_HOST_INSTANCE_ID,
  type DemoWorld,
  findWorkspace,
  findWorkspaceByRepo,
} from "./demo-world";

const RUNTIME_KINDS: RuntimeKind[] = ["opencode", "codex", "claude"];
const RUNTIME_DESCRIPTORS = {
  opencode: OPENCODE_RUNTIME_DESCRIPTOR,
  codex: CODEX_RUNTIME_DESCRIPTOR,
  claude: CLAUDE_RUNTIME_DESCRIPTOR,
} as const;

/** The ID of a provider of the fictional catalogs, such as `kestrel-ai`. */
const providerIdOf = (provider: string): string =>
  provider.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The fictional model catalog of a runtime, from the Fieldnotes story. */
const modelCatalog = (runtimeKind: RuntimeKind): AgentRuntimeCatalog => {
  const models = CATALOGS[runtimeKind].map((model) => ({
    id: `${providerIdOf(model.provider)}/${model.id}`,
    providerId: providerIdOf(model.provider),
    providerName: model.provider,
    modelId: model.id,
    modelName: model.name,
    variants: runtimeKind === "opencode" ? ["low", "high"] : ["low", "medium", "high"],
    contextWindow:
      model.context === "1M" ? 1_000_000 : model.context === "400K" ? 400_000 : 200_000,
    attachmentSupport: {
      image: model.capabilities.includes("image"),
      audio: false,
      video: false,
      pdf: model.capabilities.includes("pdf"),
    },
  }));
  const defaults: Record<string, string> = {};
  for (const model of models) defaults[model.providerId] ??= model.modelId;
  return {
    runtime: RUNTIME_DESCRIPTORS[runtimeKind],
    models: {
      status: "available",
      catalog: {
        runtime: RUNTIME_DESCRIPTORS[runtimeKind],
        models,
        defaultModelsByProvider: defaults,
        profiles:
          runtimeKind === "opencode"
            ? [
                { id: "build", label: "build", mode: "primary" },
                { id: "plan", label: "plan", mode: "primary" },
              ]
            : [],
      },
    },
    slashCommands: {
      status: "available",
      catalog: {
        commands: [
          {
            id: "review",
            trigger: "review",
            title: "review",
            description: "Review the current changes",
            source: "command",
            hints: [],
          },
        ],
      },
    },
    skills: {
      status: "available",
      catalog: {
        skills: [
          {
            id: "release-notes",
            name: "release-notes",
            path: "/Users/sam/code/fieldnotes/.agents/skills/release-notes/SKILL.md",
            title: "Release notes",
          },
        ],
      },
    },
    subagents: {
      status: "available",
      catalog: { subagents: [{ id: "reviewer", name: "reviewer", label: "Reviewer" }] },
    },
  };
};

/** The workspace, settings, runtime, diagnostics, Git, and file reads of the demo. */
export const createDemoWorkspaceHandlers = (world: DemoWorld) => {
  const { clock } = world;
  const startedAt = clock.agoIso(3 * 3_600_000);
  let favorites: AgentModelFavorite[] = [
    { runtimeKind: "opencode", providerId: "vega", modelId: "vega-2-pro" },
    { runtimeKind: "claude", providerId: "claude", modelId: "claude-lyra-3" },
  ];

  const settings = (): SettingsSnapshot =>
    settingsSnapshotSchema.parse({
      theme: "system",
      agentRuntimes: Object.fromEntries(
        RUNTIME_KINDS.map((kind) => [
          kind,
          { enabled: true, executablePath: `/usr/local/bin/${kind}` },
        ]),
      ),
      agentModelFavorites: favorites,
      customAgentRoles: world.customRoles,
      kanban: { doneVisibleDays: DEMO_DONE_VISIBLE_DAYS },
    });

  const runtimeStatus = (kind: RuntimeKind): HostRuntimeStatus => ({
    kind,
    enabled: true,
    configuredExecutablePath: `/usr/local/bin/${kind}`,
    effectiveExecutablePath: `/usr/local/bin/${kind}`,
    version: kind === "opencode" ? "1.4.0" : kind === "codex" ? "0.48.0" : "2.3.0",
    state: "ready",
    trigger: "host_startup",
    runtimeId: runtimeIdOf(kind),
    startedAt,
    updatedAt: startedAt,
    failure: null,
    revision: 1,
  });

  const workspaces = () => [...world.workspaces.values()].map((workspace) => workspace.record);

  const checkoutOf = (repoPath: string, workingDir?: string) => {
    const workspace = findWorkspaceByRepo(world, repoPath);
    return { workspace, checkout: workspace.repository.checkout(workingDir ?? repoPath) };
  };

  return {
    runtimeDefinitionsList: async () => Object.values(RUNTIME_DESCRIPTORS_BY_KIND),
    runtimeStatus: async () => ({
      hostInstanceId: DEMO_HOST_INSTANCE_ID,
      runtimes: RUNTIME_KINDS.map(runtimeStatus),
      mcpBridge: {
        state: "ready",
        hostUrl: "http://127.0.0.1:14328",
        failure: null,
        updatedAt: startedAt,
        revision: 1,
      },
    }),
    workspaceGetSettingsSnapshot: async () => settings(),
    workspaceUpdateAgentModelFavorites: async (next) => {
      favorites = [...next];
      return favorites;
    },
    workspaceList: async () => workspaces(),
    workspaceCatalogGet: async () => ({
      catalogRevision: 1,
      openWorkspaces: workspaces(),
      closedWorkspaces: [],
      incompleteRemovals: [],
    }),
    workspaceGetRepoConfig: async (workspaceId) => findWorkspace(world, workspaceId).repoConfig,
    customAgentRoleList: async () => world.customRoles,
    systemGetPlatform: async () => "darwin",
    systemListOpenInTools: async () => [],
    agentRuntimeLoadCatalog: async (input) => modelCatalog(input.runtimeKind),
    // Generate goal is the only text generation. The scripted goal names the task of the prompt.
    agentRuntimeGenerateText: async ({ prompt }) => {
      const title = /^# Task [^:]+: (.+)$/m.exec(prompt)?.[1];
      if (!title) throw new Error("The demo cannot write a goal without a task. Write the goal.");
      return {
        text: `Finish "${title}" so that it meets its specification. Add tests for the new behavior, keep all tests passing, and complete this workflow step.`,
      };
    },
    agentRuntimeSearchFiles: async (input) => {
      const { workspace, checkout } = checkoutOf(input.repoPath, input.workingDirectory);
      const query = input.query.trim().toLowerCase();
      return workspace.repository
        .paths(checkout)
        .filter((path) => path.toLowerCase().includes(query))
        .slice(0, 20)
        .map((path) => ({
          id: path,
          path,
          name: path.split("/").at(-1) ?? path,
          kind: /\.(png|jpe?g|gif|webp|svg)$/.test(path)
            ? ("image" as const)
            : path.endsWith(".css")
              ? ("css" as const)
              : ("code" as const),
        }));
    },
    workspaceStageLocalAttachment: async (input) => {
      const path = `/Users/sam/.openducktor/attachments/demo-${world.nextNumber()}-${input.name}`;
      world.resources.set(path, {
        mime: input.mime ?? "application/octet-stream",
        base64: input.base64Data,
      });
      return { path };
    },
    pathCheck: async () => ({ ok: true, error: null }),
    gitCheck: async () => ({
      ok: true,
      executablePath: "/usr/bin/git",
      version: "git version 2.51.0",
      error: null,
    }),
    taskStoreCheck: async () => ({
      repoStoreHealth: {
        category: "healthy",
        status: "ready",
        isReady: true,
        detail: null,
        databasePath: "/Users/sam/.openducktor/database.sqlite",
      },
      taskStoreOk: true,
      taskStorePath: "/Users/sam/.openducktor/database.sqlite",
      taskStoreError: null,
    }),
    gitGetBranches: async (repoPath) => {
      const workspace = findWorkspaceByRepo(world, repoPath);
      const target = workspace.defaultTargetBranch.branch;
      return [
        { name: target, isCurrent: true, isRemote: false },
        ...workspace.repository.worktrees().map((checkout) => ({
          name: checkout.branch,
          isCurrent: false,
          isRemote: false,
          worktreePath: checkout.workingDirectory,
        })),
        { name: `origin/${target}`, isCurrent: false, isRemote: true },
      ];
    },
    gitGetCurrentBranch: async (repoPath, workingDir) => {
      const { checkout } = checkoutOf(repoPath, workingDir);
      return { name: checkout.branch, detached: false, revision: checkout.revision };
    },
    gitGetComparisonTarget: async (_repoPath, _workingDir, target) => ({
      kind: "available",
      reference:
        target.branch === "@{upstream}"
          ? "refs/remotes/origin/main"
          : target.remote
            ? `refs/remotes/${target.remote}/${target.branch}`
            : `refs/heads/${target.branch}`,
    }),
    gitFetchRemote: async () => ({ outcome: "skipped_no_remote", output: "" }),
    gitGetLocalChanges: async (repoPath, workingDir) => {
      const { workspace, checkout } = checkoutOf(repoPath, workingDir);
      return workspace.repository.localChanges(checkout, clock.now());
    },
    gitGetWorktreeStatus: async (repoPath, targetBranch, _diffScope, workingDir) => {
      const { workspace, checkout } = checkoutOf(repoPath, workingDir);
      return workspace.repository.worktreeStatus(checkout, targetBranch, clock.now());
    },
    filesystemRefreshTree: async (input) => {
      const { workspace, checkout } = checkoutOf(findRepoOf(input.rootPath), input.rootPath);
      return workspace.repository.fileTree(checkout, input.targetBranch ?? null);
    },
    filesystemReadTextFile: async (input) => {
      const { workspace, checkout } = checkoutOf(findRepoOf(input.rootPath), input.rootPath);
      return workspace.repository.readFileResult(checkout, input.relativePath);
    },
  } satisfies Partial<HostClient>;

  /** The repository of a checkout folder. */
  function findRepoOf(rootPath: string): string {
    for (const workspace of world.workspaces.values()) {
      if (workspace.repository.findCheckout(rootPath)) return workspace.record.repoPath;
    }
    throw new Error("This folder is not in a demo repository. Refresh the files.");
  }
};

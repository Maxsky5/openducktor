import { Context, Effect, Layer } from "effect";
import { createLocalAttachmentAdapter } from "../../adapters/attachments/local-attachment-adapter";
import {
  type CodexAppServerTransportRegistry,
  createCodexAppServerTransportRegistry,
} from "../../adapters/codex/codex-app-server-transport-registry";
import { createDevServerProcessAdapter } from "../../adapters/dev-servers/dev-server-process-adapter";
import { createFilesystemAdapter } from "../../adapters/filesystem/filesystem-adapter";
import { createWorktreeFileAdapter } from "../../adapters/filesystem/worktree-file-adapter";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createOpenInToolsAdapter } from "../../adapters/open-in-tools/open-in-tools-adapter";
import type { HostRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { createRuntimeExecutableProbes } from "../../adapters/runtimes/runtime-executable-probes";
import { createRuntimeHealthProbe } from "../../adapters/runtimes/runtime-health-probe";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { createSystemCommandRunner } from "../../adapters/system/system-command-runner";
import {
  createToolDiscoveryAdapter,
  type ToolDiscoveryPathOptions,
} from "../../adapters/system/tool-discovery";
import { createRuntimeConfigInitializer } from "../../application/runtimes/runtime-config-initializer";
import { toHostOperationError } from "../../effect/host-errors";
import { createProcessEnvironment } from "../../infrastructure/process/process-environment";
import { type CodexAppServerPort, CodexAppServerPortTag } from "../../ports/codex-app-server-port";
import type { CodexSessionHistoryPort } from "../../ports/codex-session-history-port";
import {
  type DevServerProcessPort,
  DevServerProcessPortTag,
} from "../../ports/dev-server-process-port";
import { type FilesystemPort, FilesystemPortTag } from "../../ports/filesystem-port";
import { type GitPort, GitPortTag } from "../../ports/git-port";
import {
  type LocalAttachmentPort,
  LocalAttachmentPortTag,
} from "../../ports/local-attachment-port";
import { type OpenInToolsPort, OpenInToolsPortTag } from "../../ports/open-in-tools-port";
import type { RuntimeExecutableProbesByKind } from "../../ports/runtime-executable-probe-port";
import { type RuntimeHealthPort, RuntimeHealthPortTag } from "../../ports/runtime-health-port";
import { type SettingsConfigPort, SettingsConfigPortTag } from "../../ports/settings-config-port";
import { type SystemCommandPort, SystemCommandPortTag } from "../../ports/system-command-port";
import { type TerminalPtyPort, TerminalPtyPortTag } from "../../ports/terminal-pty-port";
import {
  type ToolDiscoveryId,
  type ToolDiscoveryPort,
  ToolDiscoveryPortTag,
} from "../../ports/tool-discovery-port";
import { type WorktreeFilePort, WorktreeFilePortTag } from "../../ports/worktree-file-port";

export type NodeHostDefaultPorts = {
  codexAppServer: CodexAppServerPort & CodexSessionHistoryPort;
  codexTransportRegistry: CodexAppServerTransportRegistry;
  devServerProcesses: DevServerProcessPort;
  filesystem: FilesystemPort;
  git: GitPort;
  localAttachments: LocalAttachmentPort;
  openInTools: OpenInToolsPort;
  processEnv: NodeJS.ProcessEnv;
  runtimeDistribution: HostRuntimeDistribution;
  runtimeExecutableProbes: RuntimeExecutableProbesByKind;
  runtimeHealth: RuntimeHealthPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  terminalPty: TerminalPtyPort;
  worktreeFiles: WorktreeFilePort;
};

type CodexAppServer = CodexAppServerPort & CodexSessionHistoryPort;
type CodexAppServerInput =
  | {
      codexAppServer?: undefined;
      codexAppServerTransportRegistry?: CodexAppServerTransportRegistry;
    }
  | {
      codexAppServer: CodexAppServer & CodexAppServerTransportRegistry;
      codexAppServerTransportRegistry?: undefined;
    }
  | {
      codexAppServer: CodexAppServer;
      codexAppServerTransportRegistry: CodexAppServerTransportRegistry;
    };

export type CreateNodeHostDefaultPortsInput = CodexAppServerInput & {
  runtimeDistribution: HostRuntimeDistribution;
  terminalPty: TerminalPtyPort;
} & Partial<{
    clientVersion: string;
    devServerProcesses: DevServerProcessPort;
    filesystem: FilesystemPort;
    git: GitPort;
    localAttachments: LocalAttachmentPort;
    openInTools: OpenInToolsPort;
    processEnv: NodeJS.ProcessEnv;
    runtimeExecutableProbes: RuntimeExecutableProbesByKind;
    runtimeHealth: RuntimeHealthPort;
    settingsConfig: SettingsConfigPort;
    systemCommands: SystemCommandPort;
    toolDiscovery: ToolDiscoveryPort;
    providedToolPaths: Partial<Record<ToolDiscoveryId, string>>;
    worktreeFiles: WorktreeFilePort;
  }>;

export class NodeHostDefaultPortsTag extends Context.Tag("@openducktor/host/NodeHostDefaultPorts")<
  NodeHostDefaultPortsTag,
  NodeHostDefaultPorts
>() {}

export type NodeHostDefaultPortServices =
  | CodexAppServerPortTag
  | DevServerProcessPortTag
  | FilesystemPortTag
  | GitPortTag
  | LocalAttachmentPortTag
  | NodeHostDefaultPortsTag
  | OpenInToolsPortTag
  | RuntimeHealthPortTag
  | SettingsConfigPortTag
  | SystemCommandPortTag
  | ToolDiscoveryPortTag
  | TerminalPtyPortTag
  | WorktreeFilePortTag;

const makeNodeHostDefaultPorts = (
  input: CreateNodeHostDefaultPortsInput,
): Effect.Effect<NodeHostDefaultPorts> =>
  Effect.sync(() => {
    const processEnv = input.processEnv ?? createProcessEnvironment();
    const systemCommands = input.systemCommands ?? createSystemCommandRunner({ env: processEnv });
    const bundledToolBinDirs =
      input.runtimeDistribution.mode === "artifact" && input.runtimeDistribution.bundledToolBinDirs
        ? input.runtimeDistribution.bundledToolBinDirs
        : undefined;
    const toolDiscoveryOptions: ToolDiscoveryPathOptions = {};
    if (input.providedToolPaths) {
      toolDiscoveryOptions.providedToolPaths = input.providedToolPaths;
    }
    if (bundledToolBinDirs) {
      toolDiscoveryOptions.bundledToolBinDirs = bundledToolBinDirs;
    }
    const toolDiscovery =
      input.toolDiscovery ??
      createToolDiscoveryAdapter({
        env: processEnv,
        options: toolDiscoveryOptions,
        systemCommands,
      });
    const runtimeExecutableProbeInput: Parameters<typeof createRuntimeExecutableProbes>[0] = {
      processEnv,
    };
    if (input.clientVersion) {
      runtimeExecutableProbeInput.clientVersion = input.clientVersion;
    }
    const runtimeExecutableProbes =
      input.runtimeExecutableProbes ?? createRuntimeExecutableProbes(runtimeExecutableProbeInput);
    const runtimeHealth =
      input.runtimeHealth ??
      createRuntimeHealthProbe(systemCommands, toolDiscovery, runtimeExecutableProbes);
    const settingsConfig =
      input.settingsConfig ??
      createSettingsConfigAdapter({
        environment: processEnv,
        initializeConfig: createRuntimeConfigInitializer(toolDiscovery),
      });
    const defaultCodexAppServer = createCodexAppServerTransportRegistry();
    const codexAppServer = input.codexAppServer ?? defaultCodexAppServer;
    const codexTransportRegistry =
      input.codexAppServerTransportRegistry ?? input.codexAppServer ?? defaultCodexAppServer;

    return {
      codexAppServer,
      codexTransportRegistry,
      devServerProcesses: input.devServerProcesses ?? createDevServerProcessAdapter({ processEnv }),
      filesystem: input.filesystem ?? createFilesystemAdapter(),
      git:
        input.git ??
        createGitCliAdapter({
          processEnv,
          resolveCommand: () =>
            toolDiscovery.resolveToolPath("git").pipe(
              Effect.mapError((cause) =>
                toHostOperationError(cause, "git.resolveCommand", {
                  toolId: "git",
                }),
              ),
            ),
        }),
      localAttachments: input.localAttachments ?? createLocalAttachmentAdapter(),
      openInTools: input.openInTools ?? createOpenInToolsAdapter({ processEnv, systemCommands }),
      processEnv,
      runtimeDistribution: input.runtimeDistribution,
      runtimeExecutableProbes,
      runtimeHealth,
      settingsConfig,
      systemCommands,
      toolDiscovery,
      terminalPty: input.terminalPty,
      worktreeFiles: input.worktreeFiles ?? createWorktreeFileAdapter(),
    };
  });

const makeNodeHostDefaultPortContext = (
  input: CreateNodeHostDefaultPortsInput,
): Effect.Effect<Context.Context<NodeHostDefaultPortServices>> =>
  makeNodeHostDefaultPorts(input).pipe(
    Effect.map((ports) =>
      Context.empty().pipe(
        Context.add(NodeHostDefaultPortsTag, ports),
        Context.add(CodexAppServerPortTag, ports.codexAppServer),
        Context.add(DevServerProcessPortTag, ports.devServerProcesses),
        Context.add(FilesystemPortTag, ports.filesystem),
        Context.add(GitPortTag, ports.git),
        Context.add(LocalAttachmentPortTag, ports.localAttachments),
        Context.add(OpenInToolsPortTag, ports.openInTools),
        Context.add(RuntimeHealthPortTag, ports.runtimeHealth),
        Context.add(SettingsConfigPortTag, ports.settingsConfig),
        Context.add(SystemCommandPortTag, ports.systemCommands),
        Context.add(ToolDiscoveryPortTag, ports.toolDiscovery),
        Context.add(TerminalPtyPortTag, ports.terminalPty),
        Context.add(WorktreeFilePortTag, ports.worktreeFiles),
      ),
    ),
  );

const createNodeHostDefaultPortsLayer = (
  input: CreateNodeHostDefaultPortsInput,
): Layer.Layer<NodeHostDefaultPortServices> =>
  Layer.effectContext(makeNodeHostDefaultPortContext(input));

const createNodeHostDefaultPortsEffect: Effect.Effect<
  NodeHostDefaultPorts,
  never,
  NodeHostDefaultPortsTag
> = Effect.gen(function* () {
  return yield* NodeHostDefaultPortsTag;
});

export const createNodeHostDefaultPorts = (
  input: CreateNodeHostDefaultPortsInput,
): NodeHostDefaultPorts =>
  Effect.runSync(
    createNodeHostDefaultPortsEffect.pipe(Effect.provide(createNodeHostDefaultPortsLayer(input))),
  );

import { createGeneratedImageFileAdapter } from "../../adapters/attachments/generated-image-file-adapter";
import type { GeneratedImageWorkers } from "../../adapters/attachments/generated-image-worker-client";
import { type GeneratedImageFilePort } from "../../ports/generated-image-file-port";
import { Effect } from "effect";
import { createLocalAttachmentAdapter } from "../../adapters/attachments/local-attachment-adapter";
import { createPlaywrightBrowserAutomation } from "../../adapters/browser/playwright/playwright-browser-automation";
import type { BrowserAutomationPort } from "../../ports/browser-automation-port";
import type { BrowserEngineError, BrowserEnginePort } from "../../ports/browser-engine-port";
import {
  type CodexAppServerTransportRegistry,
  createCodexAppServerTransportRegistry,
} from "../../adapters/codex/codex-app-server-transport-registry";
import { createFilesystemAdapter } from "../../adapters/filesystem/filesystem-adapter";
import { createWorktreeFileAdapter } from "../../adapters/filesystem/worktree-file-adapter";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createOpenInToolsAdapter } from "../../adapters/open-in-tools/open-in-tools-adapter";
import type { HostRuntimeDistribution } from "../../adapters/runtimes/runtime-distribution";
import { createRuntimeExecutableProbes } from "../../adapters/runtimes/runtime-executable-probes";
import { createRuntimeHealthProbe } from "../../adapters/runtimes/runtime-health-probe";
import { createSystemCommandRunner } from "../../adapters/system/system-command-runner";
import {
  createToolDiscoveryAdapter,
  type ToolDiscoveryPathOptions,
} from "../../adapters/system/tool-discovery";
import {
  type OpenDucktorConfigDir,
  type OpenDucktorConfigDirScope,
  resolveOpenDucktorBaseDir,
} from "../../config/openducktor-config-dir";
import { toHostOperationError } from "../../effect/host-errors";
import {
  type CreateProcessEnvironmentInput,
  createProcessEnvironment,
} from "../../infrastructure/process/process-environment";
import { createUserEnvironment } from "../../infrastructure/process/user-environment";
import { type CodexAppServerPort } from "../../ports/codex-app-server-port";
import type { CodexSessionHistoryPort } from "../../ports/codex-session-history-port";
import { type FilesystemPort } from "../../ports/filesystem-port";
import { type GitPort } from "../../ports/git-port";
import { type LocalAttachmentPort } from "../../ports/local-attachment-port";
import { type OpenInToolsPort } from "../../ports/open-in-tools-port";
import type { RuntimeExecutableProbesByKind } from "../../ports/runtime-executable-probe-port";
import { type RuntimeHealthPort } from "../../ports/runtime-health-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { type SystemCommandPort } from "../../ports/system-command-port";
import { type TerminalPtyPort } from "../../ports/terminal-pty-port";
import { type ToolDiscoveryId, type ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type {
  UserEnvironmentPort,
  UserEnvironmentResolution,
} from "../../ports/user-environment-port";
import { type WorktreeFilePort } from "../../ports/worktree-file-port";

export type NodeHostDefaultPorts = {
  imageWorkers: GeneratedImageWorkers;
  codexAppServer: CodexAppServerPort & CodexSessionHistoryPort;
  codexTransportRegistry: CodexAppServerTransportRegistry;
  filesystem: FilesystemPort;
  git: GitPort;
  generatedImageFiles: GeneratedImageFilePort;
  localAttachments: LocalAttachmentPort;
  openInTools: OpenInToolsPort;
  configDir: OpenDucktorConfigDir;
  runtimeDistribution: HostRuntimeDistribution;
  runtimeExecutableProbes: RuntimeExecutableProbesByKind;
  runtimeHealth: RuntimeHealthPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  toolDiscovery: ToolDiscoveryPort;
  terminalPty: TerminalPtyPort;
  browserEngine: BrowserEnginePort;
  browserAutomation: BrowserAutomationPort;
  userEnvironment: UserEnvironmentPort;
  /** Reads the current environment. Call it when a child process starts. */
  readEnv: () => NodeJS.ProcessEnv;
  /** The environment at host startup. Use it only for values that do not depend on `PATH`. */
  startupEnv: NodeJS.ProcessEnv;
  worktreeFiles: WorktreeFilePort;
};

export type NodeHostBootstrapPorts = Omit<NodeHostDefaultPorts, "settingsConfig">;

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

type BrowserEngineFactory = (input: {
  configRoot: string;
}) => Effect.Effect<BrowserEnginePort, BrowserEngineError>;

export type CreateNodeHostDefaultPortsInput = CodexAppServerInput & {
  configDirScope: OpenDucktorConfigDirScope;
  runtimeDistribution: HostRuntimeDistribution;
  terminalPty: TerminalPtyPort;
  /** Creates the browser engine of the shell. It gets the config root for its browser data. */
  browserEngine: BrowserEngineFactory;
} & Partial<{
    clientVersion: string;
    filesystem: FilesystemPort;
    git: GitPort;
    generatedImageFiles: GeneratedImageFilePort;
    localAttachments: LocalAttachmentPort;
    openInTools: OpenInToolsPort;
    processEnv: NodeJS.ProcessEnv;
    processEnvironmentInput: CreateProcessEnvironmentInput;
    runtimeExecutableProbes: RuntimeExecutableProbesByKind;
    runtimeHealth: RuntimeHealthPort;
    systemCommands: SystemCommandPort;
    toolDiscovery: ToolDiscoveryPort;
    providedToolPaths: Partial<Record<ToolDiscoveryId, string>>;
    worktreeFiles: WorktreeFilePort;
  }>;

export const createNodeHostDefaultPorts = (
  input: CreateNodeHostDefaultPortsInput,
  imageWorkers: GeneratedImageWorkers,
) =>
  Effect.gen(function* () {
    const resolveEnvironment: Effect.Effect<UserEnvironmentResolution> = input.processEnv
      ? Effect.succeed({ environment: input.processEnv, error: null })
      : // Each run reads the login shell and builds a new environment.
        Effect.suspend(() => createProcessEnvironment(input.processEnvironmentInput));
    const startupEnvironment = yield* resolveEnvironment;
    const ports = yield* Effect.try({
      try: () => {
        const configDir: OpenDucktorConfigDir = {
          root: resolveOpenDucktorBaseDir(input.configDirScope, startupEnvironment.environment),
          scope: input.configDirScope,
        };
        const withConfigDir = (
          resolution: UserEnvironmentResolution,
        ): UserEnvironmentResolution => ({
          ...resolution,
          environment: { ...resolution.environment, OPENDUCKTOR_CONFIG_DIR: configDir.root },
        });
        const userEnvironment = createUserEnvironment(
          withConfigDir(startupEnvironment),
          resolveEnvironment.pipe(Effect.map(withConfigDir)),
        );
        const readEnv = () => userEnvironment.current().environment;
        const startupEnv = readEnv();
        const systemCommands = input.systemCommands ?? createSystemCommandRunner({ readEnv });
        const bundledToolBinDirs =
          input.runtimeDistribution.mode === "artifact" &&
          input.runtimeDistribution.bundledToolBinDirs
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
            readEnv,
            options: toolDiscoveryOptions,
            systemCommands,
          });
        const runtimeExecutableProbeInput: Parameters<typeof createRuntimeExecutableProbes>[0] = {
          readEnv,
        };
        if (input.clientVersion) {
          runtimeExecutableProbeInput.clientVersion = input.clientVersion;
        }
        const runtimeExecutableProbes =
          input.runtimeExecutableProbes ??
          createRuntimeExecutableProbes(runtimeExecutableProbeInput);
        const runtimeHealth =
          input.runtimeHealth ??
          createRuntimeHealthProbe(systemCommands, toolDiscovery, runtimeExecutableProbes);
        const defaultCodexAppServer = createCodexAppServerTransportRegistry();
        const codexAppServer = input.codexAppServer ?? defaultCodexAppServer;
        const codexTransportRegistry =
          input.codexAppServerTransportRegistry ?? input.codexAppServer ?? defaultCodexAppServer;

        return {
          imageWorkers,
          codexAppServer,
          codexTransportRegistry,
          filesystem: input.filesystem ?? createFilesystemAdapter(),
          git:
            input.git ??
            createGitCliAdapter({
              readEnv,
              resolveCommand: () =>
                toolDiscovery.resolveToolPath("git").pipe(
                  Effect.mapError((cause) =>
                    toHostOperationError(cause, "git.resolveCommand", {
                      toolId: "git",
                    }),
                  ),
                ),
            }),
          generatedImageFiles:
            input.generatedImageFiles ?? createGeneratedImageFileAdapter(imageWorkers),
          localAttachments: input.localAttachments ?? createLocalAttachmentAdapter(),
          openInTools: input.openInTools ?? createOpenInToolsAdapter({ systemCommands }),
          configDir,
          runtimeDistribution: input.runtimeDistribution,
          runtimeExecutableProbes,
          runtimeHealth,
          systemCommands,
          toolDiscovery,
          terminalPty: input.terminalPty,
          browserAutomation: createPlaywrightBrowserAutomation(),
          userEnvironment,
          readEnv,
          startupEnv,
          worktreeFiles: input.worktreeFiles ?? createWorktreeFileAdapter(),
        };
      },
      catch: (cause) => cause,
    });
    const browserEngine = yield* input.browserEngine({ configRoot: ports.configDir.root });
    return { ...ports, browserEngine };
  });

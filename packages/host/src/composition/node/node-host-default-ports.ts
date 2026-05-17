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
import { createProcessEnvironment } from "../../adapters/process/process-environment";
import { createRuntimeHealthProbe } from "../../adapters/runtimes/runtime-health-probe";
import { createSettingsConfigAdapter } from "../../adapters/settings/settings-config-adapter";
import { createSystemCommandRunner } from "../../adapters/system/system-command-runner";
import { type CodexAppServerPort, CodexAppServerPortTag } from "../../ports/codex-app-server-port";
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
import { type RuntimeHealthPort, RuntimeHealthPortTag } from "../../ports/runtime-health-port";
import { type SettingsConfigPort, SettingsConfigPortTag } from "../../ports/settings-config-port";
import { type SystemCommandPort, SystemCommandPortTag } from "../../ports/system-command-port";
import { type WorktreeFilePort, WorktreeFilePortTag } from "../../ports/worktree-file-port";

export type NodeHostDefaultPorts = {
  codexAppServer: CodexAppServerPort;
  codexTransportRegistry: CodexAppServerTransportRegistry;
  devServerProcesses: DevServerProcessPort;
  filesystem: FilesystemPort;
  git: GitPort;
  localAttachments: LocalAttachmentPort;
  openInTools: OpenInToolsPort;
  processEnv: NodeJS.ProcessEnv;
  runtimeHealth: RuntimeHealthPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
  worktreeFiles: WorktreeFilePort;
};

export type CreateNodeHostDefaultPortsInput = Partial<{
  codexAppServer: CodexAppServerPort;
  codexAppServerTransportRegistry: CodexAppServerTransportRegistry;
  devServerProcesses: DevServerProcessPort;
  filesystem: FilesystemPort;
  git: GitPort;
  localAttachments: LocalAttachmentPort;
  openInTools: OpenInToolsPort;
  processEnv: NodeJS.ProcessEnv;
  runtimeHealth: RuntimeHealthPort;
  settingsConfig: SettingsConfigPort;
  systemCommands: SystemCommandPort;
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
  | WorktreeFilePortTag;

const isCodexAppServerTransportRegistry = (
  value: CodexAppServerPort,
): value is CodexAppServerPort & CodexAppServerTransportRegistry =>
  "registerTransport" in value &&
  typeof value.registerTransport === "function" &&
  "unregisterTransport" in value &&
  typeof value.unregisterTransport === "function";

const makeNodeHostDefaultPorts = (
  input: CreateNodeHostDefaultPortsInput,
): Effect.Effect<NodeHostDefaultPorts> =>
  Effect.sync(() => {
    const processEnv = input.processEnv ?? createProcessEnvironment();
    const systemCommands = input.systemCommands ?? createSystemCommandRunner({ env: processEnv });
    const runtimeHealth =
      input.runtimeHealth ?? createRuntimeHealthProbe(systemCommands, processEnv);
    const defaultCodexAppServer = createCodexAppServerTransportRegistry();
    const codexAppServer = input.codexAppServer ?? defaultCodexAppServer;
    const codexTransportRegistry =
      input.codexAppServerTransportRegistry ??
      (isCodexAppServerTransportRegistry(codexAppServer) ? codexAppServer : defaultCodexAppServer);

    return {
      codexAppServer,
      codexTransportRegistry,
      devServerProcesses: input.devServerProcesses ?? createDevServerProcessAdapter({ processEnv }),
      filesystem: input.filesystem ?? createFilesystemAdapter(),
      git: input.git ?? createGitCliAdapter({ processEnv }),
      localAttachments: input.localAttachments ?? createLocalAttachmentAdapter(),
      openInTools: input.openInTools ?? createOpenInToolsAdapter(),
      processEnv,
      runtimeHealth,
      settingsConfig: input.settingsConfig ?? createSettingsConfigAdapter(),
      systemCommands,
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
        Context.add(WorktreeFilePortTag, ports.worktreeFiles),
      ),
    ),
  );

export const createNodeHostDefaultPortsLayer = (
  input: CreateNodeHostDefaultPortsInput = {},
): Layer.Layer<NodeHostDefaultPortServices> =>
  Layer.effectContext(makeNodeHostDefaultPortContext(input));

export const createNodeHostDefaultPortsEffect: Effect.Effect<
  NodeHostDefaultPorts,
  never,
  NodeHostDefaultPortsTag
> = Effect.gen(function* () {
  return yield* NodeHostDefaultPortsTag;
});

export const createNodeHostDefaultPorts = (
  input: CreateNodeHostDefaultPortsInput = {},
): NodeHostDefaultPorts =>
  Effect.runSync(
    createNodeHostDefaultPortsEffect.pipe(Effect.provide(createNodeHostDefaultPortsLayer(input))),
  );

import type { RuntimeKind } from "./agent-runtime-schemas";

/**
 * How the managed MCP process of a runtime names the calling session: in the `_meta` of each call
 * under `metaKey`, in its process environment, or as a host-issued caller binding in its
 * environment when the runtime starts the process before the session has an ID.
 */
type RuntimeMcpCaller =
  | { readonly source: "call_meta"; readonly metaKey: string }
  | { readonly source: "process_session" }
  | { readonly source: "process_binding" };

/**
 * The process of a runtime that serves another app. `program` is the program name, or the name in
 * the first argument when the file name is a version. `subcommand` is the first argument after the
 * program, and `option` is an option with its value anywhere in the arguments.
 */
export type RuntimeServerProcess = {
  readonly program: string;
  readonly subcommand?: string;
  readonly option?: readonly [name: string, value: string];
};

/**
 * Runtime facts that only the host and its MCP server read. They stay out of the runtime
 * descriptor, so remote clients do not parse them.
 */
type RuntimeHostTraits = {
  /**
   * When the host pushes a Workspace Session title to the native session: at once, after the
   * first turn, or never, for a runtime that has no rename.
   */
  readonly sessionTitleSync: "immediate" | "after_turn" | "none";
  readonly mcpCaller: RuntimeMcpCaller;
  readonly serverProcess: RuntimeServerProcess;
};

export const RUNTIME_HOST_TRAITS_BY_KIND = {
  opencode: {
    sessionTitleSync: "immediate",
    mcpCaller: { source: "call_meta", metaKey: "ai.opencode/sessionID" },
    serverProcess: { program: "opencode", subcommand: "serve" },
  },
  codex: {
    sessionTitleSync: "after_turn",
    mcpCaller: { source: "call_meta", metaKey: "threadId" },
    serverProcess: { program: "codex", subcommand: "app-server" },
  },
  claude: {
    sessionTitleSync: "after_turn",
    mcpCaller: { source: "process_session" },
    serverProcess: { program: "claude", option: ["--input-format", "stream-json"] },
  },
  antigravity: {
    // ACP has no rename, so a session keeps its native title.
    sessionTitleSync: "none",
    // The MCP process starts before `session/new` returns the session ID.
    mcpCaller: { source: "process_binding" },
    serverProcess: { program: "agy", subcommand: "acp" },
  },
} as const satisfies Record<RuntimeKind, RuntimeHostTraits>;

import type {
  AgentCapabilities,
  CreateElicitationRequest,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk/unstable";
import {
  type AgentToolData,
  agentToolDataSchema,
  ODT_MCP_TOOL_NAMES,
} from "@openducktor/contracts";
import { z } from "zod";

/**
 * Parsers of the Antigravity fields that ACP types as `unknown`: tool input and output, `_meta`
 * extensions, error codes, and the properties of question forms. Antigravity 1.5.14 sends these
 * shapes. A value in another shape reads as absent.
 */

const nonEmptyString = z.string().trim().min(1);

/** The fields of a native tool call or tool call update that these parsers read. */
type NativeToolCall = {
  readonly name?: string | null | undefined;
  readonly rawInput?: ToolCallUpdate["rawInput"];
  readonly rawOutput?: ToolCallUpdate["rawOutput"];
};

export type AntigravityMcpCall = {
  /** True only for a tool of the managed OpenDucktor MCP server of the session. */
  readonly managed: boolean;
  readonly serverName: string;
  readonly toolName: string;
  readonly args: AgentToolData | undefined;
};

const mcpCallInputSchema = z.object({
  ServerName: nonEmptyString,
  ToolName: nonEmptyString,
  Arguments: z.unknown().optional(),
});
const commandInputSchema = z.object({ CommandLine: nonEmptyString });
const commandOutputSchema = z.object({ exit_code: z.number() });

/**
 * The field names that shared tool readers use for Antigravity fields. Antigravity names fields in
 * PascalCase, such as `Path`, so every other field only gets a lowercase first letter.
 */
const SHARED_TOOL_FIELD_NAMES: ReadonlyMap<string, string> = new Map([
  ["CommandLine", "command"],
  ["toolSummary", "description"],
]);

const toSharedToolFieldName = (name: string): string =>
  SHARED_TOOL_FIELD_NAMES.get(name) ?? `${name.charAt(0).toLowerCase()}${name.slice(1)}`;

/**
 * The tool input as tool data, with the field names that shared tool readers use: `command` for a
 * shell command and `path` for a file. An input that is not a JSON object has no tool data.
 */
export const readAntigravityToolInput = (
  toolCall: Pick<NativeToolCall, "rawInput">,
): AgentToolData | undefined => {
  const parsed = agentToolDataSchema.safeParse(toolCall.rawInput);
  if (!parsed.success) return undefined;
  return Object.fromEntries(
    Object.entries(parsed.data).map(([name, value]) => [toSharedToolFieldName(name), value]),
  );
};

const commandOutputTextSchema = z.object({ output: z.string() });
const COMMAND_OUTPUT_MARKER = "\nCommand output:\n";

/**
 * The output of a finished command without the lines that Antigravity puts before it: the start
 * and end times and the exit code, which the tool part shows in other fields. Line ends are LF.
 */
export const readAntigravityCommandOutput = (
  toolCall: Pick<NativeToolCall, "rawOutput">,
): string | null => {
  const parsed = commandOutputTextSchema.safeParse(toolCall.rawOutput);
  if (!parsed.success) return null;
  // The command runs in a terminal, so its lines end with CRLF.
  const output = parsed.data.output.replaceAll("\r\n", "\n");
  const markerIndex = output.indexOf(COMMAND_OUTPUT_MARKER);
  return markerIndex < 0 ? output : output.slice(markerIndex + COMMAND_OUTPUT_MARKER.length);
};

/**
 * The name of the managed OpenDucktor MCP server of each session. It differs from `openducktor`,
 * the name that a user can give a global server, so the two never collide.
 */
export const ANTIGRAVITY_MANAGED_MCP_SERVER_NAME = "openducktor_session";

/**
 * The native tool name of a managed OpenDucktor tool. Antigravity names a tool of an MCP server
 * from `session/new` or `session/load` `mcp_<server>_<tool>`, sometimes with a hex hash after the
 * server name.
 */
const MANAGED_MCP_TOOL_NAME = new RegExp(
  `^mcp_${ANTIGRAVITY_MANAGED_MCP_SERVER_NAME}_(?:[0-9a-f]+_)?(odt_[a-z_]+)$`,
);
const managedToolNames: ReadonlySet<string> = new Set(ODT_MCP_TOOL_NAMES);

/**
 * The server, tool, and arguments of an MCP tool call: a `call_mcp_tool` call of a global server,
 * or a call of a managed OpenDucktor tool. Antigravity adds `toolSummary` to the arguments of a
 * managed tool, so the arguments leave it out. A `call_mcp_tool` call is never managed, even when
 * a global server has the name of the managed server.
 */
export const readAntigravityMcpCall = (
  toolCall: Pick<NativeToolCall, "name" | "rawInput">,
): AntigravityMcpCall | null => {
  if (toolCall.name !== "call_mcp_tool") {
    const toolName = MANAGED_MCP_TOOL_NAME.exec(toolCall.name ?? "")?.[1];
    if (!toolName || !managedToolNames.has(toolName)) return null;
    const args = agentToolDataSchema.safeParse(toolCall.rawInput);
    return {
      managed: true,
      serverName: ANTIGRAVITY_MANAGED_MCP_SERVER_NAME,
      toolName,
      args: args.success
        ? Object.fromEntries(Object.entries(args.data).filter(([name]) => name !== "toolSummary"))
        : undefined,
    };
  }
  const parsed = mcpCallInputSchema.safeParse(toolCall.rawInput);
  if (!parsed.success) return null;
  const args = agentToolDataSchema.safeParse(parsed.data.Arguments);
  return {
    managed: false,
    serverName: parsed.data.ServerName,
    toolName: parsed.data.ToolName,
    args: args.success ? args.data : undefined,
  };
};

/** The command line of a `run_command` call. */
export const readAntigravityCommandLine = (
  toolCall: Pick<NativeToolCall, "rawInput">,
): string | null => {
  const parsed = commandInputSchema.safeParse(toolCall.rawInput);
  return parsed.success ? parsed.data.CommandLine : null;
};

const backgroundCommandSchema = z.object({
  CommandLine: nonEmptyString,
  IsDaemon: z.boolean().optional(),
});

/**
 * The command line of a `run_command` call that can run in the background and hold the work of
 * the session. A daemon, such as a dev server, does not: Antigravity does not wait for it.
 */
export const readAntigravityBackgroundCommand = (
  toolCall: Pick<NativeToolCall, "name" | "rawInput">,
): string | null => {
  if (toolCall.name !== "run_command") return null;
  const parsed = backgroundCommandSchema.safeParse(toolCall.rawInput);
  return parsed.success && parsed.data.IsDaemon !== true ? parsed.data.CommandLine : null;
};

const taskActionSchema = z.object({ Action: nonEmptyString, TaskId: nonEmptyString });

/**
 * The action and the task of a `manage_task` call, such as `status task-3`. The agent checks or
 * stops its background commands with it. The task ID starts with the conversation ID, which the
 * row leaves out.
 */
export const readAntigravityTaskAction = (
  toolCall: Pick<NativeToolCall, "name" | "rawInput">,
): string | null => {
  if (toolCall.name !== "manage_task") return null;
  const parsed = taskActionSchema.safeParse(toolCall.rawInput);
  if (!parsed.success) return null;
  return `${parsed.data.Action} ${parsed.data.TaskId.split("/").at(-1)}`;
};

/** The exit code of a finished command. */
export const readAntigravityExitCode = (
  toolCall: Pick<NativeToolCall, "rawOutput">,
): number | null => {
  const parsed = commandOutputSchema.safeParse(toolCall.rawOutput);
  return parsed.success ? parsed.data.exit_code : null;
};

const systemPromptCapabilitySchema = z.object({
  antigravity: z.object({ systemPrompt: z.object({ append: z.literal(true) }) }),
});

/** True when the agent advertises the system prompt extension of Antigravity. */
export const advertisesAntigravitySystemPrompt = (
  capabilities: AgentCapabilities | undefined,
): boolean => systemPromptCapabilitySchema.safeParse(capabilities?._meta).success;

const requestErrorSchema = z.object({ code: z.number() });

/** The JSON-RPC error code of a failed request. */
export const readAcpErrorCode = (cause: unknown): number | null => {
  const parsed = requestErrorSchema.safeParse(cause);
  return parsed.success ? parsed.data.code : null;
};

const elicitationSessionSchema = z.object({ sessionId: nonEmptyString });

/** The session of a session-scoped `elicitation/create` request. */
export const readElicitationSessionId = (request: CreateElicitationRequest): string | null => {
  const parsed = elicitationSessionSchema.safeParse(request);
  return parsed.success ? parsed.data.sessionId : null;
};

const enumOptionSchema = z.object({ const: nonEmptyString, title: z.string().optional() });
const questionPropertySchema = z.object({
  type: z.string(),
  title: z.string().optional(),
  oneOf: z.array(enumOptionSchema).optional(),
  items: z.object({ anyOf: z.array(enumOptionSchema) }).optional(),
});
const questionFormSchema = z.object({
  mode: z.literal("form"),
  requestedSchema: z.object({ properties: z.record(z.string(), questionPropertySchema) }),
});
export type AntigravityQuestionProperty = z.infer<typeof questionPropertySchema>;

/** The properties of a question form. A request in another mode or shape has none. */
export const readAntigravityQuestionProperties = (
  request: CreateElicitationRequest,
): ReadonlyMap<string, AntigravityQuestionProperty> => {
  const parsed = questionFormSchema.safeParse(request);
  return new Map(parsed.success ? Object.entries(parsed.data.requestedSchema.properties) : []);
};

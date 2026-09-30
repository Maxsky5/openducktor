// Sample data of the MCP tile. The client, the request, and the tasks are fictional.
// Sources: docs/external-mcp.md and the task summary of packages/contracts/src/odt-mcp-schemas.ts.
import { TASKS } from "./tasks";
import { taskId, WORKSPACE } from "./workspace";

/** The server entry of the client config, with the sample workspace as the default workspace. */
export const SERVER_ENTRY = {
  openducktor: {
    command: "bunx",
    args: ["@openducktor/mcp", "--workspace-id", WORKSPACE],
  },
};

/** The request that the visitor types in the MCP client. */
export const PROMPT = "File a bug: moving a note drops its tags.";

/** The task that the client creates. */
export const NEW_TASK = { id: "h4t8", ...TASKS.h4t8 } as const;

/** The odt_create_task arguments. The startup workspace supplies workspaceId. */
export const ARGUMENTS = {
  title: NEW_TASK.title,
  issueType: NEW_TASK.kind,
  priority: NEW_TASK.priority,
  labels: ["tags"],
};

/** The first fields of the task summary in the result, in the order of the host. */
export const RESULT = {
  task: {
    id: taskId(NEW_TASK.id),
    title: NEW_TASK.title,
  },
};

/** The JSON values of the sample data. */
export type Json = string | number | readonly Json[] | { readonly [key: string]: Json };

export type JsonToken = { kind: "key" | "string" | "number" | "punct"; text: string };

/** Compact JSON with a space after each colon and comma, split into tokens for the log colors. */
export function jsonTokens(value: Json): JsonToken[] {
  const text = JSON.stringify(value);
  // A string, with the colon that makes it a key. Then a number, a bracket, or a comma.
  const token = /("(?:[^"\\]|\\.)*")(:?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([[\]{}])|,/y;
  const tokens: JsonToken[] = [];
  while (token.lastIndex < text.length) {
    const match = token.exec(text);
    if (!match) throw new Error(`The MCP log has no format for this JSON: ${text}`);
    const [, string, colon, number, bracket] = match;
    if (string && colon) tokens.push({ kind: "key", text: string }, { kind: "punct", text: ": " });
    else if (string) tokens.push({ kind: "string", text: string });
    else if (number) tokens.push({ kind: "number", text: number });
    else if (bracket) tokens.push({ kind: "punct", text: bracket });
    else tokens.push({ kind: "punct", text: ", " });
  }
  return tokens;
}

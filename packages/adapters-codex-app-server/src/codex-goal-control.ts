import type { AgentSessionGoalCommand } from "@openducktor/core";
import { z } from "zod";
import type { CodexAppServerClient } from "./types";

const jsonRpcErrorSchema = z.object({ message: z.string().min(1) });

/**
 * The reason that Codex gave for a refused request. A JSON-RPC error keeps the native error as
 * its cause, for example "goals feature is disabled".
 */
const codexRefusalReason = (cause: unknown): string => {
  for (let current = cause; current instanceof Error; current = current.cause) {
    if (current.cause instanceof Error) continue;
    const nativeError = jsonRpcErrorSchema.safeParse(current.cause);
    if (nativeError.success) return nativeError.data.message;
  }
  return cause instanceof Error ? cause.message : String(cause);
};

/**
 * Sends one goal action of the user to Codex. A new objective replaces the current goal and
 * starts it. Codex keeps the status of a goal when a request names no status, so set and resume
 * name `active`. `failureNote` adds the consequence of a refusal to its message.
 */
export const runCodexGoalCommand = async (
  client: CodexAppServerClient,
  threadId: string,
  command: AgentSessionGoalCommand,
  { onSent, failureNote = "" }: { onSent?: () => void; failureNote?: string } = {},
): Promise<void> => {
  let request: Promise<unknown>;
  if (command.kind === "clear") {
    request = client.threadGoalClear({ threadId, origin: "user" });
  } else {
    const params: Parameters<CodexAppServerClient["threadGoalSet"]>[0] = {
      threadId,
      origin: "user",
      status: command.kind === "pause" ? "paused" : "active",
    };
    if (command.kind === "set") params.objective = command.objective;
    request = client.threadGoalSet(params);
  }
  onSent?.();
  try {
    await request;
  } catch (cause) {
    throw new Error(
      `Codex could not ${command.kind} the goal${failureNote}: ${codexRefusalReason(cause)}`,
      { cause },
    );
  }
};

/**
 * An interrupt does not pause a Codex goal, and Codex starts a new goal turn when the thread goes
 * idle. Stop pauses the goal first.
 */
export const pauseCodexGoalForStop = (client: CodexAppServerClient, threadId: string) =>
  runCodexGoalCommand(
    client,
    threadId,
    { kind: "pause" },
    {
      failureNote: ", so the session did not stop",
    },
  );

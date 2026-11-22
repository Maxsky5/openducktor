import type { CodexRunningCommand } from "./codex-background-terminals";
import type { CodexAppServerClient } from "./types";

/**
 * The process ID that stops the terminal. A command that waited for an approval has no process ID
 * in its start event, so Codex gives it in the list of the running terminals of the thread.
 */
const terminalProcessId = async (
  client: Pick<CodexAppServerClient, "threadBackgroundTerminalsList">,
  terminal: CodexRunningCommand,
): Promise<string> => {
  if (terminal.processId !== null) return terminal.processId;
  let cursor: string | null = null;
  do {
    const page = await client.threadBackgroundTerminalsList({
      threadId: terminal.threadId,
      cursor,
    });
    const listed = page.data.find((candidate) => candidate.itemId === terminal.itemId);
    if (listed) return listed.processId;
    cursor = page.nextCursor;
  } while (cursor !== null);
  throw new Error(`Codex lists no running terminal for the command '${terminal.command}'.`);
};

/**
 * Stops one background terminal. Codex answers after the process exits, and the terminal leaves
 * the session when Codex reports the command end.
 */
export const stopCodexBackgroundTerminal = async (
  client: Pick<
    CodexAppServerClient,
    "threadBackgroundTerminalsList" | "threadBackgroundTerminalsTerminate"
  >,
  terminal: CodexRunningCommand,
): Promise<void> => {
  let terminated: boolean;
  try {
    const processId = await terminalProcessId(client, terminal);
    ({ terminated } = await client.threadBackgroundTerminalsTerminate({
      threadId: terminal.threadId,
      processId,
    }));
  } catch (error) {
    throw new Error(
      `Codex could not stop the background command '${terminal.command}': ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (terminated) return;
  throw new Error(
    `Codex did not stop the background command '${terminal.command}'. The command still runs.`,
  );
};

/**
 * Stops every background terminal of the threads. `turn/interrupt` keeps background terminals,
 * so Stop session sends this request also for idle threads.
 */
export const cleanCodexBackgroundTerminals = async (
  client: Pick<CodexAppServerClient, "threadBackgroundTerminalsClean">,
  threadIds: readonly string[],
): Promise<void> => {
  for (const threadId of threadIds) {
    try {
      await client.threadBackgroundTerminalsClean({ threadId });
    } catch (error) {
      throw new Error(
        `Codex could not stop the background terminals of session '${threadId}': ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
};

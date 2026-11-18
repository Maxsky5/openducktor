import {
  decodeTerminalProtocolFrame,
  encodeTerminalListSummary,
  encodeTerminalProtocolFrame,
  isTerminalClientMessage,
  TERMINAL_PROTOCOL_VERSION,
  type TerminalActivity,
  type TerminalClientMessage,
  type TerminalContext,
  type TerminalFailure,
  type TerminalListFilter,
  type TerminalListResponse,
  type TerminalServerMessage,
  type TerminalSummary,
} from "@openducktor/contracts";
import type { TerminalBridge } from "@openducktor/frontend-core/terminals/terminal-bridge";
import { type HostClient, HostTerminalClientError } from "@openducktor/host-client";
import type { DemoClock } from "./demo-clock";

/** The first line of every demo terminal. */
export const SIMULATED_TERMINAL_NOTICE = "Simulated terminal. Commands do not run on any computer.";
export const UNKNOWN_COMMAND_TEXT =
  "This command does not run in the demo. Type help to list the demo commands.";

const HOST_INSTANCE_ID = "demo-host";
const ESC = "\u001b";
const DIM = `${ESC}[2m`;
const GREEN = `${ESC}[32m`;
const CYAN = `${ESC}[36m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;

/** One scripted output line. Each part can have a color. */
export type DemoTerminalLine = readonly {
  text: string;
  tone?: "dim" | "bold" | "green" | "cyan" | "green bold" | "cyan bold";
}[];

/** A repository action that a demo terminal can run, with its scripted output. */
export type DemoTerminalAction = {
  name: string;
  command: string;
  output: readonly DemoTerminalLine[];
  /** True for a server that keeps running, such as a dev server. A test run ends. */
  keepsRunning: boolean;
};

/** The facts that the terminal commands read from the demo repository. */
export type DemoTerminalWorld = {
  /** The repository actions of the workspace of this terminal context. */
  findAction(context: TerminalContext, actionId: string): DemoTerminalAction | null;
  /** The lines of `git status` in this working directory. */
  gitStatus(workingDir: string): readonly string[];
  /** The entries of `ls` in this working directory. */
  listFiles(workingDir: string): readonly string[];
};

const TONES = {
  dim: DIM,
  bold: BOLD,
  green: GREEN,
  cyan: CYAN,
  "green bold": `${GREEN}${BOLD}`,
  "cyan bold": `${CYAN}${BOLD}`,
} as const satisfies Record<NonNullable<DemoTerminalLine[number]["tone"]>, string>;

const renderLine = (line: DemoTerminalLine): string =>
  line.map((part) => (part.tone ? `${TONES[part.tone]}${part.text}${RESET}` : part.text)).join("");

const renderLines = (lines: readonly DemoTerminalLine[]): string =>
  lines.map((line) => `${renderLine(line)}\r\n`).join("");

type Terminal = {
  summary: TerminalSummary;
  /** Every output byte since the start. Demo output is small, so all of it stays. */
  output: Uint8Array;
  line: string;
  /** The command that runs now, which the Restart control repeats. */
  running: DemoTerminalAction | null;
};

type Connection = {
  onFrame: (frame: Uint8Array) => void;
  lists: Map<string, TerminalListFilter>;
  attached: Set<string>;
  activity: boolean;
  open: boolean;
};

const contextMatches = (context: TerminalContext, filter: TerminalListFilter): boolean => {
  switch (filter.kind) {
    case "all":
      return true;
    case "unassociated":
      return !("repoPath" in context);
    case "task":
      return (
        "taskId" in context &&
        context.taskId === filter.taskId &&
        context.workspaceId === filter.workspaceId &&
        context.repoPath === filter.repoPath
      );
    case "workspace_session":
      return (
        "kind" in context &&
        context.workspaceId === filter.workspaceId &&
        context.sessionId === filter.sessionId
      );
  }
};

const terminalFailure = (code: TerminalFailure["code"], message: string, terminalId?: string) => {
  const failure: TerminalFailure = { code, message };
  if (terminalId) failure.terminalId = terminalId;
  return new HostTerminalClientError(failure, null);
};

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
};

const shortPath = (workingDir: string): string => {
  const parts = workingDir.split("/").filter(Boolean);
  return parts.at(-1) ?? workingDir;
};

export type DemoTerminals = {
  readonly bridge: TerminalBridge;
  readonly handlers: Pick<
    HostClient,
    | "terminalCreate"
    | "terminalRunAction"
    | "terminalList"
    | "terminalRestart"
    | "terminalClose"
    | "terminalPreparePathInput"
  >;
  /**
   * Starts a host terminal that runs `action` once, such as a worktree setup step. Resolves with
   * its ID and the output lines when the scripted run ends.
   */
  runHostAction(input: {
    action: DemoTerminalAction;
    context: TerminalContext;
    workingDir: string;
    delayMs: number;
  }): { terminalId: string; finished: Promise<readonly string[]> };
  /** Adds a terminal with earlier output, for the sample data. */
  seed(input: {
    label: string;
    context: TerminalContext;
    workingDir: string;
    history: readonly string[];
    createdAt: string;
  }): void;
};

/**
 * Demo terminals: the terminal commands of the host client and the terminal frame protocol, in
 * memory. A fixed set of commands prints scripted output. No command starts a shell.
 */
export const createDemoTerminals = (world: DemoTerminalWorld, clock: DemoClock): DemoTerminals => {
  const terminals = new Map<string, Terminal>();
  const connections = new Set<Connection>();
  const encoder = new TextEncoder();
  let revision = 0;
  let nextId = 1;

  const send = (connection: Connection, message: TerminalServerMessage, payload?: Uint8Array) => {
    const frame = encodeTerminalProtocolFrame({ message, payload: payload ?? new Uint8Array() });
    // The controller awaits each send, so frames go out on a later task, never inside `send`.
    clock.soon(() => {
      if (connection.open) connection.onFrame(frame);
    });
  };

  const listResponse = (filter: TerminalListFilter): TerminalListResponse => ({
    hostInstanceId: HOST_INSTANCE_ID,
    revision,
    terminals: [...terminals.values()]
      .filter((terminal) => contextMatches(terminal.summary.context, filter))
      .map((terminal) => terminal.summary),
  });

  const activityOf = (terminal: Terminal): TerminalActivity | null =>
    terminal.running
      ? { summary: terminal.summary, command: terminal.running.command, restartable: true }
      : null;

  const publishSummary = (terminal: Terminal) => {
    revision += 1;
    for (const connection of connections) {
      for (const [subscriptionId, filter] of connection.lists) {
        if (!contextMatches(terminal.summary.context, filter)) continue;
        send(
          connection,
          { version: TERMINAL_PROTOCOL_VERSION, type: "list_updated", subscriptionId, revision },
          encodeTerminalListSummary(terminal.summary),
        );
      }
    }
  };

  const publishActivity = (terminal: Terminal) => {
    const activity = activityOf(terminal);
    for (const connection of connections) {
      if (!connection.activity) continue;
      send(
        connection,
        activity
          ? { version: TERMINAL_PROTOCOL_VERSION, type: "activity_updated", activity }
          : {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "activity_removed",
              terminalId: terminal.summary.terminalId,
            },
      );
    }
  };

  const write = (terminal: Terminal, text: string) => {
    if (!text) return;
    const bytes = encoder.encode(text);
    const sequenceStart = terminal.output.byteLength;
    terminal.output = concat(terminal.output, bytes);
    for (const connection of connections) {
      if (!connection.attached.has(terminal.summary.terminalId)) continue;
      send(
        connection,
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "output",
          terminalId: terminal.summary.terminalId,
          sequenceStart,
          sequenceEnd: terminal.output.byteLength,
          replay: false,
        },
        bytes,
      );
    }
  };

  const prompt = (terminal: Terminal): string =>
    `${GREEN}demo${RESET}:${CYAN}${shortPath(terminal.summary.initialWorkingDir)}${RESET}$ `;

  const create = (input: {
    label: string;
    context: TerminalContext;
    workingDir: string;
    startedBy: TerminalSummary["startedBy"];
    createdAt?: string;
  }): Terminal => {
    const terminalId = `demo-terminal-${nextId++}`;
    const terminal: Terminal = {
      summary: {
        terminalId,
        label: input.label,
        context: input.context,
        initialWorkingDir: input.workingDir,
        createdAt: input.createdAt ?? clock.nowIso(),
        lifecycle: "running",
        exit: null,
        startedBy: input.startedBy,
      },
      output: new Uint8Array(),
      line: "",
      running: null,
    };
    terminals.set(terminalId, terminal);
    terminal.output = encoder.encode(`${DIM}${SIMULATED_TERMINAL_NOTICE}${RESET}\r\n`);
    publishSummary(terminal);
    return terminal;
  };

  /** Prints the command line and its scripted output, then the prompt when the command ends. */
  const startAction = (terminal: Terminal, action: DemoTerminalAction, delayMs: number) => {
    terminal.running = action;
    publishActivity(terminal);
    write(terminal, `${DIM}$ ${action.command}${RESET}\r\n`);
    return new Promise<readonly string[]>((resolve) => {
      clock.after(delayMs, () => {
        if (terminal.running !== action) return;
        write(terminal, renderLines(action.output));
        const outputTail = action.output.map((line) => line.map((part) => part.text).join(""));
        if (!action.keepsRunning) {
          terminal.running = null;
          publishActivity(terminal);
          write(terminal, prompt(terminal));
        }
        resolve(outputTail);
      });
    });
  };

  const help = [
    "Demo commands:",
    "  help         List the demo commands.",
    "  ls           List the files of this folder.",
    "  pwd          Show this folder.",
    "  git status   Show the changes of this worktree.",
    "  bun test     Run the sample tests.",
    "  clear        Clear the screen.",
  ];

  const runLine = (terminal: Terminal, line: string) => {
    const command = line.trim().replace(/\s+/g, " ");
    const workingDir = terminal.summary.initialWorkingDir;
    let lines: readonly string[] = [];
    switch (command) {
      case "":
        break;
      case "help":
        lines = help;
        break;
      case "ls":
        lines = [world.listFiles(workingDir).join("  ")];
        break;
      case "pwd":
        lines = [workingDir];
        break;
      case "git status":
        lines = world.gitStatus(workingDir);
        break;
      case "bun test":
        lines = [
          "bun test v1.3.0",
          "",
          "src/search/open-search.test.ts:",
          `${GREEN}✓${RESET} opens search with Cmd+K`,
          `${GREEN}✓${RESET} keeps search closed while typing`,
          "",
          renderLine([{ text: " " }, { text: "12 pass", tone: "green" }]),
          " 0 fail",
          "Ran 12 tests across 4 files. [0.41s]",
        ];
        break;
      case "clear":
        write(terminal, `${ESC}[2J${ESC}[H`);
        break;
      default:
        lines = [UNKNOWN_COMMAND_TEXT];
    }
    write(terminal, `${lines.map((text) => `${text}\r\n`).join("")}${prompt(terminal)}`);
  };

  const input = (terminal: Terminal, data: string) => {
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        if (char === "\n" && data.includes("\r")) continue;
        const line = terminal.line;
        terminal.line = "";
        write(terminal, "\r\n");
        if (terminal.running) continue;
        runLine(terminal, line);
      } else if (char === "\u007f" || char === "\b") {
        if (!terminal.line) continue;
        terminal.line = terminal.line.slice(0, -1);
        write(terminal, "\b \b");
      } else if (char === "\u0003") {
        terminal.line = "";
        if (terminal.running) {
          terminal.running = null;
          publishActivity(terminal);
        }
        write(terminal, `^C\r\n${prompt(terminal)}`);
      } else if (char === ESC || char < " ") {
        // Escape sequences, such as arrow keys, have no meaning in the demo line editor.
        return;
      } else {
        terminal.line += char;
        write(terminal, char);
      }
    }
  };

  const attach = (connection: Connection, terminalId: string, lastConsumed: number | null) => {
    const terminal = terminals.get(terminalId);
    if (!terminal) {
      send(connection, {
        version: TERMINAL_PROTOCOL_VERSION,
        type: "terminal_forgotten",
        terminalId,
      });
      return;
    }
    connection.attached.add(terminalId);
    const end = terminal.output.byteLength;
    const start = Math.min(lastConsumed ?? 0, end);
    send(connection, {
      version: TERMINAL_PROTOCOL_VERSION,
      type: "snapshot",
      terminalId,
      earliestRetainedSequence: 0,
      snapshotSequenceEnd: end,
      lifecycle: terminal.summary.lifecycle,
      title: terminal.summary.label,
      complete: true,
    });
    if (end > start) {
      send(
        connection,
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "output",
          terminalId,
          sequenceStart: start,
          sequenceEnd: end,
          replay: true,
        },
        terminal.output.slice(start, end),
      );
    }
  };

  const receive = (connection: Connection, message: TerminalClientMessage, payload: Uint8Array) => {
    switch (message.type) {
      case "observe_list": {
        connection.lists.set(message.subscriptionId, message.filter);
        const list = listResponse(message.filter);
        send(connection, {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "list_snapshot_start",
          subscriptionId: message.subscriptionId,
          hostInstanceId: HOST_INSTANCE_ID,
          revision: list.revision,
        });
        for (const summary of list.terminals) {
          send(
            connection,
            {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "list_updated",
              subscriptionId: message.subscriptionId,
              revision: list.revision,
            },
            encodeTerminalListSummary(summary),
          );
        }
        send(connection, {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "list_snapshot_end",
          subscriptionId: message.subscriptionId,
        });
        return;
      }
      case "unobserve_list":
        connection.lists.delete(message.subscriptionId);
        return;
      case "observe_activity": {
        connection.activity = true;
        send(connection, { version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_start" });
        for (const terminal of terminals.values()) {
          const activity = activityOf(terminal);
          if (activity)
            send(connection, {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "activity_updated",
              activity,
            });
        }
        send(connection, { version: TERMINAL_PROTOCOL_VERSION, type: "activity_snapshot_end" });
        return;
      }
      case "unobserve_activity":
        connection.activity = false;
        return;
      case "attach":
        attach(connection, message.terminalId, message.lastConsumedSequence);
        return;
      case "detach":
        connection.attached.delete(message.terminalId);
        return;
      case "input": {
        const terminal = terminals.get(message.terminalId);
        if (terminal && terminal.summary.startedBy === "user")
          input(terminal, new TextDecoder().decode(payload));
        return;
      }
      case "resize":
      case "ack":
        return;
    }
  };

  const bridge: TerminalBridge = {
    connect: async (onFrame, onStateChange) => {
      const connection: Connection = {
        onFrame,
        lists: new Map(),
        attached: new Set(),
        activity: false,
        open: true,
      };
      connections.add(connection);
      clock.onEnd(() => {
        if (!connection.open) return;
        connection.open = false;
        connections.delete(connection);
        onStateChange("disconnected");
      });
      onStateChange("connected");
      return {
        send: async (frame) => {
          if (!connection.open) return;
          const decoded = decodeTerminalProtocolFrame(frame);
          if (!isTerminalClientMessage(decoded.message))
            throw new Error("A demo terminal accepts only client messages.");
          receive(connection, decoded.message, decoded.payload);
        },
        close: () => {
          connection.open = false;
          connections.delete(connection);
        },
      };
    },
  };

  const find = (terminalId: string): Terminal => {
    const terminal = terminals.get(terminalId);
    if (!terminal)
      throw terminalFailure(
        "terminal_not_found",
        "This terminal is closed. Open a new terminal.",
        terminalId,
      );
    return terminal;
  };

  return {
    bridge,
    handlers: {
      terminalCreate: async ({ workingDir, context }) => {
        const terminal = create({ label: workingDir, context, workingDir, startedBy: "user" });
        terminal.output = concat(terminal.output, encoder.encode(prompt(terminal)));
        return {
          ref: { terminalId: terminal.summary.terminalId },
          summary: terminal.summary,
          list: listResponse({ kind: "all" }),
        };
      },
      terminalRunAction: async ({ workingDir, context, actionId }) => {
        const action = world.findAction(context, actionId);
        if (!action)
          throw terminalFailure(
            "action_not_found",
            "This action is not in the repository settings of the demo.",
          );
        const terminal = create({ label: action.name, context, workingDir, startedBy: "user" });
        void startAction(terminal, action, 900);
        return {
          ref: { terminalId: terminal.summary.terminalId },
          summary: terminal.summary,
          list: listResponse({ kind: "all" }),
        };
      },
      terminalList: async ({ filter }) => listResponse(filter),
      terminalRestart: async ({ terminalId, expectedCommand }) => {
        const terminal = find(terminalId);
        const action = terminal.running;
        if (!action || action.command !== expectedCommand)
          throw terminalFailure(
            "invalid_input",
            "This terminal runs another command now. Read the terminal, then restart again.",
            terminalId,
          );
        terminal.running = null;
        write(terminal, `^C\r\n${prompt(terminal)}`);
        void startAction(terminal, action, 900);
        return { restarted: true };
      },
      terminalClose: async ({ terminalId, confirmTerminate }) => {
        const terminal = find(terminalId);
        if (terminal.running && !confirmTerminate)
          return { closed: false, confirmationRequired: true };
        terminals.delete(terminalId);
        revision += 1;
        for (const connection of connections) {
          connection.attached.delete(terminalId);
          if (connection.activity && terminal.running)
            send(connection, {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "activity_removed",
              terminalId,
            });
          for (const [subscriptionId, filter] of connection.lists) {
            if (!contextMatches(terminal.summary.context, filter)) continue;
            send(connection, {
              version: TERMINAL_PROTOCOL_VERSION,
              type: "list_removed",
              subscriptionId,
              revision,
              terminalId,
            });
          }
        }
        return { closed: true, list: listResponse({ kind: "all" }) };
      },
      terminalPreparePathInput: async ({ paths }) => ({
        text: paths.map((path) => `'${path.replaceAll("'", "'\\''")}'`).join(" "),
      }),
    },
    runHostAction: ({ action, context, workingDir, delayMs }) => {
      const terminal = create({ label: action.name, context, workingDir, startedBy: "host" });
      // A setup step that the end of the demo cuts off fails, so its launch does not wait forever.
      const finished = new Promise<readonly string[]>((resolve, reject) => {
        void startAction(terminal, action, delayMs).then(resolve);
        clock.onEnd(() => reject(new Error("The demo ended. Open the demo again.")));
      });
      return { terminalId: terminal.summary.terminalId, finished };
    },
    seed: ({ label, context, workingDir, history, createdAt }) => {
      const terminal = create({ label, context, workingDir, startedBy: "user", createdAt });
      const text = `${history.map((line) => `${line}\r\n`).join("")}${prompt(terminal)}`;
      terminal.output = concat(terminal.output, encoder.encode(text));
    },
  };
};

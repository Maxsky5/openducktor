import type { Effect } from "effect";
import type {
  HostDependencyErrorAggregate,
  HostOperationErrorAggregate,
} from "../effect/host-errors";

/** One live process. `identity` is unique for the process instance while the system runs. */
export type LiveProcess = {
  pid: number;
  parentPid: number;
  identity: string;
  name: string;
  cwd?: string;
  executable?: string;
  arguments?: string[];
  /** The reason when the system denied a read of the directory, executable, or arguments. */
  issue?: string;
};

export type ProcessInstance = { pid: number; identity: string };

export type InspectedProcess = ProcessInstance & {
  live: boolean;
  /** Absent when the listener read failed. `listenerIssue` gives the reason. */
  listeners?: { address: string; port: number }[];
  listenerIssue?: string;
  canStop: boolean;
};

type ProcessStandardInput = ProcessInstance & {
  live: boolean;
  /**
   * `pipe` for a pipe or a socket, such as the stdio channel of an MCP or language server. Absent
   * when the process has no input or the read failed.
   */
  kind?: "pipe" | "other";
  /** The PID that serves the input pipe, on Windows only. */
  serverPid?: number;
  issue?: string;
};

export type ProcessStopRequest = ProcessInstance & {
  evidenceKind: "cwd" | "executable";
  evidencePath: string;
  timeoutMs: number;
  /** Allows a PID signal on a system without instance-bound signals. */
  allowPidSignal: boolean;
};

export type ProcessStopOutcome = {
  kind:
    | "stopped"
    | "already_exited"
    | "changed"
    | "denied"
    | "failed"
    | "acknowledgment_required"
    | "still_running"
    | "unconfirmed";
  message?: string;
};

/** A child process that the host or a runtime owner started and manages. */
export type ManagedProcess =
  /** An agent runtime. Its own project commands stay visible. */
  | { kind: "runtime" }
  /**
   * A Windows `cmd.exe` that runs a batch launcher of a runtime that the host does not know. The
   * launcher can start the runtime several levels down.
   */
  | { kind: "runtime_launcher" }
  /** Host infrastructure, such as the browser engine. Its descendants are infrastructure too. */
  | { kind: "infrastructure" };

export type ProcessInspectorError = HostDependencyErrorAggregate | HostOperationErrorAggregate;

/** Reads live processes of the host machine and stops one process instance. */
export type ProcessInspectorPort = {
  listProcesses(): Effect.Effect<LiveProcess[], ProcessInspectorError>;
  /** Reads the TCP listeners and stop permission of each instance. */
  inspectProcesses(
    targets: readonly ProcessInstance[],
  ): Effect.Effect<InspectedProcess[], ProcessInspectorError>;
  /** `pid` means stop signals a PID after a final identity check, so PID reuse is possible. */
  stopMode(): Effect.Effect<"instance" | "pid", ProcessInspectorError>;
  stopProcess(
    request: ProcessStopRequest,
  ): Effect.Effect<ProcessStopOutcome, ProcessInspectorError>;
  /** Reads what the standard input of each instance reads from. */
  readStandardInputs(
    targets: readonly ProcessInstance[],
  ): Effect.Effect<ProcessStandardInput[], ProcessInspectorError>;
};

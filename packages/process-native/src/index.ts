import { createRequire } from "node:module";
import path from "node:path";

/** One live process. `identity` is unique for the process instance while the system runs. */
export type NativeProcess = {
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

export type NativeProcessTarget = { pid: number; identity: string };

export type NativeListener = { address: string; port: number };

export type NativeInspection = {
  pid: number;
  identity: string;
  live: boolean;
  /** Absent when the listener read failed. `listenerIssue` gives the reason. */
  listeners?: NativeListener[];
  listenerIssue?: string;
  canStop: boolean;
};

export type NativeStandardInput = {
  pid: number;
  identity: string;
  live: boolean;
  /** `pipe` for a pipe or a socket. Absent when the process has no input or the read failed. */
  kind?: "pipe" | "other";
  /** The PID that serves the input pipe, on Windows only. */
  serverPid?: number;
  issue?: string;
};

export type NativeStopRequest = {
  pid: number;
  identity: string;
  evidenceKind: "cwd" | "executable";
  evidencePath: string;
  timeoutMs: number;
  /** Allows a PID signal on a system without instance-bound signals. */
  allowPidSignal: boolean;
};

export type NativeStopOutcome = {
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

/** The functions of the native module. It omits object fields that have no value. */
export type ProcessNativeModule = {
  listProcesses(): Promise<NativeProcess[]>;
  inspectProcesses(targets: NativeProcessTarget[]): Promise<NativeInspection[]>;
  stopProcess(request: NativeStopRequest): Promise<NativeStopOutcome>;
  /** Reads what the standard input of each instance reads from. */
  readStandardInputs(targets: NativeProcessTarget[]): Promise<NativeStandardInput[]>;
  stopMode(): "instance" | "pid";
  /** Opens a URL with `ShellExecuteExW`. It fails on other systems. */
  openUrl(url: string): Promise<void>;
};

/** The file name of the module for this platform and architecture. */
export const processNativeFileName = (
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string => `process-native.${platform}-${arch}.node`;

/** The directory where `bun run build` writes the module in a workspace checkout. */
export const workspaceProcessNativeDirectory = (): string =>
  path.join(import.meta.dirname, "..", "native");

/** Loads the module from a directory that holds the file of `processNativeFileName`. */
export const loadProcessNative = (directory: string): ProcessNativeModule => {
  const require = createRequire(import.meta.url);
  // SAFETY: The file is the module that `src/lib.rs` builds, and `ProcessNativeModule` lists its exports.
  return require(path.join(directory, processNativeFileName())) as ProcessNativeModule;
};

import type { Effect } from "effect";

export type UserPathErrorReason =
  | "invalid_output"
  | "output_limit"
  | "shell_unavailable"
  | "spawn_failed"
  | "timed_out"
  | "unexpected_exit";

/** Why the host could not read the user PATH from the login shell. */
export type UserPathError = {
  message: string;
  reason: UserPathErrorReason;
  shell: string;
};

/** One resolution of the environment for child processes. */
export type UserEnvironmentResolution = {
  environment: NodeJS.ProcessEnv;
  /** The PATH error, or null when the environment has the user PATH. */
  error: UserPathError | null;
};

/** The latest resolution. Each completed resolution has a new revision. */
export type UserEnvironmentState = UserEnvironmentResolution & {
  revision: number;
};

/**
 * Owns the environment that the host gives to child processes. Read `current()` when a process
 * starts, so a refresh reaches every later process start.
 */
export type UserEnvironmentPort = {
  current(): UserEnvironmentState;
  /** Resolves the environment again. Concurrent calls share one resolution. */
  refresh(): Effect.Effect<void>;
};

import type { ManagedMcpServerResolver } from "@openducktor/core";
import { ODT_MCP_SERVER_NAME } from "@openducktor/contracts";
import type { McpStatus, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { normalizePathForComparison } from "@openducktor/path-support";
import { unwrapData } from "./data-utils";

export type OpencodeMcpBinding = {
  readonly workingDirectory: string;
  readonly repoPath: string;
};

export type OpencodeMcpReconnectEvent = {
  serverName: string;
  workingDirectory: string;
  status: string;
  errorDetails: string | undefined;
};

type EnsureOpencodeMcpBindingInput = {
  client: OpencodeClient;
  workingDirectory: string;
  repoPath: string;
  onReconnectStart?: ((event: OpencodeMcpReconnectEvent) => void) | undefined;
};

/** Binds the OpenDucktor MCP server of one workspace to each OpenCode directory instance. */
export type OpencodeMcpDirectoryBindings = {
  readonly ensure: (input: EnsureOpencodeMcpBindingInput) => Promise<void>;
  /** Forgets a binding after OpenCode disposed the directory instance that held it. */
  readonly forget: (workingDirectory: string) => void;
  readonly clear: () => void;
  readonly list: () => ReadonlyArray<OpencodeMcpBinding>;
};

export const createOpencodeMcpDirectoryBindings = ({
  resolveServerConfig,
}: {
  resolveServerConfig: ManagedMcpServerResolver;
}): OpencodeMcpDirectoryBindings => {
  const bindings = new Map<string, BindingEntry>();
  // Native setup for one directory runs one at a time, so a later binding cannot be
  // overwritten by an earlier `mcp.add` that is still in flight.
  const setupQueues = new Map<string, Promise<void>>();

  /** Fails when disposal or another binding replaced this entry while an await was pending. */
  const requireCurrent = (key: string, entry: BindingEntry): void => {
    if (bindings.get(key) === entry) return;
    throw new Error(
      `ODT workflow tools unavailable for "${entry.workingDirectory}": OpenCode released this directory while its OpenDucktor MCP server was being set up. Retry the operation.`,
    );
  };

  const addServer = async (
    client: OpencodeClient,
    entry: BindingEntry,
    previous: ObservedStatus | null,
  ): Promise<void> => {
    const key = normalizePathForComparison(entry.workingDirectory);
    const config = await resolveServerConfig(entry.repoPath);
    requireCurrent(key, entry);
    const response = await client.mcp.add({
      directory: entry.workingDirectory,
      name: ODT_MCP_SERVER_NAME,
      config: {
        type: "local",
        command: [...config.command],
        environment: { ...config.environment },
        enabled: true,
      },
    });
    const statuses = unwrapData(
      response,
      `add MCP server "${ODT_MCP_SERVER_NAME}" for "${entry.workingDirectory}"`,
    );
    requireCurrent(key, entry);
    const status = describeStatus(statuses[ODT_MCP_SERVER_NAME]);
    if (status.status === "connected") {
      return;
    }
    const previousDetail = previous
      ? ` Status before reconnect was ${formatStatus(previous)}.`
      : "";
    throw new Error(
      `ODT workflow tools unavailable for "${entry.workingDirectory}": OpenCode did not connect MCP server "${ODT_MCP_SERVER_NAME}" for repository "${entry.repoPath}". Status is ${formatStatus(status)}.${previousDetail} Check the OpenDucktor MCP bridge in Diagnostics and retry.`,
    );
  };

  /**
   * Runs `setup` after earlier setup of the same directory. Success marks the entry bound.
   * `removeOnFailure` drops a new entry when its first setup fails.
   */
  const runSetup = (
    key: string,
    entry: BindingEntry,
    setup: () => Promise<void>,
    removeOnFailure: boolean,
  ): Promise<void> => {
    const queued = (setupQueues.get(key) ?? Promise.resolve()).then(setup);
    const settled = queued.then(
      () => undefined,
      () => undefined,
    );
    setupQueues.set(key, settled);
    void settled.then(() => {
      if (setupQueues.get(key) === settled) setupQueues.delete(key);
    });
    const pending = queued.then(
      () => {
        requireCurrent(key, entry);
        entry.bound = true;
      },
      (cause: unknown) => {
        if (removeOnFailure && bindings.get(key) === entry) {
          bindings.delete(key);
        }
        throw cause;
      },
    );
    entry.pending = pending;
    const clearPending = (): void => {
      if (entry.pending === pending) {
        entry.pending = null;
      }
    };
    pending.then(clearPending, clearPending);
    return pending;
  };

  const readStatus = async (
    client: OpencodeClient,
    workingDirectory: string,
  ): Promise<ObservedStatus> => {
    const response = await client.mcp.status({ directory: workingDirectory });
    const statuses = unwrapData(response, `read MCP status for "${workingDirectory}"`);
    return describeStatus(statuses[ODT_MCP_SERVER_NAME]);
  };

  const ensure = async (input: EnsureOpencodeMcpBindingInput): Promise<void> => {
    const key = normalizePathForComparison(input.workingDirectory);
    const existing = bindings.get(key);
    if (!existing) {
      const entry: BindingEntry = {
        workingDirectory: input.workingDirectory,
        repoPath: input.repoPath,
        bound: false,
        pending: null,
      };
      bindings.set(key, entry);
      return runSetup(key, entry, () => addServer(input.client, entry, null), true);
    }
    if (
      normalizePathForComparison(existing.repoPath) !== normalizePathForComparison(input.repoPath)
    ) {
      throw new Error(
        `Cannot use OpenCode directory "${input.workingDirectory}" for repository "${input.repoPath}": its OpenDucktor MCP server is bound to repository "${existing.repoPath}". Open this directory from repository "${existing.repoPath}", or restart OpenCode after its sessions end.`,
      );
    }
    if (existing.pending) {
      return existing.pending;
    }
    const status = await readStatus(input.client, input.workingDirectory);
    // The directory can be released or rebound while the status read is pending. A status of
    // another binding never authorizes this operation.
    if (bindings.get(key) !== existing) {
      return ensure(input);
    }
    if (status.status === "connected") {
      return;
    }
    if (existing.pending) {
      return existing.pending;
    }
    input.onReconnectStart?.({
      serverName: ODT_MCP_SERVER_NAME,
      workingDirectory: input.workingDirectory,
      status: status.status,
      errorDetails: status.errorDetails,
    });
    return runSetup(key, existing, () => addServer(input.client, existing, status), false);
  };

  return {
    ensure,
    forget: (workingDirectory) => {
      bindings.delete(normalizePathForComparison(workingDirectory));
    },
    clear: () => {
      bindings.clear();
    },
    list: () =>
      [...bindings.values()]
        .filter((entry) => entry.bound)
        .map(({ workingDirectory, repoPath }) => ({ workingDirectory, repoPath })),
  };
};

type BindingEntry = OpencodeMcpBinding & {
  bound: boolean;
  pending: Promise<void> | null;
};

type ObservedStatus = {
  status: string;
  errorDetails: string | undefined;
};

const describeStatus = (status: McpStatus | undefined): ObservedStatus => {
  if (!status) {
    return { status: "missing", errorDetails: undefined };
  }
  return {
    status: status.status,
    errorDetails: "error" in status ? status.error : undefined,
  };
};

const formatStatus = ({ status, errorDetails }: ObservedStatus): string =>
  `"${status}"${errorDetails ? ` (${errorDetails})` : ""}`;

import type {
  AgentSessionLiveSnapshot,
  HostRuntimeLifecycleState,
  HostRuntimeStatus,
  RuntimeKind,
} from "@openducktor/contracts";
import type { Effect } from "effect";

/** The saved choice for one runtime kind. */
export type RuntimeSetting = {
  readonly enabled: boolean;
  readonly executablePath: string;
};

export type RuntimeSettings = { readonly [Kind in RuntimeKind]: RuntimeSetting };

/** A configured workspace. Lifecycle reviews group affected sessions by workspace. */
export type RuntimeWorkspace = {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly repoPath: string;
};

/** Reads the saved runtime settings and the configured workspaces. */
export type RuntimeSettingsSource<E> = {
  readRuntimeSettings(): Effect.Effect<RuntimeSettings, E>;
  listWorkspaces(): Effect.Effect<ReadonlyArray<RuntimeWorkspace>, E>;
};

/** Lists the live sessions that a lifecycle action of a kind stops or detaches. */
export type LiveSessionInventory<E> = {
  listAffectedSessions(
    runtimeKind: RuntimeKind,
  ): Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, E>;
};

export type RuntimeStatusChange = {
  readonly status: HostRuntimeStatus;
  /** Undefined for the first status of the kind. */
  readonly previousState: HostRuntimeLifecycleState | undefined;
};

/** Receives every status change and every failure that no caller can receive. */
export type RuntimeObserver = {
  statusChanged(change: RuntimeStatusChange): void;
  backgroundFailure(message: string): void;
};

import type { WorkspaceSessionExternal } from "@openducktor/contracts";
import type { Deferred, Fiber } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { SerialLane } from "../../effect/serial-gate";
import type { RuntimeSessionImportPort } from "../../ports/runtime-session-import-port";

export type WorkspaceSessionImportCatalog = {
  workspaceId: string;
  runtimeKind: string;
  repoPath: string;
  runtimeId: string;
  controller: AbortController;
  result: Deferred.Deferred<WorkspaceSessionExternal[], HostError>;
  fiber?: Fiber.Fiber<void, never>;
  expiry?: Fiber.Fiber<void, never>;
  cursors: Map<string, { search: string; offset: number; pageSize: number }>;
  gate: SerialLane;
  readers: Set<Fiber.Fiber<WorkspaceSessionExternal[], HostError>>;
  failure?: HostError;
  discovery?: {
    owned: Set<string>;
    allowed: Set<string>;
    eligibleDirectories: Map<string, boolean>;
    records: Map<string, WorkspaceSessionExternal>;
    reader: ReturnType<RuntimeSessionImportPort["scanSessions"]>;
    done: boolean;
    bytes: number;
    scanned: number;
  };
};

import { Context, type Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

export type WorkspaceHostOwnershipError =
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate;

export type WorkspaceHostOwnershipPort = {
  claimWorkspace(workspaceId: string): Effect.Effect<boolean, WorkspaceHostOwnershipError>;
  releaseWorkspace(workspaceId: string): Effect.Effect<void, HostOperationErrorAggregate>;
  releaseAll(): Effect.Effect<void, HostOperationErrorAggregate>;
};

export class WorkspaceHostOwnershipPortTag extends Context.Tag(
  "@openducktor/host/WorkspaceHostOwnershipPort",
)<WorkspaceHostOwnershipPortTag, WorkspaceHostOwnershipPort>() {}

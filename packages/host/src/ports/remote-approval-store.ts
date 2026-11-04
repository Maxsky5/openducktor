import type { DevelopmentInstanceId, RemoteClientKind } from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

export type RemoteHostOwner = {
  shell: "electron" | "web";
  developmentInstanceId?: DevelopmentInstanceId;
  profile: string;
};
export type RemoteClientApproval = {
  clientId: string;
  clientKind: RemoteClientKind;
  tokenHash: string;
};
export type RemoteApprovalStoreError = HostOperationErrorAggregate | HostValidationErrorAggregate;
export interface RemoteApprovalStore {
  readonly hostId: string;
  list(): Effect.Effect<RemoteClientApproval[], RemoteApprovalStoreError>;
  read(clientId: string): Effect.Effect<RemoteClientApproval | null, RemoteApprovalStoreError>;
  create(approval: RemoteClientApproval): Effect.Effect<void, RemoteApprovalStoreError>;
  revoke(clientId: string): Effect.Effect<void, RemoteApprovalStoreError>;
}
export interface RemoteApprovalStorePort {
  open(owner: RemoteHostOwner): Effect.Effect<RemoteApprovalStore, RemoteApprovalStoreError>;
}

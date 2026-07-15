import type { AgentRole } from "@openducktor/core";
import type { RuntimeInfo } from "../runtime/runtime";
import type { RuntimeDependencies } from "./start-session.types";

type LeaseRuntimeDependencies = Pick<
  RuntimeDependencies,
  | "prepareTaskSessionStartupLease"
  | "completeTaskSessionStartupLease"
  | "abortTaskSessionStartupLease"
>;

type AcquireTaskSessionStartupLeaseInput = {
  repoPath: string;
  taskId: string;
  role: AgentRole;
  prepare: LeaseRuntimeDependencies["prepareTaskSessionStartupLease"];
  complete: LeaseRuntimeDependencies["completeTaskSessionStartupLease"];
  abort: LeaseRuntimeDependencies["abortTaskSessionStartupLease"];
};

type TaskSessionStartupLease = {
  bootstrap: NonNullable<RuntimeInfo["bootstrap"]>;
};

export const acquireTaskSessionStartupLease = async ({
  repoPath,
  taskId,
  role,
  prepare,
  complete,
  abort,
}: AcquireTaskSessionStartupLeaseInput): Promise<TaskSessionStartupLease> => {
  const leaseId = await prepare(repoPath, taskId, role);
  const abortLease = () => abort(repoPath, taskId, leaseId);

  return {
    bootstrap: {
      complete: () => complete(repoPath, taskId, leaseId),
      abort: abortLease,
    },
  };
};

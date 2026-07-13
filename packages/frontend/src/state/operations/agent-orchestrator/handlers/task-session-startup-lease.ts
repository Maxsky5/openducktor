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
  abortAfter: (error: unknown) => Promise<never>;
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
    async abortAfter(error): Promise<never> {
      try {
        await abortLease();
      } catch (abortError) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} Failed to release the task session startup lease: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
          error instanceof Error ? { cause: error } : undefined,
        );
      }
      throw error;
    },
  };
};

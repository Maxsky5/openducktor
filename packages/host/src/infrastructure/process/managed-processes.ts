/**
 * The child processes that the host or a runtime owner started and manages. PIDs belong to the
 * operating system process, so one registry serves every host in this process.
 *
 * A child stays registered until Node reports its exit. Node reaps the child and emits `exit` in
 * the same event loop turn, so no read sees a reused PID while the entry exists.
 */
import type { ManagedProcess } from "../../ports/process-inspector-port";

type ManagedChild = {
  readonly pid?: number | undefined;
  once(event: "exit", listener: () => void): void;
};

const managedProcesses = new Map<number, ManagedProcess>();

export const trackManagedProcess = (child: ManagedChild, managed: ManagedProcess): void => {
  const { pid } = child;
  if (pid === undefined || pid <= 0) return;
  managedProcesses.set(pid, managed);
  child.once("exit", () => {
    managedProcesses.delete(pid);
  });
};

export const readManagedProcesses = (): ReadonlyMap<number, ManagedProcess> =>
  new Map(managedProcesses);

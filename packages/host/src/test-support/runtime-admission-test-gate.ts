import { createRuntimeAdmissionGate } from "@openducktor/runtime-orchestration";
import { createRuntimeAdmissionPort } from "../application/runtimes/host-runtime-ports";

/** A runtime admission gate that tests open and close, and that admits with host errors. */
export const createTestRuntimeAdmissionGate = () => {
  const gate = createRuntimeAdmissionGate();
  return { ...gate, ...createRuntimeAdmissionPort(gate) };
};

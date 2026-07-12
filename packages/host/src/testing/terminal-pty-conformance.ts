export type TerminalPtyConformanceObservation = {
  output: number[][];
  eventOrder: string[];
  operations: string[];
  supportsOutputPause: boolean;
  expectedOutputPause: boolean;
};

/** Shared observable contract used by every runtime-native PTY adapter test. */
export const assertTerminalPtyConformance = (
  observation: TerminalPtyConformanceObservation,
): void => {
  if (JSON.stringify(observation.output) !== "[[1,2]]") {
    throw new Error("PTY adapter did not preserve binary output bytes.");
  }
  if (observation.eventOrder.join(",") !== "output,exit") {
    throw new Error("PTY adapter did not publish final output before exit.");
  }
  if (!observation.operations.some((entry) => entry.startsWith("write:"))) {
    throw new Error("PTY adapter did not forward input.");
  }
  if (!observation.operations.some((entry) => entry.startsWith("resize:"))) {
    throw new Error("PTY adapter did not forward resize.");
  }
  if (observation.supportsOutputPause !== observation.expectedOutputPause) {
    throw new Error("PTY adapter reported the wrong output-pause capability.");
  }
};

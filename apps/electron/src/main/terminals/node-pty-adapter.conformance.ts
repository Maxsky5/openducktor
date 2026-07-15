import {
  observeLiveTerminalPtyConformance,
  verifyLiveTerminalPtyInterrupt,
  verifyLiveTerminalPtyNaturalExitCleanup,
  verifyLiveTerminalPtyProcessTreeTermination,
} from "@openducktor/host";
import { createNodePtyPort } from "./node-pty-adapter";

const observation = await observeLiveTerminalPtyConformance(createNodePtyPort());

if (!observation.transcript.includes("INPUT:terminal-conformance")) {
  throw new Error("node-pty did not preserve terminal input through the adapter.");
}
if (!/40\s+120/.test(observation.transcript)) {
  throw new Error("node-pty did not propagate the requested 120x40 terminal grid.");
}
if (observation.eventOrder.at(-1) !== "exit" || observation.exit.exitCode !== 0) {
  throw new Error("node-pty did not publish output before a successful exit.");
}
await verifyLiveTerminalPtyProcessTreeTermination(createNodePtyPort());
await verifyLiveTerminalPtyNaturalExitCleanup(createNodePtyPort());
await verifyLiveTerminalPtyInterrupt(createNodePtyPort());

console.log("node-pty adapter conformance passed.");

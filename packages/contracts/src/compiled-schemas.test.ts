import { expect, test } from "bun:test";
import { z } from "zod";
import { taskEventStreamFrameSchema } from "./external-task-sync-schemas";
import { isoTimestampSchema } from "./string-schemas";
import { terminalServerMessageSchema } from "./terminal-protocol";

const terminalOutputSchema = terminalServerMessageSchema.options.find(
  (option) => option.shape.type.value === "output",
);
if (!terminalOutputSchema) throw new Error("The terminal protocol has no output frame schema.");

// Hot-path schemas call `z.compile` without `strict`, because strict mode throws at startup where a
// Content-Security-Policy blocks eval, as on app.openducktor.dev. There, Zod uses its runtime
// parser. This test keeps the strict check, so a schema change cannot remove the fast path unseen.
test.each([
  ["ISO timestamps", isoTimestampSchema],
  ["task stream frames", taskEventStreamFrameSchema],
  ["terminal output frames", terminalOutputSchema],
])("%s keep the compiled fast path where eval is allowed", (_name, schema) => {
  expect(() => z.compile(schema, { strict: true })).not.toThrow();
});

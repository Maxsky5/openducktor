import { createHash } from "node:crypto";
import type { CodexAppServerTurnStartParams } from "@openducktor/contracts";

/** Native application context truncates each value at 4000 UTF-8 bytes. */
export const codexWorkflowContext = (
  prompt: string,
): NonNullable<CodexAppServerTurnStartParams["additionalContext"]> => {
  const revision = createHash("sha256").update(prompt).digest("hex");
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const character of prompt) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 3000) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += character;
    bytes += size;
  }
  if (part) parts.push(part);
  return Object.fromEntries(
    parts.map((value, index) => [
      `openducktor-workflow-${revision}-${String(index).padStart(8, "0")}`,
      {
        kind: "application" as const,
        value: `Current OpenDucktor workflow context, revision ${revision}, part ${index + 1} of ${parts.length}. Together these parts replace all earlier OpenDucktor workflow context.\n${value}`,
      },
    ]),
  );
};

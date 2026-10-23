import { toClaudeOdtToolAliases, toOpencodeExposedOdtToolIds } from "@openducktor/contracts";

// Saved transcripts keep these names. They are no longer callable workflow tools.
const retiredArtifactWriters = new Map(
  ["odt_set_spec", "odt_set_plan", "odt_qa_approved", "odt_qa_rejected"].flatMap((name) =>
    [...toOpencodeExposedOdtToolIds(name), ...toClaudeOdtToolAliases(name)].map(
      (alias) => [alias, name] as const,
    ),
  ),
);

export const retiredArtifactToolName = (name: string): string | undefined =>
  retiredArtifactWriters.get(name.trim());

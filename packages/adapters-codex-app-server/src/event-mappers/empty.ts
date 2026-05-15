import { emptyCodexMappingResult } from "../codex-canonical-events";
import type { CodexEventMapper } from "../codex-event-mapper";
import { noCodexMapperState } from "../codex-event-mapper";

export const emptyMapper = (name: string): CodexEventMapper => ({
  name,
  createState: noCodexMapperState,
  fromLive: emptyCodexMappingResult,
  fromThreadItem: emptyCodexMappingResult,
});

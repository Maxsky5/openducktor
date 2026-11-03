import { z } from "zod";
import { TOOL_TAB_KINDS, type ToolTabKind } from "./panel-tab-kinds";
import { type PanelTabEntry, type SessionPanelLayout } from "./session-panel-layout";

/** The selection keys that v1 records saved: the built-in roles and chat. */
const V1_SELECTION_KEYS = ["spec", "planner", "build", "qa", "chat"] as const;

/** The key prefix of the saved layouts of app versions before browser tabs. */
export const V1_STORAGE_PREFIX = "openducktor:session-panel-layout:v1:";

const toolTabKindSchema = z.enum(TOOL_TAB_KINDS);

const v1LayoutSchema = z.object({
  version: z.literal(1),
  panels: z.object({ right: z.array(toolTabKindSchema), bottom: z.array(toolTabKindSchema) }),
  closedKinds: z.array(toolTabKindSchema),
  selectedRight: z.partialRecord(z.enum(V1_SELECTION_KEYS), toolTabKindSchema.nullable()),
});

/** Reads a v1 record. It has tool tabs only, and no bottom selection. */
export const fromV1Record = (saved: string): SessionPanelLayout => {
  const record = v1LayoutSchema.parse(JSON.parse(saved));
  const entries = (kinds: ToolTabKind[]): PanelTabEntry[] =>
    kinds.map((kind) => ({ id: kind, kind }));
  return {
    panels: { right: entries(record.panels.right), bottom: entries(record.panels.bottom) },
    closedKinds: [...record.closedKinds],
    selectedRight: { ...record.selectedRight },
    selectedBottom: null,
  };
};

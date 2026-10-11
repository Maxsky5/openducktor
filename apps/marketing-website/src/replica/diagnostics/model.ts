// The data of the Diagnostics sheet of diagnostics-panel-sections.tsx: the overview, and the
// checks of the host and of the workspace.
import type { RuntimeKind } from "../../sample/models";

/** The health of a check: done, still working, or still loading. */
export type DiagHealth = "ok" | "busy" | "loading";

/** The status pill of a check, from diagnostics-status.tsx. */
export type DiagStatusData = { health: DiagHealth; label: string };

/** The icon of a tool or service, or of a workspace check, from diagnostics-card.tsx. */
export type DiagTool = "path" | "git" | "mcp-bridge" | "repository-setup" | "task-store";

/** A fact under the title of a check. A path is mono. */
export type DiagDetail = { label?: string; value: string; path?: boolean };

/** A check row: a runtime of the host, a tool or service, or a check of the workspace. */
export type DiagCheck = {
  /** The name that the scene uses to find the check. */
  id: string;
  /** A runtime row shows the brand of its runtime. The other rows show the icon of their tool. */
  runtime?: RuntimeKind;
  tool?: DiagTool;
  title: string;
  value?: string;
  details: readonly DiagDetail[];
  status: DiagStatusData;
  /** A runtime row offers Restart. */
  restart?: boolean;
};

/** The verdict at the top of the sheet: the checks run, or everything works. */
export type DiagOverviewData = { tone: "checking" | "healthy"; title: string; description: string };

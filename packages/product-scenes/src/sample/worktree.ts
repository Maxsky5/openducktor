// Sample data of the worktree tools. The apps are fictional. Sources: open-in-menu.tsx and the
// macOS catalog in packages/host/src/adapters/open-in-tools.
import { CONFIG_PATH, taskId, WORKSPACE } from "./workspace";

/** The branch of the sample task, which the workflow story builds. */
export const TASK_BRANCH = "odt/fieldnotes-k3x9-open-search-shortcut";

/** The default worktree of a task: <config directory>/worktrees/<workspace id>/<task id>. */
export const WORKTREE_PATH = `${CONFIG_PATH}/worktrees/${WORKSPACE}/${taskId("k3x9")}`;

/** A tool that opens a worktree, with the fallback icon that the product shows without an app icon. */
export type OpenInTool = { label: string; icon: "folder" | "terminal" | "app" };

/** Installed apps in catalog order. */
export const OPEN_IN_TOOLS = [
  { label: "Finder", icon: "folder" },
  { label: "Terminal", icon: "terminal" },
  { label: "Ghostty", icon: "terminal" },
  { label: "Cursor", icon: "app" },
  { label: "Zed", icon: "app" },
  { label: "WebStorm", icon: "app" },
] as const satisfies readonly OpenInTool[];

/** The default tool of the Open In button in the worktree view: the tool that opened it last. */
export const OPEN_IN_DEFAULT: OpenInTool = { label: "VS Code", icon: "app" };

/** The default tool of the Open In button in the workflow steps. */
export const OPEN_IN_TERMINAL: OpenInTool = OPEN_IN_TOOLS[1];

/** The app that the scene chooses in the menu. */
export const OPEN_IN_CHOICE = "Cursor";

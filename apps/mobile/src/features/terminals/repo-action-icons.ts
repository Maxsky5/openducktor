import type { RepoActionIcon } from "@openducktor/contracts";
import type { IconName } from "@/ui/icon";

/** The icon of each repository action, as the desktop repository action buttons. */
export const REPO_ACTION_ICONS = {
  play: "play",
  test: "flask-conical",
  lint: "list-checks",
  configure: "wrench",
  build: "hammer",
  debug: "bug",
} as const satisfies Record<RepoActionIcon, IconName>;

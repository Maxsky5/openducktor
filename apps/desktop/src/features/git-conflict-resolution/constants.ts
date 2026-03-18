export const INLINE_CODE_CLASS_NAME =
  "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

export const BUILD_REBASE_CONFLICT_RESOLUTION_SCENARIO =
  "build_rebase_conflict_resolution" as const;

export const GIT_CONFLICT_TEST_IDS = {
  dialog: "agent-studio-git-conflict-modal",
  abortButton: "agent-studio-git-abort-conflict-button",
  askBuilderButton: "agent-studio-git-ask-builder-conflict-button",
  strip: "agent-studio-git-conflict-strip",
  conflictCountBadge: "agent-studio-git-conflict-count-badge",
  abortStripButton: "agent-studio-git-abort-conflict-strip-button",
  askBuilderStripButton: "agent-studio-git-ask-builder-conflict-strip-button",
} as const;

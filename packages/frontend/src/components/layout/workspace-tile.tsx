import type { WorkspaceRecord } from "@openducktor/contracts";
import { type ReactElement, useReducer } from "react";
import {
  deriveWorkspaceInitials,
  noColorTileClasses,
  tileColorFaceStyle,
  tileLabelSizeClass,
} from "@/lib/workspace-tile-appearance";
import { cn } from "@/lib/utils";

export type WorkspaceTileSource = Pick<
  WorkspaceRecord,
  "workspaceName" | "abbreviation" | "tileColor" | "iconDataUrl"
>;

const TILE_SIZES = {
  sm: { face: "size-8", image: "size-4" },
  md: { face: "size-9", image: "size-5" },
  lg: { face: "size-10", image: "size-6" },
} as const;

/** The workspace image, or its abbreviation when it has no readable image. */
export function WorkspaceTileContent({
  workspace,
  imageClassName,
}: {
  workspace: WorkspaceTileSource;
  imageClassName: string;
}): ReactElement {
  const [failedIconDataUrl, markIconDataUrlFailed] = useReducer(
    (_current: string | null, next: string) => next,
    null,
  );
  const iconDataUrl = workspace.iconDataUrl ?? null;

  if (iconDataUrl && failedIconDataUrl !== iconDataUrl) {
    return (
      <img
        src={iconDataUrl}
        alt=""
        aria-hidden="true"
        className={imageClassName}
        onError={() => {
          markIconDataUrlFailed(iconDataUrl);
        }}
      />
    );
  }

  const label = workspace.abbreviation ?? deriveWorkspaceInitials(workspace.workspaceName);

  return (
    <span className={cn("font-semibold leading-none", tileLabelSizeClass(label))}>{label}</span>
  );
}

/** The same workspace face in the rail, session rows, and session cards. */
export function WorkspaceTile({
  workspace,
  size = "sm",
  active = false,
  className,
}: {
  workspace: WorkspaceTileSource;
  size?: keyof typeof TILE_SIZES;
  active?: boolean;
  className?: string;
}): ReactElement {
  const dimensions = TILE_SIZES[size];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg text-foreground shadow-sm",
        dimensions.face,
        !workspace.tileColor && noColorTileClasses(active),
        className,
      )}
      style={workspace.tileColor ? tileColorFaceStyle(workspace.tileColor) : undefined}
    >
      <WorkspaceTileContent
        workspace={workspace}
        imageClassName={cn(dimensions.image, "rounded-md object-cover")}
      />
    </span>
  );
}

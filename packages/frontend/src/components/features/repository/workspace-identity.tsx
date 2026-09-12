import type { WorkspaceRecord } from "@openducktor/contracts";
import { type ReactElement, useReducer } from "react";

const deriveWorkspaceInitials = (workspaceName: string): string => {
  const trimmedName = workspaceName.trim();
  if (!trimmedName) {
    return "?";
  }

  const segments = trimmedName.split(/[^A-Za-z0-9]+/).reduce<string[]>((nextSegments, segment) => {
    const trimmedSegment = segment.trim();
    if (trimmedSegment.length > 0) {
      nextSegments.push(trimmedSegment);
    }
    return nextSegments;
  }, []);

  if (segments.length >= 2) {
    return `${segments[0]?.[0] ?? ""}${segments[1]?.[0] ?? ""}`.toUpperCase();
  }

  return trimmedName.slice(0, 2).toUpperCase();
};

export function WorkspaceAvatar({ workspace }: { workspace: WorkspaceRecord }): ReactElement {
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
        className="size-6 rounded-md object-cover"
        onError={() => {
          markIconDataUrlFailed(iconDataUrl);
        }}
      />
    );
  }

  return (
    <span className="text-xs font-semibold uppercase">
      {deriveWorkspaceInitials(workspace.workspaceName)}
    </span>
  );
}

export function WorkspaceIdentityCard({ workspace }: { workspace: WorkspaceRecord }): ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <WorkspaceAvatar workspace={workspace} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{workspace.workspaceName}</p>
        <p className="truncate font-mono text-xs text-muted-foreground" title={workspace.repoPath}>
          {workspace.repoPath}
        </p>
      </div>
    </div>
  );
}

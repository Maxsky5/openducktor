import type { WorkspaceSessionExternal } from "@openducktor/contracts";
import { Folder, Import, LoaderCircle } from "lucide-react";
import { formatCiRelativeTime } from "@/components/features/agents/task-execution-ci-relative-time-format";
import { Button } from "@/components/ui/button";

type Props = {
  rows: WorkspaceSessionExternal[] | undefined;
  search: string;
  pending: boolean;
  selectedSessionId: string | undefined;
  page: number;
  hasNextPage: boolean;
  onImport: (session: WorkspaceSessionExternal) => void;
  onPrevious: () => void;
  onNext: () => void;
};

export function WorkspaceSessionImportResults({
  rows,
  search,
  pending,
  selectedSessionId,
  page,
  hasNextPage,
  onImport,
  onPrevious,
  onNext,
}: Props) {
  if (!rows) return null;
  const hasPages = page > 0 || hasNextPage;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {pending && (
        <p role="status" className="sr-only">
          Importing session…
        </p>
      )}
      {rows.length === 0 && (
        <p
          role="status"
          className="flex flex-1 items-center justify-center py-8 text-center text-sm text-muted-foreground"
        >
          {search ? "No sessions match your search" : "No external sessions found"}
        </p>
      )}
      {rows.length > 0 && (
        <ul
          aria-label="External sessions"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-border rounded-lg border border-border"
        >
          {rows.map((session) => (
            <li
              key={session.externalSessionId}
              className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/30 focus-within:bg-muted/30 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <p
                  className="truncate text-sm font-semibold text-foreground"
                  title={session.title ?? session.externalSessionId}
                >
                  {session.title ?? session.externalSessionId}
                </p>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Folder aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="min-w-0 truncate" title={session.workingDirectory}>
                    {session.workingDirectory}
                  </span>
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={session.externalSessionId}
                >
                  <span className="mr-1.5">Session ID</span>
                  <span className="font-mono">{session.externalSessionId}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                {session.updatedAt !== null && (
                  <time
                    className="text-xs text-muted-foreground"
                    title={new Date(session.updatedAt).toLocaleString()}
                    dateTime={new Date(session.updatedAt).toISOString()}
                  >
                    {formatCiRelativeTime(new Date(session.updatedAt).toISOString())}
                  </time>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => onImport(session)}
                  aria-label={`Import ${session.title ?? session.externalSessionId}`}
                >
                  {pending && selectedSessionId === session.externalSessionId ? (
                    <LoaderCircle className="motion-safe:animate-spin" />
                  ) : (
                    <Import />
                  )}
                  {pending && selectedSessionId === session.externalSessionId
                    ? "Importing…"
                    : "Import"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(rows.length > 0 || hasPages) && (
        <div className="flex shrink-0 items-center justify-between">
          {hasPages && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || page === 0}
              onClick={onPrevious}
            >
              Previous
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {hasPages ? `Page ${page + 1} · ` : ""}
            {rows.length} {rows.length === 1 ? "session" : "sessions"}
          </span>
          {hasPages && (
            <Button variant="outline" size="sm" disabled={pending || !hasNextPage} onClick={onNext}>
              Next
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

import type { WorkspaceSessionExternal } from "@openducktor/contracts";
import { Import, LoaderCircle } from "lucide-react";
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
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y divide-border rounded-md border border-border"
        >
          {rows.map((session) => (
            <li key={session.externalSessionId} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className="min-w-0 truncate text-sm font-medium"
                    title={session.title ?? session.externalSessionId}
                  >
                    {session.title ?? session.externalSessionId}
                  </p>
                  {session.updatedAt !== null && (
                    <time
                      className="shrink-0 text-xs font-normal text-muted-foreground"
                      title={new Date(session.updatedAt).toLocaleString()}
                      dateTime={new Date(session.updatedAt).toISOString()}
                    >
                      {formatCiRelativeTime(new Date(session.updatedAt).toISOString())}
                    </time>
                  )}
                </div>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={session.workingDirectory}
                >
                  {session.workingDirectory}
                </p>
                <div className="mt-1 flex items-baseline gap-3 text-xs text-muted-foreground">
                  <p className="min-w-0 flex-1 truncate" title={session.externalSessionId}>
                    {session.externalSessionId}
                  </p>
                </div>
              </div>
              <Button
                className="shrink-0"
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

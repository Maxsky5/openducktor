import type { WorkspaceSessionExternal } from "@openducktor/contracts";
import { Import, LoaderCircle } from "lucide-react";
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
  return (
    <>
      {rows?.length === 0 && (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          {search ? "No sessions match your search" : "No external sessions found"}
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul
          aria-label="External sessions"
          className="max-h-80 overflow-y-auto divide-y divide-border rounded-md border border-border"
        >
          {rows.map((session) => (
            <li key={session.externalSessionId} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-medium"
                  title={session.title ?? session.externalSessionId}
                >
                  {session.title ?? session.externalSessionId}
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={session.workingDirectory}
                >
                  {session.workingDirectory}
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={session.externalSessionId}
                >
                  {session.externalSessionId}
                </p>
                {session.updatedAt !== null && (
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={new Date(session.updatedAt).toISOString()}
                  >
                    {new Date(session.updatedAt).toLocaleString()}
                  </time>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => onImport(session)}
                aria-label={`Import ${session.title ?? session.externalSessionId}`}
              >
                {pending && selectedSessionId === session.externalSessionId ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Import />
                )}
                Import
              </Button>
            </li>
          ))}
        </ul>
      )}
      {rows && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={pending || page === 0} onClick={onPrevious}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page + 1}</span>
          <Button variant="outline" size="sm" disabled={pending || !hasNextPage} onClick={onNext}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}

import { LoaderCircle } from "lucide-react";
import { type PropsWithChildren, type ReactElement } from "react";
import { Skeleton } from "./skeleton";

/** Keeps read-owning children mounted while the dialog prepares its content. */
export function DialogLoadingContent({
  loading,
  label = "Loading…",
  children,
}: PropsWithChildren<{ loading: boolean; label?: string }>): ReactElement {
  return (
    <>
      {loading ? (
        <div role="status" className="flex min-h-40 flex-col justify-center gap-5 py-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            </span>
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
          <div className="flex flex-col gap-2.5" aria-hidden="true">
            <Skeleton className="h-2 w-4/5 motion-reduce:animate-none" />
            <Skeleton className="h-2 w-3/5 motion-reduce:animate-none" />
          </div>
        </div>
      ) : null}
      <div
        inert={loading}
        aria-hidden={loading || undefined}
        style={{ display: loading ? "none" : "contents" }}
      >
        {children}
      </div>
    </>
  );
}

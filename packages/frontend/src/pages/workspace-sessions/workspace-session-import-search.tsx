import { LoaderCircle, Search, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  search: string;
  pending: boolean;
  loading: boolean;
  onSearchChange: (search: string) => void;
};

export function WorkspaceSessionImportSearch({ search, pending, loading, onSearchChange }: Props) {
  const searchInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="grid shrink-0 gap-2.5 border-b border-border bg-muted/20 p-4">
        <Label htmlFor="session-import-search">Search sessions</Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchInput}
            className="pl-9 pr-10"
            id="session-import-search"
            value={search}
            disabled={pending}
            placeholder="Title, session ID, or directory"
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 size-9"
              aria-label="Clear search"
              disabled={pending}
              onClick={() => {
                onSearchChange("");
                searchInput.current?.focus();
              }}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {loading && (
        <div
          role="status"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground"
        >
          <LoaderCircle className="mb-1 size-5 motion-safe:animate-spin" />
          <p className="font-medium text-foreground">
            {search ? "Searching sessions…" : "Finding sessions…"}
          </p>
          <p>Large histories can take longer. You can switch runtime or cancel.</p>
        </div>
      )}
    </>
  );
}

import { LoaderCircle } from "lucide-react";
import { SearchField } from "@/components/ui/search-field";

type Props = {
  search: string;
  pending: boolean;
  loading: boolean;
  onSearchChange: (search: string) => void;
};

export function WorkspaceSessionImportSearch({ search, pending, loading, onSearchChange }: Props) {
  return (
    <>
      <div className="grid shrink-0 gap-2.5 border-b border-border bg-muted/20 p-4">
        <SearchField
          id="session-import-search"
          label="Search sessions"
          value={search}
          placeholder="Title, session ID, or directory"
          disabled={pending}
          onValueChange={onSearchChange}
        />
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

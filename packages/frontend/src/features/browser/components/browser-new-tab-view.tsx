import { Globe } from "lucide-react";
import { type ReactElement, useId } from "react";
import { browserShortAddress, browserSiteLabel } from "./browser-format";

/** A page that the new tab offers. */
export type BrowserNewTabPage = {
  url: string;
  title: string | null;
  favicon: string | null;
};

export type BrowserNewTabViewProps = {
  /** The recent pages of the workspace, newest first. */
  recent: readonly BrowserNewTabPage[];
  /** The pages that other tabs of the workspace show now. */
  open: readonly BrowserNewTabPage[];
  onOpen: (url: string) => void;
};

/** The page of a tab with no address: recent pages and the pages of other tabs. */
export function BrowserNewTabView({ recent, open, onOpen }: BrowserNewTabViewProps): ReactElement {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="h-full w-full overflow-y-auto bg-card">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6">
        <header className="flex flex-col gap-1">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            Open a page
          </h2>
          <p className="text-xs text-muted-foreground">
            Type a web address above, such as <span className="font-mono">localhost:3000</span>
            {recent.length > 0 || open.length > 0 ? ", or choose a page below." : "."}
          </p>
        </header>
        {recent.length > 0 ? <PageGroup title="Recent" pages={recent} onOpen={onOpen} /> : null}
        {open.length > 0 ? (
          <PageGroup title="Open in other tabs" pages={open} onOpen={onOpen} />
        ) : null}
        {recent.length === 0 && open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            The pages that you open in this workspace show here.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PageGroup({
  title,
  pages,
  onOpen,
}: {
  title: string;
  pages: readonly BrowserNewTabPage[];
  onOpen: (url: string) => void;
}): ReactElement {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
        {pages.map((page) => (
          <li key={page.url} className="min-w-0">
            <PageTile page={page} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PageTile({
  page,
  onOpen,
}: {
  page: BrowserNewTabPage;
  onOpen: (url: string) => void;
}): ReactElement {
  const address = browserShortAddress(page.url);
  const name = page.title?.trim() || browserSiteLabel(page.url);
  return (
    <button
      type="button"
      title={page.url}
      className="group flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 ease-out hover:border-selected-accent/40 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={() => onOpen(page.url)}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border ring-inset transition-colors duration-150 group-hover:text-selected-accent group-hover:ring-selected-accent/30">
        {page.favicon ? (
          <img src={page.favicon} alt="" className="size-4" />
        ) : (
          <Globe className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{address}</span>
      </span>
    </button>
  );
}

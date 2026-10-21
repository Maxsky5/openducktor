import type { BrowserTabError } from "@openducktor/contracts";
import { CircleAlert, ExternalLink, RotateCw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { BrowserStateView } from "./browser-state-view";

export type BrowserLoadErrorViewProps = {
  error: BrowserTabError;
  onReload: () => void;
  /** Opens the page in the default browser of the user. */
  onOpenSite: () => void;
};

const TITLES = {
  load_failed: "This page cannot load",
  crashed: "This page stopped working",
  frame_refused: "This site cannot show in a tab",
} satisfies Record<BrowserTabError["kind"], string>;

/**
 * Shows why a page cannot load and keeps Reload available. A site that refuses frames opens in
 * the browser of the user instead.
 */
export function BrowserLoadErrorView({
  error,
  onReload,
  onOpenSite,
}: BrowserLoadErrorViewProps): ReactElement {
  return (
    <BrowserStateView
      icon={CircleAlert}
      tone="warning"
      title={TITLES[error.kind]}
      actions={
        error.kind === "frame_refused" ? (
          <Button type="button" size="sm" variant="outline" onClick={onOpenSite}>
            <ExternalLink aria-hidden="true" />
            Open in browser
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={onReload}>
            <RotateCw aria-hidden="true" />
            Reload
          </Button>
        )
      }
    >
      {error.url ? <p className="font-medium break-all text-foreground">{error.url}</p> : null}
      <p className="break-words">{error.message}</p>
    </BrowserStateView>
  );
}

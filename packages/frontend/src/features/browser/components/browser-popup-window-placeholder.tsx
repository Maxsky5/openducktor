import { AppWindow } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { BrowserStateView } from "./browser-state-view";

export type BrowserPopupWindowPlaceholderProps = {
  /** The page title, or null before the page has a title. */
  title: string | null;
  onShowWindow: () => void;
};

/** Stands in the panel for a page that shows in an Electron popup window. */
export function BrowserPopupWindowPlaceholder({
  title,
  onShowWindow,
}: BrowserPopupWindowPlaceholderProps): ReactElement {
  const pageTitle = title?.trim();
  return (
    <BrowserStateView
      icon={AppWindow}
      tone="info"
      title="This page is open in a popup window"
      actions={
        <Button type="button" size="sm" variant="outline" onClick={onShowWindow}>
          Show window
        </Button>
      }
    >
      {pageTitle ? <p className="font-medium break-words text-foreground">{pageTitle}</p> : null}
      <p>The window closes when you close this tab or the tab that opened it.</p>
    </BrowserStateView>
  );
}

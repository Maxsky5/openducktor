import { type ReactElement, useEffect, useMemo, useRef } from "react";
import { SessionPreviewInput } from "@/components/layout/sidebar/session-preview-content";
import { buildSessionPreviewModel } from "@/features/session-navigation/session-preview-model";
import type { SessionNavigationEntry } from "@/state/read-models/session-navigation-read-model";
import { useWorkspaceActivityProjection } from "@/state/workspace-activity/workspace-activity-context";
import { CommandPaletteFooter } from "./command-palette-footer";
import { RowChip } from "./command-palette-input";
import type { PaletteRowEntry } from "./use-command-palette-navigation";

/**
 * The questions and permission requests of a task or chat, with the reply forms of the sidebar
 * preview. It sits outside the cmdk list, so the forms keep Enter, Tab, and the arrow keys.
 * When the last request of the row gets its reply, the palette has nothing left to show here.
 */
export function CommandPaletteReply({
  row,
  sessionEntries,
  onBack,
  onAllReplied,
}: {
  row: PaletteRowEntry;
  /** The sidebar entries of the row that wait for a reply. */
  sessionEntries: readonly SessionNavigationEntry[];
  onBack: () => void;
  /** Runs once when the requests that the view showed no longer wait. */
  onAllReplied: () => void;
}): ReactElement {
  const contentRef = useRef<HTMLDivElement>(null);
  useAfterLastReply(sessionEntries.length > 0, onAllReplied);
  useEffect(() => {
    // The first form control takes focus, so a reply needs no click.
    contentRef.current
      ?.querySelector<HTMLElement>("button, input, textarea, [tabindex]:not([tabindex='-1'])")
      ?.focus();
  }, []);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border px-3">
        <RowChip row={row} onBack={onBack} />
      </div>
      <div ref={contentRef} className="max-h-[min(26rem,60vh)] overflow-y-auto px-4 py-3">
        {sessionEntries.length > 0 ? (
          sessionEntries.map((entry) => <EntryReplies key={entry.key} entry={entry} />)
        ) : (
          <p className="py-3 text-sm text-muted-foreground">Nothing waits for a reply now.</p>
        )}
      </div>
      <CommandPaletteFooter
        paletteHints={[{ id: "back", keys: ["Esc"], label: "Back", run: onBack }]}
      />
    </div>
  );
}

function EntryReplies({ entry }: { entry: SessionNavigationEntry }): ReactElement {
  const projection = useWorkspaceActivityProjection(entry.workspace.workspaceId);
  const { pending } = useMemo(
    () => buildSessionPreviewModel(entry, projection),
    [entry, projection],
  );
  return <SessionPreviewInput entry={entry} pending={pending} />;
}

/**
 * Run `afterLastReply` when requests that waited stop waiting. The live stream clears a request
 * after its reply. A view that opens with no request does not run it.
 */
export function useAfterLastReply(waiting: boolean, afterLastReply: () => void): void {
  const waitedRef = useRef(false);
  useEffect(() => {
    if (waiting) waitedRef.current = true;
    else if (waitedRef.current) afterLastReply();
  }, [afterLastReply, waiting]);
}

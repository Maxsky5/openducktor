// The footer of command-palette-footer.tsx: the hints of the highlighted row on the left, and the
// hints of the palette on the right. The Enter hint is the primary hint. A scene changes the
// labels and the hints of each view.
import type { ReactElement } from "react";
import type { KeyLabels } from "../keys";
import { Kbd } from "../ui/Kbd";
import "./PaletteFooter.css";

type PaletteFooterProps = {
  enter: string;
  next?: string | undefined;
  edit?: string | undefined;
  /** The keys of the hints. */
  keys: KeyLabels;
};

export function PaletteFooter({ enter, next, edit, keys }: PaletteFooterProps): ReactElement {
  return (
    <div className="pal-foot">
      <span className="pal-hints">
        <span className="pal-hint primary" data-hint="enter">
          <Kbd keys={["↵"]} />
          <span data-hint-label="">{enter}</span>
        </span>
        <span className="pal-hint" hidden={!next} data-hint="next">
          <Kbd keys={[keys.modifier, "↵"]} />
          <span data-hint-label="">{next}</span>
        </span>
        <span className="pal-hint" hidden={!edit} data-hint="edit">
          <Kbd keys={[keys.modifier, "E"]} />
          <span data-hint-label="">{edit}</span>
        </span>
        <span className="pal-hint" data-hint="tab">
          <Kbd keys={["Tab"]} />
          Actions
        </span>
      </span>
      <span className="pal-hints end">
        <span className="pal-hint" data-hint="workspace">
          <Kbd keys={[keys.alt, "↓"]} />
          Workspace
        </span>
        <span className="pal-hint" data-hint="close">
          <Kbd keys={["Esc"]} />
          <span data-hint-label="">Close</span>
        </span>
      </span>
    </div>
  );
}

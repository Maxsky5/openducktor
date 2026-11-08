// A menu of the composer: the frame of agent-chat-composer-menu.tsx, with its label, the place of
// the active row, and the list. It opens above the draft. The slash, skill, and reference menus of
// agent-chat-composer-slash-menu.tsx, agent-chat-composer-skill-menu.tsx, and
// agent-chat-composer-reference-menu.tsx fill the list with ComposerMenuRow. composer-menu.ts opens
// it, filters it, and moves its active row.
import type { ReactElement, ReactNode } from "react";
import "./ComposerMenu.css";

type ComposerMenuProps = {
  label: string;
  /** The name of the menu, which the scene uses to find it. */
  name: string;
  /** The number of rows. The first row is active. */
  count: number;
  children: ReactNode;
};

export function ComposerMenu({ label, name, count, children }: ComposerMenuProps): ReactElement {
  return (
    <div className="cm-menu" data-menu={name}>
      <div className="cm-menu-head">
        <b>{label}</b>
        <span data-menu-count="">{`1 / ${count}`}</span>
      </div>
      <div className="cm-menu-list">{children}</div>
    </div>
  );
}

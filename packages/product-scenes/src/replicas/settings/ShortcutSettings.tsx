// The Keyboard shortcuts section of settings-keyboard-shortcuts-section.tsx: the heading, the
// search field of search-field.tsx at size lg, the All commands and Assigned choice, Reset all
// while the draft has a change, and the commands by group under ListHeading in the row list of
// settings-prompt-rows.tsx. A search disables the choice and shows all commands.
// shortcut-settings.ts types the search, and it shows only the rows that the search keeps.
import { RotateCcw, Search, X } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import type { KeyPlatform } from "../keys";
import { Button } from "../ui/Button";
import { type PlatformKeys, type ShortcutCommand, ShortcutRow } from "./ShortcutRow";
import "../ui/Input.css";
import "./ShortcutSettings.css";

/** The words of the section. */
export const SHORTCUT_TEXT = {
  title: "Keyboard shortcuts",
  description:
    "Click the keys of a command to change them. Saved shortcuts apply to every app connected to this host.",
  filters: ["All commands", "Assigned"],
  resetAll: "Reset all",
} as const;

/** The placeholder of the search, with the keys of the command palette of the platform. */
export const SEARCH_PLACEHOLDER = {
  mac: "Search commands or keys, such as ⌘K",
  pc: "Search commands or keys, such as Ctrl+K",
} as const satisfies Record<KeyPlatform, string>;

/** The commands of one group, in the order of groupCommandViews of settings-shortcut-model.ts. */
export type ShortcutGroup = { group: string; commands: readonly ShortcutCommand[] };

type ShortcutSettingsProps = {
  platform: KeyPlatform;
  /** Every row that the scene shows, by group. */
  groups: readonly ShortcutGroup[];
  /** The search of the static frame, and the ids of the commands that it keeps. */
  search: { term: string; commands: readonly string[] };
  /** The command that the scene records, with its new keys. The draft has a change. */
  recorded: { id: string; keys: PlatformKeys };
};

export function ShortcutSettings({
  platform,
  groups,
  search,
  recorded,
}: ShortcutSettingsProps): ReactElement {
  const searching = search.term !== "";
  const shown = (command: ShortcutCommand): boolean => search.commands.includes(command.id);
  return (
    <section className="ss-section" data-shortcut-settings="" data-platform={platform}>
      <header className="ss-head">
        <b>{SHORTCUT_TEXT.title}</b>
        <p>{SHORTCUT_TEXT.description}</p>
      </header>
      <div className="ss-toolbar">
        <span className="ui-input ss-search" data-filled={flag(searching)} data-shortcut-search="">
          <Search className="ss-search-icon" />
          <span className="typed" data-typed="">
            {search.term}
          </span>
          <span className="ui-input-placeholder">{SEARCH_PLACEHOLDER[platform]}</span>
          <span className="ss-clear">
            <X />
          </span>
        </span>
        <span className="ss-filter" data-disabled={flag(searching)} data-shortcut-filter="">
          {SHORTCUT_TEXT.filters.map((label, index) => (
            <span className="ss-filter-item" data-checked={flag(index === 0)} key={label}>
              {label}
            </span>
          ))}
        </span>
        <Button variant="outline" className="ss-reset" data-reset-all="">
          <RotateCcw />
          {SHORTCUT_TEXT.resetAll}
        </Button>
      </div>
      <div className="ss-groups">
        {groups.map(({ group, commands }) => (
          <section
            className="ss-group"
            hidden={!commands.some(shown)}
            data-shortcut-group={group}
            key={group}
          >
            <h4>{group}</h4>
            <ul className="ss-rows">
              {commands.map((command) => (
                <ShortcutRow
                  command={command}
                  platform={platform}
                  recorded={command.id === recorded.id ? recorded.keys : undefined}
                  hidden={!shown(command)}
                  key={command.id}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

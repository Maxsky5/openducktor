// The keys of a film: the keys that the visitor holds in a scene, large in the caption column under
// the caption, so a viewer reads them on a phone and never takes them for a part of the app. Each
// chord is one row, with the name of each modifier under its symbol. The timeline shows a chord
// with `keys.show`.
import type { ReactElement } from "react";
import "./KeyCast.css";

/** One key: its symbol, and the name under it for a modifier, such as ⌘ and cmd. */
export type KeyCap = { cap: string; name?: string };

/** The keys that are down together, in the order that the app writes them. */
export type KeyChord = { id: string; keys: readonly KeyCap[] };

export function KeyCast({ chords }: { chords: readonly KeyChord[] }): ReactElement {
  return (
    <>
      {chords.map((chord) => (
        <p className="film-keys" data-keys={chord.id} key={chord.id}>
          {chord.keys.map((key) => (
            <span className="film-key" key={key.cap}>
              <kbd className="film-key-cap">{key.cap}</kbd>
              {key.name && <span className="film-key-name">{key.name}</span>}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}

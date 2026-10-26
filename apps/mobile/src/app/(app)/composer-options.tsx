import type { ReactElement } from "react";
import { ComposerOptionsSheet } from "@/features/composer/composer-options-sheet";

/** The model, runtime profile, effort, and speed of the session that the composer sends to. */
export default function ComposerOptionsRoute(): ReactElement {
  return <ComposerOptionsSheet />;
}

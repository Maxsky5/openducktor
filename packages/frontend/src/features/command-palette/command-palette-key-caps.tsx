import type { ReactElement } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

export function KeyCaps({ keys }: { keys: readonly string[] }): ReactElement {
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

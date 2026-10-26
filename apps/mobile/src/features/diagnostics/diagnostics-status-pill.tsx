import type { DiagnosticsStatus } from "@openducktor/frontend-core/diagnostics/diagnostics-panel-model";
import type { ReactElement } from "react";
import { StatusPill } from "@/ui/status-pill";
import {
  diagnosticsStatusAccessibilityLabel,
  diagnosticsStatusPresentation,
} from "./diagnostics-presentation";

/**
 * The status of one check or runtime, as the desktop `DiagnosticsStatusPill`: a dot and a word,
 * or a turning loader while work runs. The word names the state; the color only repeats it.
 */
export function DiagnosticsStatusPill({
  subject,
  status,
}: {
  subject: string;
  status: DiagnosticsStatus;
}): ReactElement {
  const presentation = diagnosticsStatusPresentation(status.health);
  return (
    <StatusPill
      label={status.label}
      variant={presentation.variant}
      busy={presentation.inProgress}
      accessibilityLabel={diagnosticsStatusAccessibilityLabel(subject, status)}
    />
  );
}

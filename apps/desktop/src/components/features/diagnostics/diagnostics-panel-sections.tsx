import { AlertTriangle } from "lucide-react";
import { Fragment, type ReactElement } from "react";
import { DiagnosticsKeyValueRow } from "./diagnostics-key-value-row";
import type { DiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsSection } from "./diagnostics-section";

type DiagnosticsPanelSectionsProps = {
  model: DiagnosticsPanelModel;
};

const renderSection = ({
  section,
}: {
  section: DiagnosticsPanelModel["sections"][keyof DiagnosticsPanelModel["sections"]];
}): ReactElement => {
  return (
    <DiagnosticsSection title={section.title} badge={section.badge}>
      {section.emptyMessage ? (
        <p className="text-xs text-muted-foreground">{section.emptyMessage}</p>
      ) : (
        <div className="space-y-1 text-xs text-foreground">
          {section.rows.map((row) => (
            <DiagnosticsKeyValueRow
              key={`${section.title}:row:${row.label}:${row.value}`}
              {...row}
            />
          ))}
          {section.errors.map((error) => (
            <p
              key={`${section.title}:error:${error}`}
              className="flex items-start gap-1 text-destructive-muted"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{error}</span>
            </p>
          ))}
        </div>
      )}
    </DiagnosticsSection>
  );
};

export function DiagnosticsPanelSections({ model }: DiagnosticsPanelSectionsProps): ReactElement {
  const orderedSections = [
    model.sections.repository,
    model.sections.cliTools,
    model.sections.opencodeRuntime,
    model.sections.openducktorMcp,
    model.sections.beadsStore,
  ] as const;

  return (
    <div className="space-y-3">
      {orderedSections.map((section) => (
        <Fragment key={section.title}>{renderSection({ section })}</Fragment>
      ))}
    </div>
  );
}

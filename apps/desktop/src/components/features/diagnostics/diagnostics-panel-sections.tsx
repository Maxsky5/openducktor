import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";
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
        <p className="text-xs text-slate-500">{section.emptyMessage}</p>
      ) : (
        <div className="space-y-1 text-xs text-slate-700">
          {section.rows.map((row) => (
            <DiagnosticsKeyValueRow key={row.label} {...row} />
          ))}
          {section.errors.map((error) => (
            <p key={error} className="flex items-start gap-1 text-rose-700">
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
  return (
    <div className="space-y-3">
      {renderSection({ section: model.sections.repository })}
      {renderSection({ section: model.sections.cliTools })}
      {renderSection({ section: model.sections.opencodeRuntime })}
      {renderSection({ section: model.sections.openducktorMcp })}
      {renderSection({ section: model.sections.beadsStore })}
    </div>
  );
}

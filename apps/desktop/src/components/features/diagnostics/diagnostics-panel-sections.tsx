import { AlertTriangle } from "lucide-react";
import { Fragment, type ReactElement } from "react";
import { DiagnosticsKeyValueRow } from "./diagnostics-key-value-row";
import type { DiagnosticsPanelModel } from "./diagnostics-panel-model";
import { DiagnosticsSection } from "./diagnostics-section";

type DiagnosticsPanelSectionsProps = {
  model: DiagnosticsPanelModel;
};

const buildRenderEntries = <T,>(
  items: T[],
  toBaseKey: (item: T) => string,
): Array<{ item: T; key: string }> => {
  const countsByBaseKey = new Map<string, number>();

  return items.map((item) => {
    const baseKey = toBaseKey(item);
    const nextCount = (countsByBaseKey.get(baseKey) ?? 0) + 1;
    countsByBaseKey.set(baseKey, nextCount);

    return {
      item,
      key: `${baseKey}:${nextCount}`,
    };
  });
};

const renderSection = ({
  section,
}: {
  section: DiagnosticsPanelModel["sections"][number];
}): ReactElement => {
  const rowEntries = buildRenderEntries(section.rows, (row) => `${row.label}:${row.value}`);
  const errorEntries = buildRenderEntries(section.errors, (error) => error);

  return (
    <DiagnosticsSection title={section.title} badge={section.badge}>
      {section.emptyMessage ? (
        <p className="text-xs text-muted-foreground">{section.emptyMessage}</p>
      ) : (
        <div className="space-y-1 text-xs text-foreground">
          {rowEntries.map(({ item: row, key }) => (
            <DiagnosticsKeyValueRow key={key} {...row} />
          ))}
          {errorEntries.map(({ item: error, key }) => (
            <p key={key} className="flex items-start gap-1 text-destructive-muted">
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
      {model.sections.map((section) => (
        <Fragment key={section.title}>{renderSection({ section })}</Fragment>
      ))}
    </div>
  );
}

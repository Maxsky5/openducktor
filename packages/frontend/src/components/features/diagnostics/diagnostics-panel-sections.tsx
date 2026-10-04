import { AlertTriangle, LoaderCircle } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { RuntimeRestartControl } from "@/components/features/runtimes/runtime-restart-control";
import { SettingsModal } from "@/components/features/settings/settings-modal";
import { DiagnosticsKeyValueRow } from "./diagnostics-key-value-row";
import type {
  DiagnosticKeyValueRowModel,
  DiagnosticsPanelModel,
  DiagnosticsRuntimeEntryModel,
  DiagnosticsRuntimeMcpModel,
  DiagnosticsSectionModel,
} from "./diagnostics-panel-model";
import { DiagnosticsSection, DiagnosticsStatusBadge } from "./diagnostics-section";
import { RUNTIME_MCP_TITLE } from "./diagnostics-workspace-model";

type DiagnosticsPanelSectionsProps = {
  model: DiagnosticsPanelModel;
};

export function DiagnosticsPanelSections({ model }: DiagnosticsPanelSectionsProps): ReactElement {
  const { runtimes, cliTools, mcpBridge } = model.host;
  const { workspace } = model;

  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-label="Host">
        <GroupHeading title="Host" />
        <DiagnosticsSection title="Agent runtimes" status={runtimes.status}>
          {runtimes.notice ? (
            <p className="text-xs text-muted-foreground" role="status">
              {runtimes.notice}
            </p>
          ) : null}
          <ul className="space-y-2">
            {runtimes.entries.map((entry) => (
              <RuntimeEntry key={entry.kind} entry={entry} />
            ))}
          </ul>
        </DiagnosticsSection>
        <CheckSection section={cliTools} />
        <CheckSection section={mcpBridge} />
      </section>
      <section className="space-y-3" aria-label="Workspace">
        {workspace.kind === "none" ? (
          <>
            <GroupHeading title="Workspace" />
            <p className="text-xs text-muted-foreground">{workspace.emptyMessage}</p>
          </>
        ) : (
          <>
            <GroupHeading title={`Workspace: ${workspace.name}`} subtitle={workspace.path} />
            <CheckSection section={workspace.repositorySetup} />
            <CheckSection section={workspace.taskStore} />
            <RuntimeMcpSection model={workspace.runtimeMcp} />
          </>
        )}
      </section>
    </div>
  );
}

function ErrorLine({ message }: { message: string }): ReactElement {
  return (
    <p className="flex items-start gap-1 text-xs text-destructive-muted">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

function EarlierResultNotice({ notice }: { notice: string | undefined }): ReactElement | null {
  return notice ? <p className="text-xs text-warning-muted">{notice}</p> : null;
}

function Rows({ rows }: { rows: DiagnosticKeyValueRowModel[] }): ReactElement {
  return (
    <>
      {rows.map((row) => (
        <DiagnosticsKeyValueRow key={row.label} {...row} />
      ))}
    </>
  );
}

function CheckSection({ section }: { section: DiagnosticsSectionModel }): ReactElement {
  return (
    <DiagnosticsSection title={section.title} status={section.status}>
      <EarlierResultNotice notice={section.notice} />
      {section.emptyMessage ? (
        <p className="text-xs text-muted-foreground">{section.emptyMessage}</p>
      ) : (
        <div className="space-y-1">
          <Rows rows={section.rows} />
        </div>
      )}
      {section.errors.map((error) => (
        <ErrorLine key={error} message={error} />
      ))}
    </DiagnosticsSection>
  );
}

function RuntimeEntry({ entry }: { entry: DiagnosticsRuntimeEntryModel }): ReactElement {
  let action: ReactNode = null;
  if (entry.action?.type === "restart") {
    action = (
      <RuntimeRestartControl
        runtimeKind={entry.kind}
        runtimeLabel={entry.label}
        actionLabel={entry.action.label}
        isLifecycleBusy={entry.isLifecycleBusy}
      />
    );
  } else if (entry.action?.type === "open_settings") {
    action = (
      <SettingsModal
        triggerLabel="Runtime settings"
        triggerSize="sm"
        deepLink={{ kind: "global", section: "runtimes" }}
      />
    );
  }

  return (
    <li
      className="space-y-1.5 rounded-md border border-border bg-card p-2.5"
      data-testid={`diagnostics-runtime-${entry.kind}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{entry.label}</p>
        <DiagnosticsStatusBadge status={entry.status} />
      </div>
      <div className="space-y-1">
        <Rows rows={entry.rows} />
      </div>
      {entry.progress ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <LoaderCircle className="size-3 animate-spin" />
          {entry.progress}
        </p>
      ) : null}
      {entry.failure ? (
        <div className="space-y-1">
          <DiagnosticsKeyValueRow label="Failed stage" value={entry.failure.stage} />
          <ErrorLine message={entry.failure.message} />
          <p className="text-xs text-muted-foreground">{entry.failure.nextAction}</p>
        </div>
      ) : null}
      {action ? <div className="flex justify-end pt-0.5">{action}</div> : null}
    </li>
  );
}

function RuntimeMcpSection({ model }: { model: DiagnosticsRuntimeMcpModel }): ReactElement {
  return (
    <DiagnosticsSection title={RUNTIME_MCP_TITLE} status={model.status}>
      <EarlierResultNotice notice={model.notice} />
      {model.emptyMessage ? (
        <p className="text-xs text-muted-foreground">{model.emptyMessage}</p>
      ) : null}
      <ul className="space-y-1.5">
        {model.entries.map((entry) => (
          <li key={entry.kind} className="space-y-1 rounded-md border border-border bg-card p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">{entry.label}</p>
              <DiagnosticsStatusBadge status={entry.status} />
            </div>
            {entry.detail ? <p className="text-xs text-muted-foreground">{entry.detail}</p> : null}
            {entry.observations.map((observation) => (
              <div key={observation.key} className="space-y-0.5 border-t border-border pt-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                    {observation.workingDirectory}
                  </p>
                  <DiagnosticsStatusBadge status={observation.status} />
                </div>
                <Rows rows={observation.rows} />
              </div>
            ))}
          </li>
        ))}
      </ul>
      {model.errors.map((error) => (
        <ErrorLine key={error} message={error} />
      ))}
    </DiagnosticsSection>
  );
}

function GroupHeading({ title, subtitle }: { title: string; subtitle?: string }): ReactElement {
  return (
    <div className="space-y-0.5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {subtitle ? <p className="break-all text-xs text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

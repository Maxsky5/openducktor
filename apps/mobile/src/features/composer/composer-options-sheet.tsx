import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useStableAgentSessionIdentity } from "@openducktor/frontend-core/lib/use-stable-agent-session-identity";
import { useMinimumLoader } from "@openducktor/frontend-core/lib/use-minimum-loader";
import { useRefreshStaleRuntimeCatalog } from "@openducktor/frontend-core/queries/use-runtime-catalog-query";
import { useRuntimeModelCatalogQuery } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import {
  type ModelPickerRuntime,
  type ModelPickerValue,
  selectableModelPickerCatalog,
  toModelPickerCatalogResource,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { resolveModelSelectionOptions } from "@openducktor/frontend-core/sessions/model-selection/model-selection-options";
import { useModelSelectionActions } from "@openducktor/frontend-core/sessions/model-selection/use-model-selection-actions";
import { useSpeedControl } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type {
  AgentSessionIdentity,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { useLocalSearchParams } from "expo-router";
import { type ReactElement, useCallback, useMemo } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import { readSessionRoute } from "@/features/session/session-route";
import { useSessionSelector } from "@/features/session/use-session-selector";
import { useCommandGate } from "@/host-session/active-session-context";
import { SheetScreen } from "@/navigation/sheet-screen";
import { EffortField, ModelField, SpeedField } from "@/features/model-picker/model-field";
import { effortPlaceholder, modelSummary } from "@/features/model-picker/model-field-model";
import { FormBody, FormField, MenuSelect } from "@/ui/form-rows";
import { useModelFavorites } from "@/features/model-picker/use-model-favorites";
import { EmptyState } from "@/ui/states";
import { ModalLoadingContent } from "@/ui/modal-loading-content";
import { Callout } from "@/ui/callout";

const TITLE = "Message options";
const NO_RUNTIMES: readonly ModelPickerRuntime[] = [];
const LOCK_REASON = "An existing session cannot change its runtime.";

/**
 * The agent, model, effort, and speed of an open session, as the desktop composer controls in a
 * sheet. Each choice applies at once, so the sheet closes with Done.
 */
export function ComposerOptionsSheet(): ReactElement {
  const route = readSessionRoute(useLocalSearchParams());
  const { workspaces, selectedWorkspace } = useMobileWorkspaces();
  if (!route.ok) {
    return (
      <SheetScreen title={TITLE} closeLabel="Done" draggable>
        <EmptyState icon="link-off" title="Incomplete session link" message={route.message} />
      </SheetScreen>
    );
  }
  const workspace = workspaces.find((entry) => entry.workspaceId === route.route.workspaceId);
  if (!workspace || selectedWorkspace?.workspaceId !== workspace.workspaceId) {
    return (
      <SheetScreen title={TITLE} closeLabel="Done" draggable>
        <EmptyState
          icon="link-off"
          title="Session not open"
          message="Open the session again, then open its message options."
        />
      </SheetScreen>
    );
  }
  return (
    <SheetScreen title={TITLE} closeLabel="Done" draggable>
      <SessionOptions repoPath={workspace.repoPath} identity={route.route.identity} />
    </SheetScreen>
  );
}

type OptionsFacts = {
  present: boolean;
  selectedModel: AgentSessionState["selectedModel"];
};

const ABSENT: OptionsFacts = Object.freeze({ present: false, selectedModel: null });

const selectOptionsFacts = (session: AgentSessionState | null): OptionsFacts =>
  session ? { present: true, selectedModel: session.selectedModel } : ABSENT;

const noDraftSelection = (): void => {};

function SessionOptions({
  repoPath,
  identity: routeIdentity,
}: {
  repoPath: string;
  identity: AgentSessionIdentity;
}): ReactElement {
  const identity = useStableAgentSessionIdentity(routeIdentity);
  const gate = useCommandGate();
  const { allRuntimeDefinitions, loadRepoRuntimeCatalog } = useRuntimeAvailabilityContext();
  const { updateAgentSessionModel } = useAgentOperationsContext();
  const facts = useSessionSelector(identity, selectOptionsFacts);
  const { favorites } = useModelFavorites();
  const runtimeKind = routeIdentity.runtimeKind;
  const runtimeRef = useMemo(
    () => ({ repoPath, runtimeKind, workingDirectory: routeIdentity.workingDirectory }),
    [repoPath, routeIdentity.workingDirectory, runtimeKind],
  );
  const catalogQuery = useRuntimeModelCatalogQuery({
    runtimeRef,
    loadRuntimeCatalog: loadRepoRuntimeCatalog,
  });
  const catalog = catalogQuery.catalog;
  const preparing = useMinimumLoader(!facts.present);
  // The catalog stays cached while the session is open, so the picker reads it again when it
  // opens and the cache is stale, as on desktop.
  const refreshStaleCatalog = useRefreshStaleRuntimeCatalog(loadRepoRuntimeCatalog);
  const refreshCatalog = useCallback(
    () => refreshStaleCatalog(runtimeRef),
    [refreshStaleCatalog, runtimeRef],
  );
  const selection = facts.selectedModel;
  const descriptor =
    allRuntimeDefinitions.find((definition) => definition.kind === runtimeKind) ?? null;
  const options = resolveModelSelectionOptions({
    liveSession: true,
    selectionCatalog: catalog,
    selectedModelSelection: selection,
  });
  const actions = useModelSelectionActions({
    loadedSessionIdentity: identity,
    updateAgentSessionModel,
    applyDraftSelection: noDraftSelection,
    selectedModelSelection: selection,
    selectionCatalog: catalog,
    selectedRuntimeKind: runtimeKind,
  });
  const disabled = !gate.open;
  const speed = useSpeedControl({
    key: routeIdentity.externalSessionId,
    runtimeKind,
    catalog,
    selection,
    disabled,
    onSelect: actions.handleSelectSpeed,
  });
  const { retry } = catalogQuery;
  const runtime = useMemo((): ModelPickerRuntime | null => {
    if (!descriptor) return null;
    return {
      descriptor,
      isEnabledForFavorites: true,
      resource: toModelPickerCatalogResource({
        catalog,
        isLoading: catalogQuery.isLoading,
        error: catalogQuery.error,
        isAvailable: true,
        unavailableReason: "The model catalog of this session is not available.",
        retry,
      }),
    };
  }, [catalog, catalogQuery.error, catalogQuery.isLoading, descriptor, retry]);
  const { handleSelectModelPair } = actions;
  const chooseModel = useCallback(
    (value: ModelPickerValue) => {
      const target = selectableModelPickerCatalog(runtime?.resource);
      if (target) handleSelectModelPair(value, target);
    },
    [handleSelectModelPair, runtime],
  );

  const runtimeLabel = RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].label;
  const supportsProfiles = descriptor?.capabilities.optionalSurfaces.supportsProfiles ?? false;

  const modelName = modelSummary(runtime ? [runtime] : NO_RUNTIMES, selection, runtimeKind).title;
  const profiles = options.agentProfileOptions;
  // A live session that cannot change its profile disables every profile with the same reason.
  const profileHint = profiles.every((option) => option.disabled === true)
    ? (profiles[0]?.description ?? null)
    : null;

  return (
    <ModalLoadingContent loading={preparing} label="Loading model options…">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {disabled ? (
          <View style={styles.notice}>
            <Callout
              tone="warning"
              title="Not connected"
              message="Reconnect to the host to change the message options."
            />
          </View>
        ) : null}
        <FormBody>
          {supportsProfiles && profiles.length > 0 ? (
            <FormField label="Agent" hint={profileHint}>
              <MenuSelect
                title="Agent"
                icon="bot"
                choices={profiles}
                selected={selection?.profileId}
                placeholder="Agent"
                disabled={disabled}
                onSelect={actions.handleSelectAgentProfile}
              />
            </FormField>
          ) : null}
          <ModelField
            runtimes={runtime ? [runtime] : NO_RUNTIMES}
            favorites={favorites}
            lock={{ runtimeKind, reason: LOCK_REASON }}
            selection={selection}
            fallbackRuntimeKind={runtimeKind}
            placeholder={catalogQuery.isLoading ? "Loading models…" : "Model"}
            disabled={disabled}
            pickerDisabled={disabled}
            hint={`Runtime: ${runtimeLabel}. ${LOCK_REASON} Changes apply to the next turn.`}
            onOpen={refreshCatalog}
            onChoose={chooseModel}
          />
          <EffortField
            effort={{
              options: options.variantOptions,
              value: selection?.variant,
              placeholder: effortPlaceholder({
                loading: catalogQuery.isLoading,
                hasModel: selection !== null,
              }),
              caption: modelName ?? "Effort",
              disabled,
              onSelect: actions.handleSelectVariant,
            }}
          />
          <SpeedField
            key={speed?.key}
            control={speed}
            caption={modelName ?? "Speed"}
            disabled={disabled}
          />
        </FormBody>
      </ScrollView>
    </ModalLoadingContent>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingBottom: theme.space.xxxl },
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingTop: theme.space.lg },
}));

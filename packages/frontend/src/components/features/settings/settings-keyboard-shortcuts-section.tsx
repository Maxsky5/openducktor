import { useShortcutCatalogue } from "@/features/shortcuts/use-shortcut-catalogue";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ShortcutCombination,
  ShortcutPreferences,
  ShortcutActionId,
} from "@openducktor/contracts";
import { Keyboard, LoaderCircle, RotateCcw, SearchX, Users } from "lucide-react";
import { SettingsShortcutRow } from "./settings-shortcut-row";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { ToolbarSearchField } from "@/components/ui/search-field";
import { readDevicePlatform } from "@/lib/device-platform";
import { getShellBridge } from "@/lib/shell-bridge";
import {
  defaultShortcut,
  effectiveShortcut,
  validateShortcuts,
} from "@/features/shortcuts/catalogue";
import { useShortcutRecorder } from "@/features/shortcuts/recording";
import { useShortcutPreferences } from "@/features/shortcuts/use-shortcut-preferences";

type ProposedShortcut = { id: ShortcutActionId; combination: ShortcutCombination | null };
export function SettingsKeyboardShortcutsSection() {
  const { query, save, updatesError } = useShortcutPreferences();
  const catalogue = useShortcutCatalogue(query.data);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [proposed, setProposed] = useState<ProposedShortcut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const platform = readDevicePlatform();
  const electron = getShellBridge().browser.surface === "electron";
  const recorder = useShortcutRecorder({
    platform,
    onRecorded: (id, combination) => {
      setProposed({ id, combination });
      setError(null);
    },
    onError: setError,
  });
  const { recording, preparing } = recorder;
  useLayoutEffect(() => {
    if (!restoreFocus.current || preparing || save.isPending) return;
    restoreFocus.current = false;
    opener.current?.focus();
  }, [preparing, save.isPending, proposed, resetOpen]);
  const persist = async (preferences: ShortcutPreferences) => {
    const problem = validateShortcuts(preferences, platform, electron, catalogue);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await save.mutateAsync(preferences);
      restoreFocus.current = true;
      setProposed(null);
      setResetOpen(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const validationError = query.data
    ? validateShortcuts(query.data, platform, electron, catalogue)
    : null;
  const loadError = query.error?.message ?? validationError;
  const disabled = save.isPending || preparing || Boolean(recording);
  const browsingDisabled = disabled || proposed !== null;
  const saveProposed = () => {
    if (proposed && query.data)
      void persist({
        version: 1,
        overrides: { ...query.data.overrides, [proposed.id]: proposed.combination },
      });
  };
  const categories = useMemo(
    () => [
      { value: "", label: "All categories" },
      ...Array.from(new Set(catalogue.map((entry) => entry.group)), (group) => ({
        value: group,
        label: group,
      })),
    ],
    [catalogue],
  );
  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = new Map<string, (typeof catalogue)[number][]>();
    for (const entry of catalogue) {
      if (category && entry.group !== category) continue;
      if (term && !`${entry.label} ${entry.group}`.toLowerCase().includes(term)) continue;
      const entries = result.get(entry.group) ?? [];
      entries.push(entry);
      result.set(entry.group, entries);
    }
    return result;
  }, [catalogue, category, search]);
  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6 lg:p-8"
      aria-label="Keyboard shortcuts"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
            <Keyboard className="size-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Keyboard shortcuts</h2>
            <p className="text-sm leading-5 text-muted-foreground">
              Choose a command, then record a key combination.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={browsingDisabled}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setResetOpen(true);
          }}
        >
          <RotateCcw aria-hidden="true" /> Reset all shortcuts
        </Button>
      </div>
      {query.isPending && <p role="status">Loading shortcuts…</p>}
      {updatesError && (
        <p role="alert" className="text-sm text-destructive">
          {updatesError}
        </p>
      )}
      {loadError !== null && (
        <Alert variant="destructive" className="items-center justify-between">
          <p>{loadError}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="items-center justify-between">
          <span>{error}</span>
          {proposed && (
            <Button variant="outline" size="sm" disabled={disabled} onClick={saveProposed}>
              Retry save
            </Button>
          )}
        </Alert>
      )}
      {resetOpen && (
        <div
          role="group"
          aria-label="Confirm reset"
          className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm"
        >
          <p>Restore the default shortcuts for everyone connected to this host?</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setResetOpen(false);
                opener.current?.focus();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={disabled}
              onClick={() => void persist({ version: 1, overrides: {} })}
            >
              {save.isPending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              {save.isPending ? "Resetting…" : "Confirm reset"}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="min-w-0">
            <ToolbarSearchField
              id="shortcut-search"
              label="Search commands"
              placeholder="Search shortcuts…"
              size="lg"
              value={search}
              disabled={browsingDisabled}
              onValueChange={setSearch}
            />
          </div>
          <div>
            <Label id="shortcut-category-label" className="sr-only">
              Shortcut category
            </Label>
            <Combobox
              value={category}
              options={categories}
              onValueChange={setCategory}
              searchable={false}
              disabled={browsingDisabled}
              triggerAriaLabelledBy="shortcut-category-label"
            />
          </div>
        </div>
        <div className="flex justify-end text-xs leading-5 text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden="true" />
            Shared with clients on this host
          </p>
        </div>
      </div>
      {groups.size === 0 && (
        <div
          role="status"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-12 text-center"
        >
          <SearchX className="mb-1 size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No shortcuts found</p>
          <p className="text-xs text-muted-foreground">Try another search or category.</p>
        </div>
      )}
      {Array.from(groups, ([group, entries]) => (
        <section key={group} aria-label={group} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold">{group}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">{entries.length}</span>
            </div>
            <span className="pr-10 text-xs text-muted-foreground">Shortcut</span>
          </div>
          <div className="rounded-xl border border-border bg-card [&>div+div]:border-t [&>div+div]:border-border/60 [&>div:first-child]:rounded-t-xl [&>div:last-child]:rounded-b-xl">
            {entries.map((entry) => (
              <SettingsShortcutRow
                key={entry.id}
                entry={entry}
                platform={platform}
                current={
                  query.data
                    ? effectiveShortcut(entry.id, query.data, platform, electron)
                    : undefined
                }
                defaultKeys={defaultShortcut(entry.id, platform, electron)}
                customized={Boolean(query.data && Object.hasOwn(query.data.overrides, entry.id))}
                disabled={disabled || !query.data}
                saving={save.isPending}
                recording={recording === entry.id}
                preparing={preparing}
                proposed={proposed?.id === entry.id ? proposed : null}
                onRecord={(element) => {
                  opener.current = element;
                  setProposed(null);
                  setError(null);
                  void recorder.begin(entry.id, element);
                }}
                onClear={(element) => {
                  opener.current = element;
                  setProposed({ id: entry.id, combination: null });
                  setError(null);
                }}
                onCancel={() => {
                  if (recording || preparing) void recorder.cancel();
                  else {
                    setProposed(null);
                    setError(null);
                    opener.current?.focus();
                  }
                }}
                onSave={saveProposed}
              />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

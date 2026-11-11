import { useShortcutCatalogue } from "@/features/shortcuts/use-shortcut-catalogue";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ShortcutCombination,
  ShortcutPreferences,
  ShortcutActionId,
} from "@openducktor/contracts";
import { Search, RotateCcw } from "lucide-react";
import { SettingsShortcutRow } from "./settings-shortcut-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const disabled = save.isPending || preparing || Boolean(recording);
  const saveProposed = () => {
    if (proposed && query.data)
      void persist({
        version: 1,
        overrides: { ...query.data.overrides, [proposed.id]: proposed.combination },
      });
  };
  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = new Map<string, (typeof catalogue)[number][]>();
    for (const entry of catalogue) {
      if (term && !`${entry.label} ${entry.group}`.toLowerCase().includes(term)) continue;
      const entries = result.get(entry.group) ?? [];
      entries.push(entry);
      result.set(entry.group, entries);
    }
    return result;
  }, [catalogue, search]);
  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6"
      aria-label="Keyboard shortcuts"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Keyboard shortcuts</h2>
          <p className="text-sm text-muted-foreground">
            Select a shortcut, then press the keys you want to use.
          </p>
          <p className="text-xs text-muted-foreground">
            Shared with clients connected to this host.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setResetOpen(true);
          }}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" /> Reset all shortcuts
        </Button>
      </div>
      {query.isPending && <p role="status">Loading shortcuts…</p>}
      {updatesError && (
        <p role="alert" className="text-sm text-destructive">
          {updatesError}
        </p>
      )}
      {(query.error || validationError) && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <p>{query.error?.message ?? validationError}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <span>{error}</span>
          {proposed && (
            <Button variant="outline" size="sm" disabled={disabled} onClick={saveProposed}>
              Retry save
            </Button>
          )}
        </div>
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
              size="sm"
              disabled={disabled}
              onClick={() => void persist({ version: 1, overrides: {} })}
            >
              {save.isPending ? "Resetting…" : "Confirm reset"}
            </Button>
          </div>
        </div>
      )}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          aria-label="Search commands"
          placeholder="Search shortcuts…"
          className="pl-9"
          value={search}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {groups.size === 0 && (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          No shortcuts match “{search}”.
        </p>
      )}
      {Array.from(groups, ([group, entries]) => (
        <section key={group} aria-label={group} className="space-y-2">
          <h3 className="px-1 text-xs font-semibold text-muted-foreground">{group}</h3>
          <div className="overflow-hidden rounded-lg border border-border divide-y divide-border">
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

import { describe, expect, test, mock } from "bun:test";
import { createHostClient } from "@openducktor/host-client";
import {
  workspaceProviderSetupSetSchema,
  workspaceProviderSetupBeginSchema,
  type WorkspaceProviderSetupDetection,
  type WorkspaceProviderSetupSelection,
  type WorkspaceProviderSetupStatus,
  type HostEventPayload,
} from "@openducktor/contracts";
import { azureDevOpsConnectionConfigurationFingerprint } from "@openducktor/core";
import { QueryProvider } from "@/lib/query-provider";
import { hostBridge } from "@/lib/host-client";
import type { WorkspaceProviderSetupUpdateListener } from "@/lib/shell-bridge";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { useWorkspaceProviderSetup } from "./use-workspace-provider-setup";
import { WorkspaceProviderFields } from "./workspace-provider-fields";
import {
  emptyWorkspaceProviderDraft,
  parseWorkspaceProviderDraft,
} from "./workspace-provider-draft";

const github = {
  id: "github",
  enabled: true,
  autoDetected: true,
  repository: { host: "github.com", owner: "detected", name: "repo" },
};
const ready: WorkspaceProviderSetupStatus = {
  health: {
    providerId: "github",
    enabled: true,
    available: true,
    executablePath: "/bin/gh",
    version: "gh version 2",
    authenticated: true,
    account: "user",
    repositoryMappingValid: true,
  },
  connection: null,
};
function fixture(
  detection: Promise<WorkspaceProviderSetupDetection> = Promise.resolve({
    outcome: "none",
    candidates: [],
  }),
  options: {
    signInStartup?: Promise<void>;
    signInEvent?: boolean;
    discard?: () => Promise<void>;
    status?: Promise<void>;
    readStatus?: () => Promise<WorkspaceProviderSetupStatus>;
    progress?: () => Promise<void>;
    areas?: string[];
    selection?: () => Promise<void>;
    pat?: () => Promise<void>;
  } = {},
) {
  const ref = { setupId: crypto.randomUUID(), revision: 0, repoPath: "/repo" };
  const selections: WorkspaceProviderSetupSelection[] = [];
  const listeners: WorkspaceProviderSetupUpdateListener[] = [];
  const unsubscribe = mock(() => undefined);
  let failCleanup = false;
  let loseReply = false;
  let selection: WorkspaceProviderSetupSelection = { kind: "none" };
  const discard = mock(async () => {
    await options.discard?.();
    if (failCleanup) throw new Error("Cleanup unavailable");
  });
  const pat = mock(async () => {
    await options.pat?.();
    return { status: "connected", account: "user" };
  });
  const code = {
    attemptId: crypto.randomUUID(),
    verificationUri: "https://microsoft.com/devicelogin",
    userCode: "CODE",
    expiresAt: "2099-01-01T00:00:00Z",
  };
  const client = createHostClient(async (command, args, schema) => {
    switch (command) {
      case "workspace_provider_setup_begin":
        ref.setupId = crypto.randomUUID();
        ref.repoPath = workspaceProviderSetupBeginSchema.parse(args).repoPath;
        ref.revision = 0;
        return schema.parse(ref);
      case "workspace_provider_setup_detect":
        return schema.parse(await detection);
      case "workspace_provider_setup_set": {
        const value = workspaceProviderSetupSetSchema.parse(args);
        if (value.revision !== ref.revision) throw new Error("Workspace setup changed");
        await options.selection?.();
        selections.push(value.selection);
        selection = value.selection;
        ref.revision += 1;
        if (loseReply) {
          loseReply = false;
          throw new Error("Configuration reply lost");
        }
        return schema.parse(ref);
      }
      case "workspace_provider_setup_status":
        await options.status;
        return schema.parse((await options.readStatus?.()) ?? { health: null, connection: null });
      case "workspace_provider_setup_progress":
        await options.progress?.();
        return schema.parse({
          ...ref,
          selection,
          progress: {
            workspace: null,
            registrationSaved: false,
            settingsSaved: false,
            credentialsSaved: false,
            phase: "validate",
            error: null,
          },
        });
      case "workspace_provider_setup_sign_in": {
        await options.signInStartup;
        const selection = selections.at(-1);
        const repository =
          selection?.kind === "configured" ? selection.config.repository : undefined;
        if (!repository || !("deployment" in repository))
          throw new Error("Azure identity required");
        const event = {
          setupId: ref.setupId,
          repoPath: ref.repoPath,
          revision: ref.revision,
          configurationFingerprint: azureDevOpsConnectionConfigurationFingerprint(
            ref.setupId,
            ref.repoPath,
            repository,
          ),
          attemptId: code.attemptId,
          state: { status: "connected", account: "user" },
        } satisfies HostEventPayload<"openducktor://workspace-provider-setup-updated">;
        if (options.signInEvent !== false) for (const listener of listeners) listener(event);
        return schema.parse(code);
      }
      case "workspace_provider_setup_discard":
        await discard();
        return schema.parse(undefined);
      case "workspace_provider_setup_areas":
        return schema.parse(options.areas ?? []);
      case "workspace_provider_setup_cancel_sign_in":
        return schema.parse(undefined);
      case "workspace_provider_setup_pat":
        return schema.parse(await pat());
      default:
        throw new Error(`Unexpected setup command ${command}`);
    }
  });
  const bridge = {
    ...hostBridge,
    client,
    subscribeWorkspaceProviderSetupUpdates: async (
      listener: WorkspaceProviderSetupUpdateListener,
    ) => {
      listeners.push(listener);
      return unsubscribe;
    },
  };
  const h = createHookHarness(
    () => useWorkspaceProviderSetup(bridge),
    {},
    { wrapper: ({ children }) => <QueryProvider useIsolatedClient>{children}</QueryProvider> },
  );
  return {
    h,
    bridge,
    ref,
    selections,
    listeners,
    unsubscribe,
    discard,
    pat,
    loseNextReply: () => {
      loseReply = true;
    },
    failCleanup: (value: boolean) => {
      failCleanup = value;
    },
  };
}
async function chooseAzure(f: ReturnType<typeof fixture>) {
  await f.h.run(async (state) => {
    await state.begin("/repo");
  });
  await f.h.run((state) =>
    state.update((draft) => ({
      ...draft,
      providerId: "azure_devops",
      azure: { ...draft.azure, organization: "org", project: "project", name: "repo" },
    })),
  );
  await f.h.waitFor((state) => state.pending === null);
}
describe("workspace provider draft ownership", () => {
  test.each([
    ["selection", "resolve"],
    ["selection", "reject"],
    ["PAT", "resolve"],
    ["PAT", "reject"],
    ["selection before PAT", "resolve"],
  ] as const)(
    "waits for the active %s write to %s before discarding an unmounted setup",
    async (write, outcome) => {
      const pending = Promise.withResolvers<void>();
      let started = false;
      const hold = () => {
        started = true;
        return pending.promise;
      };
      const f = fixture(undefined, write === "PAT" ? { pat: hold } : { selection: hold });
      let action: Promise<unknown> | undefined;
      await f.h.mount();
      try {
        await chooseAzure(f);
        await f.h.run((state) => {
          action = write === "selection" ? state.ensureSelection() : state.savePat();
        });
        await f.h.waitFor(() => started);
        await f.h.unmount();
        expect(f.discard).not.toHaveBeenCalled();
        await act(async () => {
          if (outcome === "resolve") pending.resolve();
          else pending.reject(new Error("Setup write failed"));
          await action?.catch(() => undefined);
        });
        await waitFor(() => expect(f.discard).toHaveBeenCalledTimes(1), { timeout: 200 });
        if (write === "selection before PAT") expect(f.pat).not.toHaveBeenCalled();
      } finally {
        pending.resolve();
        await action?.catch(() => undefined);
        await f.h.unmount();
      }
    },
  );
  test("discards immediately when unmounted during sign-in startup", async () => {
    const startup = Promise.withResolvers<void>();
    const f = fixture(undefined, { signInStartup: startup.promise });
    let signIn: Promise<unknown> | undefined;
    await f.h.mount();
    try {
      await chooseAzure(f);
      await f.h.run((state) => {
        signIn = state.startSignIn();
      });
      await f.h.waitFor((state) => state.isStartingSignIn);
      await f.h.unmount();
      expect(f.discard).toHaveBeenCalledTimes(1);
      expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      startup.resolve();
      await signIn;
      await f.h.unmount();
    }
  });
  test("keeps provider fields editable until an action sends the latest draft", async () => {
    const f = fixture(undefined, { readStatus: async () => ready });
    const view = render(
      <QueryProvider useIsolatedClient>
        <ProviderSetup bridge={f.bridge} />
      </QueryProvider>,
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Choose repo" }));
      await screen.findByLabelText("Selected repository path");
      fireEvent.click(screen.getByRole("radio", { name: "GitHub" }));
      const owner = screen.getByLabelText<HTMLInputElement>("Owner");
      const repository = screen.getByLabelText<HTMLInputElement>("Repository");
      for (const value of ["o", "ow", "owner"]) {
        expect(owner.disabled).toBe(false);
        fireEvent.change(owner, { target: { value } });
      }
      expect(repository.disabled).toBe(false);
      fireEvent.change(repository, { target: { value: "repo" } });
      expect(owner.value).toBe("owner");
      expect(f.selections).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Check provider readiness" }));
      await waitFor(() => expect(f.selections).toHaveLength(1));
      expect(f.selections[0]).toMatchObject({
        kind: "configured",
        config: { repository: { owner: "owner", name: "repo" } },
      });
    } finally {
      view.unmount();
    }
  });
  test("clears readiness when sign-in starts and when sign-in is cancelled", async () => {
    const f = fixture(undefined, {
      readStatus: async () => ({
        health: { ...ready.health!, providerId: "azure_devops" },
        connection: { status: "connected", account: "user" },
      }),
      signInEvent: false,
    });
    await f.h.mount();
    try {
      await chooseAzure(f);
      await f.h.run(async (state) => {
        expect(await state.check()).toBe(true);
      });
      await f.h.waitFor((state) => state.status?.health?.available === true);
      await f.h.run(async (state) => {
        await state.startSignIn();
      });
      expect(f.h.getLatest().connection.status).toBe("pending");
      expect(f.h.getLatest().status).toBeNull();
      await f.h.run(async (state) => {
        expect(await state.check()).toBe(true);
      });
      await f.h.waitFor((state) => state.status?.health?.available === true);
      await f.h.run(async (state) => {
        await state.cancelSignIn();
      });
      expect(f.h.getLatest().connection.status).toBe("disconnected");
      expect(f.h.getLatest().status).toBeNull();
    } finally {
      await f.h.unmount();
    }
  });
  test.each(["first", "later"] as const)(
    "recovers a lost %s configuration reply without dropping the draft",
    async (change) => {
      let failRecovery = true;
      const f = fixture(undefined, {
        readStatus: async () => ready,
        progress: async () => {
          if (failRecovery) throw new Error("Setup read failed");
        },
      });
      await f.h.mount();
      try {
        await f.h.run(async (state) => {
          await state.begin("/repo");
        });
        if (change === "later") {
          await f.h.run((state) =>
            state.update((draft) => ({
              ...draft,
              providerId: "github",
              github: { ...draft.github, owner: "old", name: "repo" },
            })),
          );
          await f.h.run(async (state) => {
            await state.check();
          });
        }
        f.loseNextReply();
        await f.h.run((state) =>
          state.update((draft) => ({
            ...draft,
            providerId: "github",
            github: { ...draft.github, owner: "edited", name: "repo" },
          })),
        );
        await f.h.run(async (state) => {
          await state.check();
        });
        expect(f.h.getLatest().error).toContain("Configuration reply lost");
        const draft = f.h.getLatest().draft;
        await f.h.run(async (state) => {
          expect(await state.skip()).toBeUndefined();
        });
        expect(f.h.getLatest().draft).toEqual(draft);
        await f.h.run(async (state) => {
          await state.recover();
        });
        expect(f.h.getLatest().error).toContain("Setup read failed");
        expect(f.h.getLatest().draft).toEqual(draft);
        failRecovery = false;
        await f.h.run(async (state) => {
          await state.recover();
        });
        expect(f.h.getLatest().session?.revision).toBe(f.ref.revision);
        expect(f.h.getLatest().error).toBeNull();
        expect(f.h.getLatest().draft).toEqual(draft);
        await f.h.run(async (state) => {
          expect(await state.check()).toBe(true);
        });
        await f.h.run(async (state) => {
          expect(await state.skip()).toBe(true);
        });
      } finally {
        await f.h.unmount();
      }
    },
  );
  test("hides readiness while refreshing and after failure, then shows the next successful check", async () => {
    let response = Promise.resolve(ready);
    const f = fixture(undefined, { readStatus: () => response });
    await f.h.mount();
    let check: Promise<unknown> | undefined;
    const refresh = Promise.withResolvers<WorkspaceProviderSetupStatus>();
    try {
      await f.h.run(async (state) => {
        await state.begin("/repo");
      });
      await f.h.run((state) =>
        state.update((draft) => ({
          ...draft,
          providerId: "github",
          github: { ...draft.github, owner: "owner", name: "repo" },
        })),
      );
      await f.h.waitFor((state) => state.pending === null);
      await f.h.run(async (state) => {
        expect(await state.check()).toBe(true);
      });
      await f.h.waitFor((state) => state.status?.health?.available === true);
      response = refresh.promise;
      await f.h.run((state) => {
        check = state.check();
      });
      expect(f.h.getLatest().status).toBeNull();
      await f.h.run(async () => {
        refresh.reject(new Error("Provider read failed"));
        await check;
      });
      expect(f.h.getLatest().status).toBeNull();
      expect(f.h.getLatest().error).toContain("Provider read failed");
      response = Promise.resolve(ready);
      await f.h.run(async (state) => {
        expect(await state.check()).toBe(true);
      });
      await f.h.waitFor((state) => state.status?.health?.available === true);
      expect(f.h.getLatest().error).toBeNull();
    } finally {
      await f.h.run(async () => {
        refresh.resolve(ready);
        await check;
      });
      await f.h.unmount();
    }
  });
  test("offers recovery on the provider screen and disables it during the read", async () => {
    const progress = Promise.withResolvers<void>();
    const f = fixture(undefined, { progress: () => progress.promise });
    const view = render(
      <QueryProvider useIsolatedClient>
        <ProviderSetup bridge={f.bridge} />
      </QueryProvider>,
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Choose repo" }));
      await waitFor(() =>
        expect(screen.getByLabelText("Selected repository path").textContent).toBe("/repo"),
      );
      f.loseNextReply();
      fireEvent.click(screen.getByRole("radio", { name: "GitHub" }));
      fireEvent.click(screen.getByRole("button", { name: "Check provider readiness" }));
      await screen.findByText(/Configuration reply lost/);
      fireEvent.change(screen.getByLabelText("Owner"), {
        target: { value: "kept" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Check provider readiness" }));
      await screen.findByText(/Workspace setup changed/);
      const recover = screen.getByRole<HTMLButtonElement>("button", { name: "Read setup state" });
      await act(async () => {
        fireEvent.click(recover);
      });
      expect(recover.disabled).toBe(true);
      await act(async () => {
        progress.resolve();
      });
      await waitFor(
        () => expect(view.queryByRole("button", { name: "Read setup state" }) === null).toBe(true),
        { timeout: 200 },
      );
      expect(screen.getByLabelText<HTMLInputElement>("Owner").value).toBe("kept");
    } finally {
      progress.resolve();
      view.unmount();
    }
  });
  test("shows and cancels a pending Microsoft sign-in in the shared Azure form", async () => {
    const f = fixture(undefined, { signInEvent: false });
    const view = render(
      <QueryProvider useIsolatedClient>
        <AzureSetup bridge={f.bridge} />
      </QueryProvider>,
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Choose repo" }));
      const signIn = await screen.findByRole<HTMLButtonElement>("button", {
        name: "Sign in with Microsoft",
      });
      await waitFor(() => expect(signIn.disabled).toBe(false));
      fireEvent.click(signIn);
      await screen.findByText("CODE");
      expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
      expect(
        screen.getByRole("link", { name: "Open Microsoft sign-in" }).getAttribute("href"),
      ).toBe("https://microsoft.com/devicelogin");
      fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
      await screen.findByRole("button", { name: "Sign in with Microsoft" });
      expect(view.queryByText("CODE")).toBeNull();
    } finally {
      view.unmount();
    }
  });
  test("can clear an optional Azure area before workspace creation", async () => {
    const f = fixture(undefined, {
      areas: ["Project", "Project\\Team"],
      readStatus: async () => ({
        health: null,
        connection: { status: "connected", account: "user" },
      }),
    });
    const view = render(
      <QueryProvider useIsolatedClient>
        <AzureSetup bridge={f.bridge} />
      </QueryProvider>,
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Choose repo" }));
      const signIn = await screen.findByRole<HTMLButtonElement>("button", {
        name: "Sign in with Microsoft",
      });
      await waitFor(() => expect(signIn.disabled).toBe(false));
      fireEvent.click(signIn);
      const reload = await screen.findByRole<HTMLButtonElement>("button", {
        name: "Reload area paths",
      });
      await waitFor(() => expect(reload.disabled).toBe(false));
      fireEvent.click(reload);
      const picker = await screen.findByRole<HTMLButtonElement>("button", { name: "Area path" });
      await waitFor(() => expect(picker.disabled).toBe(false));
      fireEvent.click(picker);
      fireEvent.click(await screen.findByRole("option", { name: "Project\\Team" }));
      await waitFor(() => expect(picker.textContent).toContain("Project\\Team"));
      fireEvent.click(screen.getByRole("button", { name: "Clear area" }));
      await waitFor(() => expect(picker.textContent).toContain("Choose an area path"));
      expect(view.queryByRole("button", { name: "Clear area" })).toBeNull();
    } finally {
      view.unmount();
    }
  });
  test.each(["resolve", "reject"] as const)(
    "cancels sign-in startup and ignores its late %s response",
    async (outcome) => {
      const startup = Promise.withResolvers<void>();
      const status = Promise.withResolvers<void>();
      const f = fixture(undefined, { signInStartup: startup.promise, status: status.promise });
      await f.h.mount();
      let signIn: Promise<unknown> | undefined;
      let check: Promise<unknown> | undefined;
      try {
        await chooseAzure(f);
        await f.h.run((state) => {
          signIn = state.startSignIn();
        });
        await f.h.waitFor(() => f.listeners.length === 1);
        const cancelledId = f.ref.setupId;
        await f.h.run(async (state) => {
          expect(await state.discard()).toBe(true);
        });
        expect(f.discard).toHaveBeenCalledTimes(1);
        expect(f.h.getLatest().session).toBeNull();
        expect(f.h.getLatest().pending).toBeNull();
        expect(f.unsubscribe).toHaveBeenCalledTimes(1);
        await f.h.run(async (state) => {
          await state.begin("/another-repo");
        });
        expect(f.h.getLatest().session?.setupId).not.toBe(cancelledId);
        await f.h.run((state) => {
          check = state.check();
        });
        await f.h.run(async () => {
          if (outcome === "resolve") startup.resolve();
          else startup.reject(new Error("Old sign-in was cancelled"));
          await signIn;
        });
        expect(f.h.getLatest().session).not.toBeNull();
        expect(f.h.getLatest().connection).toEqual({ status: "disconnected" });
        expect(f.h.getLatest().pending).toBe("Check provider readiness");
        expect(f.h.getLatest().error).toBeNull();
        await f.h.run(async () => {
          status.resolve();
          await check;
        });
        expect(f.h.getLatest().pending).toBeNull();
      } finally {
        await f.h.run(async () => {
          startup.resolve();
          status.resolve();
          await signIn;
          await check;
        });
        await f.h.unmount();
      }
    },
  );
  test("retains startup ownership after cleanup fails and blocks duplicate cancellation", async () => {
    const startup = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const f = fixture(undefined, {
      signInStartup: startup.promise,
      discard: () => cleanup.promise,
    });
    await f.h.mount();
    let signIn: Promise<unknown> | undefined;
    let cancellation: Promise<boolean> | undefined;
    try {
      await chooseAzure(f);
      await f.h.run((state) => {
        signIn = state.startSignIn();
      });
      await f.h.waitFor(() => f.listeners.length === 1);
      f.failCleanup(true);
      await f.h.run((state) => {
        cancellation = state.discard();
      });
      await f.h.run(async (state) => {
        expect(await state.discard()).toBe(false);
        cleanup.resolve();
        expect(await cancellation).toBe(false);
      });
      expect(f.discard).toHaveBeenCalledTimes(1);
      expect(f.h.getLatest().session?.setupId).toBe(f.ref.setupId);
      expect(f.h.getLatest().error).toContain("Cleanup unavailable");
      expect(f.unsubscribe).not.toHaveBeenCalled();
      f.failCleanup(false);
      await f.h.run(async (state) => {
        expect(await state.discard()).toBe(true);
        startup.resolve();
        await signIn;
      });
      expect(f.discard).toHaveBeenCalledTimes(2);
      expect(f.h.getLatest().session).toBeNull();
      expect(f.h.getLatest().error).toBeNull();
    } finally {
      f.failCleanup(false);
      await f.h.run(async () => {
        cleanup.resolve();
        startup.resolve();
        await signIn;
        await cancellation;
      });
      await f.h.unmount();
    }
  });
  test("preserves manual identity and disabled state when detection is retried", async () => {
    const f = fixture(
      Promise.resolve({
        outcome: "detected",
        candidates: [{ config: github, remoteNames: ["origin"] }],
      }),
    );
    await f.h.mount();
    try {
      await f.h.run(async (state) => {
        await state.begin("/repo");
      });
      await f.h.waitFor((state) => !state.detecting);
      await f.h.run((state) =>
        state.update((draft) => ({
          ...draft,
          github: { host: "enterprise.example.test", owner: "manual", name: "custom" },
          enabled: false,
        })),
      );
      await f.h.waitFor((state) => state.pending === null);
      await f.h.run(async (state) => {
        await state.retryDetection();
      });
      expect(f.h.getLatest().draft).toMatchObject({
        providerId: "github",
        enabled: false,
        github: { host: "enterprise.example.test", owner: "manual", name: "custom" },
      });
      expect(f.h.getLatest().detection?.outcome).toBe("detected");
      expect(f.h.getLatest().detectionProposal).toBe(true);
      await f.h.run(async (state) => {
        await state.acceptDetection();
      });
      expect(f.h.getLatest().draft).toMatchObject({
        enabled: false,
        autoDetected: true,
        github: { host: "github.com", owner: "detected", name: "repo" },
      });
      expect(f.h.getLatest().detectionProposal).toBe(false);
    } finally {
      await f.h.unmount();
    }
  });
  test("keeps manual input when detection finishes late and reports a Git failure separately", async () => {
    const detection = Promise.withResolvers<WorkspaceProviderSetupDetection>();
    const f = fixture(detection.promise);
    await f.h.mount();
    try {
      await f.h.run(async (state) => {
        await state.begin("/repo");
      });
      await f.h.run((state) =>
        state.update((draft) => ({
          ...draft,
          providerId: "github",
          github: { host: "enterprise.example.test", owner: "manual", name: "repo" },
        })),
      );
      await f.h.run(async () => {
        detection.resolve({
          outcome: "detected",
          candidates: [{ config: github, remoteNames: ["origin"] }],
        });
      });
      await f.h.waitFor((state) => !state.detecting);
      expect(f.h.getLatest().draft.github.owner).toBe("manual");
      expect(f.h.getLatest().draft.autoDetected).toBe(false);
      expect(f.h.getLatest().detection?.outcome).toBe("detected");
    } finally {
      await f.h.unmount();
    }
    const failure = Promise.withResolvers<WorkspaceProviderSetupDetection>();
    const failed = fixture(failure.promise);
    await failed.h.mount();
    try {
      await failed.h.run(async (state) => {
        await state.begin("/repo");
      });
      await failed.h.run(async () => {
        failure.reject(new Error("Git endpoint read failed"));
      });
      await failed.h.waitFor((state) => !state.detecting);
      expect(failed.h.getLatest().detection).toBeNull();
      expect(failed.h.getLatest().detectionError).toContain("Git endpoint read failed");
      await failed.h.run(async (state) => {
        await state.skip();
      });
      expect(failed.h.getLatest().draft.providerId).toBeNull();
    } finally {
      await failed.h.unmount();
    }
  });
  test("sends incomplete input before an action can use the last valid provider snapshot", async () => {
    const f = fixture();
    await f.h.mount();
    try {
      await f.h.run(async (state) => {
        await state.begin("/repo");
      });
      await f.h.run((state) =>
        state.update((draft) => ({
          ...draft,
          providerId: "github",
          github: { host: "github.com", owner: "owner", name: "repo" },
        })),
      );
      await f.h.run(async (state) => {
        await state.check();
      });
      expect(f.selections.at(-1)?.kind).toBe("configured");
      await f.h.run((state) =>
        state.update((draft) => ({ ...draft, github: { ...draft.github, name: "" } })),
      );
      expect(f.h.getLatest().draft.github.name).toBe("");
      expect(f.h.getLatest().errors["repository.name"]).toBeTruthy();
      await f.h.run(async (state) => {
        await state.check();
      });
      expect(f.selections.at(-1)).toEqual({ kind: "incomplete", providerId: "github" });
      expect(f.h.getLatest().error).toContain("Correct the provider fields");
    } finally {
      await f.h.unmount();
    }
  });
  test("retains an early terminal sign-in event and requires successful cleanup before leaving", async () => {
    const f = fixture();
    await f.h.mount();
    try {
      await chooseAzure(f);
      await f.h.run(async (state) => {
        await state.startSignIn();
      });
      expect(f.h.getLatest().connection).toEqual({ status: "connected", account: "user" });
      f.failCleanup(true);
      await f.h.run(async (state) => {
        expect(await state.discard()).toBe(false);
      });
      expect(f.h.getLatest().session?.setupId).toBe(f.ref.setupId);
      expect(f.h.getLatest().error).toContain("Cleanup unavailable");
      f.failCleanup(false);
      await f.h.run(async (state) => {
        expect(await state.discard()).toBe(true);
      });
      expect(f.h.getLatest().session).toBeNull();
      expect(f.unsubscribe).toHaveBeenCalled();
    } finally {
      await f.h.unmount();
    }
  });
  test("disabled identities remain optional but partly entered fields require correction", () => {
    const draft = {
      ...emptyWorkspaceProviderDraft(),
      providerId: "github" as const,
      enabled: false,
    };
    expect(parseWorkspaceProviderDraft(draft).selection.kind).toBe("configured");
    expect(
      parseWorkspaceProviderDraft({ ...draft, github: { ...draft.github, owner: "owner" } })
        .selection.kind,
    ).toBe("incomplete");
    expect(
      parseWorkspaceProviderDraft({
        ...draft,
        github: { ...draft.github, host: "https://github.com" },
      }).errors["repository.host"],
    ).toBeTruthy();
    const azure = {
      ...draft,
      providerId: "azure_devops" as const,
      azure: { ...draft.azure, deployment: "server" as const, serviceUrl: "" },
    };
    expect(parseWorkspaceProviderDraft(azure).selection.kind).toBe("configured");
    expect(
      parseWorkspaceProviderDraft({
        ...azure,
        azure: { ...azure.azure, serviceUrl: "https://ado.example.test" },
      }).selection.kind,
    ).toBe("incomplete");
  });
});

function AzureSetup({ bridge }: { bridge: typeof hostBridge }) {
  const provider = useWorkspaceProviderSetup(bridge);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          await provider.begin("/repo");
          provider.update((draft) => ({
            ...draft,
            providerId: "azure_devops",
            azure: { ...draft.azure, organization: "org", project: "Project", name: "repo" },
          }));
        }}
      >
        Choose repo
      </button>
      <WorkspaceProviderFields provider={provider} disabled={false} />
    </>
  );
}

function ProviderSetup({ bridge }: { bridge: typeof hostBridge }) {
  const provider = useWorkspaceProviderSetup(bridge);
  return (
    <>
      <button type="button" onClick={() => void provider.begin("/repo")}>
        Choose repo
      </button>
      <button type="button" onClick={() => void provider.check()}>
        Check provider readiness
      </button>
      <WorkspaceProviderFields provider={provider} disabled={false} />
    </>
  );
}

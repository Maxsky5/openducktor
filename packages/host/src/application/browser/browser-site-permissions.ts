import type {
  BrowserPermissionDecision,
  BrowserPermissionKind,
  BrowserSitePermissionsResponse,
} from "@openducktor/contracts";
import { BROWSER_PERMISSION_KINDS } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSerialGate } from "../../effect/serial-gate";
import type { BrowserEnginePort } from "../../ports/browser-engine-port";
import type {
  BrowserSitePermissionFile,
  BrowserSitePermissionPort,
} from "../../ports/browser-site-permission-port";
import { BrowserServiceError } from "./browser-service-error";

const storeFailure = (operation: string, cause: { readonly message: string }) =>
  new BrowserServiceError({
    code: "browser_action_failed",
    operation,
    message: `Could not access saved site permissions: ${cause.message}`,
    cause,
  });

/**
 * Saved site permission choices of each workspace, kept with its browser data. Every read, answer,
 * and change of a workspace runs in one order. An answer that comes before a reset therefore
 * reaches the engine before the reset ends the live grants, and no read that started before a
 * change can bring back an old choice.
 */
export const createBrowserSitePermissions = (
  port: BrowserSitePermissionPort,
  engine: Pick<BrowserEnginePort, "revokeSitePermissions">,
) => {
  const files = new Map<string, BrowserSitePermissionFile>();
  const gate = createSerialGate();

  /** Runs only inside the gate of the workspace. */
  const load = (workspaceId: string) =>
    Effect.suspend(() => {
      const cached = files.get(workspaceId);
      if (cached) {
        return Effect.succeed(cached);
      }
      return port.read(workspaceId).pipe(
        Effect.tap((file) => Effect.sync(() => files.set(workspaceId, file))),
        Effect.mapError((cause) => storeFailure("browser.site_permissions.read", cause)),
      );
    });

  /** Runs only inside the gate of the workspace. */
  const write = (
    workspaceId: string,
    update: (file: BrowserSitePermissionFile) => BrowserSitePermissionFile,
  ) =>
    Effect.gen(function* () {
      const next = update(yield* load(workspaceId));
      yield* port
        .write(workspaceId, next)
        .pipe(Effect.mapError((cause) => storeFailure("browser.site_permissions.write", cause)));
      files.set(workspaceId, next);
    });

  /**
   * Answers a request from the saved choice of the site. Returns false when the site has no saved
   * choice, so the caller asks the user.
   */
  const answerFromSaved = (
    workspaceId: string,
    origin: string,
    permission: BrowserPermissionKind,
    respond: (granted: boolean) => void,
  ): Effect.Effect<boolean, BrowserServiceError> =>
    gate.run(
      workspaceId,
      load(workspaceId).pipe(
        Effect.map((file) => {
          const saved: BrowserPermissionDecision | undefined = file.sites[origin]?.[permission];
          if (saved === undefined) {
            return false;
          }
          respond(saved === "granted");
          return true;
        }),
      ),
    );

  /**
   * Gives the answer of the user to the engine, then saves it for the site. Nothing happens when
   * `isCurrent` says that the request ended while the answer waited for its turn.
   */
  const answerAndSave = (
    workspaceId: string,
    origin: string,
    permission: BrowserPermissionKind,
    granted: boolean,
    respond: (granted: boolean) => void,
    isCurrent: () => boolean,
  ) =>
    gate.run(
      workspaceId,
      Effect.suspend(() => {
        if (!isCurrent()) return Effect.void;
        respond(granted);
        return write(workspaceId, (file) => ({
          ...file,
          sites: {
            ...file.sites,
            [origin]: { ...file.sites[origin], [permission]: granted ? "granted" : "denied" },
          },
        }));
      }),
    );

  const read = (
    workspaceId: string,
    origin: string,
  ): Effect.Effect<BrowserSitePermissionsResponse, BrowserServiceError> =>
    gate.run(
      workspaceId,
      load(workspaceId).pipe(
        Effect.map((file) => {
          const saved = file.sites[origin] ?? {};
          return {
            origin,
            permissions: BROWSER_PERMISSION_KINDS.flatMap((permission) => {
              const value = saved[permission];
              return value === undefined ? [] : [{ permission, decision: value }];
            }),
          };
        }),
      ),
    );

  /**
   * Ends the live engine grants of the site, then removes its saved choices. A failed engine call
   * keeps the saved choices, so the site menu never shows a cleared choice that still works.
   */
  const reset = (workspaceId: string, origin: string, permission: BrowserPermissionKind | null) =>
    gate.run(
      workspaceId,
      engine.revokeSitePermissions(workspaceId, origin, permission).pipe(
        Effect.mapError(
          (cause) =>
            new BrowserServiceError({
              code: "browser_engine_error",
              operation: "browser.site_permissions.reset",
              message: `The browser could not reset the site permissions: ${cause.message}`,
              cause,
            }),
        ),
        Effect.andThen(
          write(workspaceId, (file) => {
            const sites = { ...file.sites };
            const saved = sites[origin];
            if (saved === undefined) {
              return file;
            }
            if (permission === null) {
              delete sites[origin];
            } else {
              const rest = { ...saved };
              delete rest[permission];
              if (Object.keys(rest).length === 0) {
                delete sites[origin];
              } else {
                sites[origin] = rest;
              }
            }
            return { ...file, sites };
          }),
        ),
      ),
    );

  const removeWorkspace = (workspaceId: string) =>
    gate.run(
      workspaceId,
      port.remove(workspaceId).pipe(
        Effect.tap(() => Effect.sync(() => files.delete(workspaceId))),
        Effect.mapError((cause) => storeFailure("browser.site_permissions.remove", cause)),
      ),
    );

  return { answerFromSaved, answerAndSave, read, reset, removeWorkspace };
};

export type BrowserSitePermissions = ReturnType<typeof createBrowserSitePermissions>;

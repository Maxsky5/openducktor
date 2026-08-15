import { Effect } from "effect";
import {
  type ElectronError,
  ElectronLifecycleError,
  errorMessage,
  isElectronError,
} from "../effect/electron-errors";
import {
  configureElectronAppIdentity,
  type ElectronProfileKind,
  resolveElectronProfileKind,
} from "./electron-app-identity";

const DEVELOPMENT_INSTANCE_CONFLICT_MESSAGE =
  "OpenDucktor Electron development is already running for this worktree.";

type ElectronDevelopmentInstanceLogger = {
  info(message: string): Effect.Effect<void, unknown>;
};

type ClaimElectronDevelopmentInstanceOptions = {
  logger: ElectronDevelopmentInstanceLogger;
  profileKind: ElectronProfileKind;
  requestSingleInstanceLock(): boolean;
};

type ElectronDevelopmentInstanceApp = {
  isPackaged: boolean;
  requestSingleInstanceLock(): boolean;
  setName(name: string): void;
  setPath(name: "userData" | "sessionData", value: string): void;
};

type PrepareElectronDevelopmentInstanceOptions = {
  app: ElectronDevelopmentInstanceApp;
  appName: string;
  logger: ElectronDevelopmentInstanceLogger;
  processEnv?: NodeJS.ProcessEnv;
};

export type ElectronDevelopmentInstanceClaim = "duplicate" | "primary";

export const claimElectronDevelopmentInstanceEffect = ({
  logger,
  profileKind,
  requestSingleInstanceLock,
}: ClaimElectronDevelopmentInstanceOptions): Effect.Effect<
  ElectronDevelopmentInstanceClaim,
  ElectronLifecycleError
> =>
  Effect.gen(function* () {
    if (profileKind === "production") {
      return "primary";
    }

    const claimed = yield* Effect.try({
      try: requestSingleInstanceLock,
      catch: (cause) =>
        new ElectronLifecycleError({
          operation: "electron.main.claim-development-instance",
          message: errorMessage(cause),
          cause,
        }),
    });
    if (claimed) {
      return "primary";
    }

    yield* logger.info(DEVELOPMENT_INSTANCE_CONFLICT_MESSAGE).pipe(
      Effect.mapError(
        (cause) =>
          new ElectronLifecycleError({
            operation: "electron.main.log-development-instance-conflict",
            message: errorMessage(cause),
            cause,
          }),
      ),
    );
    return "duplicate";
  });

export const prepareElectronDevelopmentInstanceEffect = ({
  app,
  appName,
  logger,
  processEnv,
}: PrepareElectronDevelopmentInstanceOptions): Effect.Effect<
  ElectronDevelopmentInstanceClaim,
  ElectronError
> =>
  Effect.gen(function* () {
    const profileKind = resolveElectronProfileKind(app.isPackaged);
    yield* Effect.try({
      try: () =>
        configureElectronAppIdentity(app, {
          appName,
          profileKind,
          ...(processEnv === undefined ? {} : { processEnv }),
        }),
      catch: (cause) =>
        isElectronError(cause)
          ? cause
          : new ElectronLifecycleError({
              operation: "electron.main.configure-app-identity",
              message: errorMessage(cause),
              cause,
            }),
    });
    return yield* claimElectronDevelopmentInstanceEffect({
      logger,
      profileKind,
      requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    });
  });

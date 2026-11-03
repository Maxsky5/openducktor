import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { remoteClientKindSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { validateDevelopmentInstanceId } from "../../config/development-instance";
import {
  HostOperationError,
  hasNestedNodeErrorCode as isCode,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  RemoteApprovalStore,
  RemoteClientApproval,
  RemoteApprovalStorePort,
  RemoteHostOwner,
} from "../../ports/remote-approval-store";

const approvalSchema = z.strictObject({
  clientId: z.uuid(),
  clientKind: remoteClientKindSchema,
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const identitySchema = z.strictObject({ version: z.literal(1), hostId: z.uuid() });
const clientIdSchema = z.uuid();
const APPROVAL_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const readOptional = async (file: string): Promise<string | null> => {
  try {
    return await readFile(file, "utf8");
  } catch (cause) {
    if (isCode(cause, "ENOENT")) return null;
    throw cause;
  }
};
const syncDirectory = async (directory: string) => {
  // Windows does not support opening directories for fsync. File publication still uses a synced file.
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const publishNew = async (
  file: string,
  value: RemoteClientApproval | z.infer<typeof identitySchema>,
) => {
  const temporary = `${file}.${randomUUID()}.publishing`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally {
    await unlink(temporary);
  }
};

export const remoteHostOwnerFromEnvironment = (
  shell: RemoteHostOwner["shell"],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RemoteHostOwner => {
  const owner: RemoteHostOwner = {
    shell,
    profile: environment.OPENDUCKTOR_HOST_PROFILE ?? "default",
  };
  if (environment.OPENDUCKTOR_DEV_INSTANCE !== undefined)
    owner.developmentInstanceId = validateDevelopmentInstanceId(
      environment.OPENDUCKTOR_DEV_INSTANCE,
    );
  return owner;
};

/**
 * Opens the approvals of one host scope. Each approval is its own file and every check reads it from
 * disk, so hosts that share a scope see the same approvals. Approval records never share settings
 * writes.
 */
export const createFilesystemRemoteApprovalStore = (
  configRoot: string,
): RemoteApprovalStorePort => ({
  open: (owner) =>
    Effect.gen(function* () {
      const parsed = yield* Effect.try({
        try: () =>
          z
            .strictObject({
              shell: z.enum(["electron", "web"]),
              developmentInstanceId: z.string().optional(),
              profile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
            })
            .parse(owner),
        catch: () =>
          new HostOperationError({
            operation: "remoteApproval.scope",
            message: "OPENDUCKTOR_HOST_PROFILE must match [a-z0-9][a-z0-9_-]{0,63}.",
          }),
      });
      if (parsed.developmentInstanceId) validateDevelopmentInstanceId(parsed.developmentInstanceId);
      const key = JSON.stringify([
        parsed.shell,
        parsed.developmentInstanceId ?? null,
        parsed.profile,
      ]);
      const directory = path.join(
        configRoot,
        "remote-access",
        "hosts",
        Buffer.from(key).toString("base64url"),
      );
      return yield* Effect.tryPromise({
        try: async (): Promise<RemoteApprovalStore> => {
          const clients = path.join(directory, "clients");
          const identityFile = path.join(directory, "identity.json");
          const [names, identityText] = await Promise.all([
            readdir(clients).catch((cause: unknown) => {
              if (!isCode(cause, "ENOENT")) throw cause;
              return [];
            }),
            readOptional(identityFile),
          ]);
          if (identityText === null && names.some((name) => APPROVAL_FILE.test(name)))
            throw new Error(
              "The host identity is missing while saved approvals exist. Restore identity.json from a backup.",
            );
          await mkdir(clients, { recursive: true, mode: 0o700 });
          const parseIdentity = (text: string) => identitySchema.parse(JSON.parse(text));
          let identity = identityText === null ? null : parseIdentity(identityText);
          if (!identity) {
            const created = { version: 1 as const, hostId: randomUUID() };
            try {
              await publishNew(identityFile, created);
              identity = created;
            } catch (cause) {
              // Another host of this scope created the identity first. Both use that identity.
              if (!isCode(cause, "EEXIST")) throw cause;
              identity = parseIdentity(await readFile(identityFile, "utf8"));
            }
          }
          const file = (id: string) => path.join(clients, `${clientIdSchema.parse(id)}.json`);
          const io = <A>(operation: () => Promise<A>) =>
            Effect.tryPromise({
              try: operation,
              catch: (cause) => toHostOperationError(cause, "remoteApproval.storage"),
            });
          const read = async (id: string) => {
            const text = await readOptional(file(id));
            if (text === null) return null;
            const approval = approvalSchema.parse(JSON.parse(text));
            if (approval.clientId !== id)
              throw new Error("The saved approval does not match its filename.");
            return approval;
          };
          return {
            hostId: identity.hostId,
            read: (id) => io(() => read(id)),
            list: () =>
              io(async () => {
                // Skip files that the store did not write, such as .DS_Store or a publishing copy.
                const ids = (await readdir(clients)).flatMap((name) => {
                  const clientId = APPROVAL_FILE.exec(name)?.[1];
                  return clientId ? [clientId] : [];
                });
                const records = await Promise.all(ids.map(read));
                return records.filter((record) => record !== null);
              }),
            create: (approval) =>
              io(() => publishNew(file(approval.clientId), approvalSchema.parse(approval))),
            revoke: (id) =>
              io(async () => {
                try {
                  await unlink(file(id));
                } catch (cause) {
                  if (!isCode(cause, "ENOENT")) throw cause;
                }
                await syncDirectory(clients);
              }),
          };
        },
        catch: (cause) => toHostOperationError(cause, "remoteApproval.storage"),
      });
    }),
});

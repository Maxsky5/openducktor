import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import { toHostOperationError } from "../../../effect/host-errors";

const credentialScopeSchema = z.strictObject({
  scope: z.string().min(1),
  deployment: z.enum(["services", "server"]),
});

export type AzureDevOpsCredentialScope = z.infer<typeof credentialScopeSchema>;

export type AzureDevOpsCredentialIndex = {
  register(
    workspaceId: string,
    credential: AzureDevOpsCredentialScope,
  ): Effect.Effect<void, ReturnType<typeof toHostOperationError>>;
  list(
    workspaceId: string,
  ): Effect.Effect<AzureDevOpsCredentialScope[], ReturnType<typeof toHostOperationError>>;
  forget(
    workspaceId: string,
    scope: string,
  ): Effect.Effect<void, ReturnType<typeof toHostOperationError>>;
};

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const hasErrorCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;

export const createAzureDevOpsCredentialIndex = ({
  configDir,
}: {
  configDir: string;
}): AzureDevOpsCredentialIndex => {
  const directory = path.join(configDir, "credentials", "azure-devops", "workspace-scopes");
  const workspaceDirectory = (workspaceId: string) => path.join(directory, hash(workspaceId));
  const markerPath = (workspaceId: string, scope: string) =>
    path.join(workspaceDirectory(workspaceId), `${hash(scope)}.json`);

  return {
    register(workspaceId, credential) {
      return Effect.tryPromise({
        try: async () => {
          if (!credential.scope.startsWith(`${workspaceId}\n`)) {
            throw new Error("Azure DevOps credential scope does not match the workspace.");
          }
          await mkdir(workspaceDirectory(workspaceId), { recursive: true, mode: 0o700 });
          const target = markerPath(workspaceId, credential.scope);
          const temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, JSON.stringify(credential), { flag: "wx", mode: 0o600 });
            await rename(temporary, target);
          } finally {
            await rm(temporary, { force: true });
          }
        },
        catch: (cause) =>
          toHostOperationError(cause, "azureDevOps.credentials.registerScope", {
            message: "Failed to record the Azure DevOps credential scope. Retry the connection.",
          }),
      });
    },
    list(workspaceId) {
      return Effect.tryPromise({
        try: async () => {
          let names: string[];
          try {
            names = await readdir(workspaceDirectory(workspaceId));
          } catch (cause) {
            if (hasErrorCode(cause, "ENOENT")) return [];
            throw cause;
          }
          const credentials: AzureDevOpsCredentialScope[] = [];
          for (const name of names.filter((entry) => entry.endsWith(".json"))) {
            const credential = credentialScopeSchema.parse(
              JSON.parse(await readFile(path.join(workspaceDirectory(workspaceId), name), "utf8")),
            );
            if (
              !credential.scope.startsWith(`${workspaceId}\n`) ||
              name !== `${hash(credential.scope)}.json`
            ) {
              throw new Error("Azure DevOps credential index has an invalid workspace scope.");
            }
            credentials.push(credential);
          }
          return credentials;
        },
        catch: (cause) =>
          toHostOperationError(cause, "azureDevOps.credentials.listScopes", {
            message: "Failed to read Azure DevOps credential scopes. Retry workspace removal.",
          }),
      });
    },
    forget(workspaceId, scope) {
      return Effect.tryPromise({
        try: async () => {
          try {
            await unlink(markerPath(workspaceId, scope));
          } catch (cause) {
            if (!hasErrorCode(cause, "ENOENT")) throw cause;
          }
          try {
            await rmdir(workspaceDirectory(workspaceId));
          } catch (cause) {
            if (!hasErrorCode(cause, "ENOENT") && !hasErrorCode(cause, "ENOTEMPTY")) throw cause;
          }
        },
        catch: (cause) =>
          toHostOperationError(cause, "azureDevOps.credentials.forgetScope", {
            message: "Failed to remove the Azure DevOps credential index. Retry workspace removal.",
          }),
      });
    },
  };
};

import { z } from "zod";

export const azureDevOpsDeploymentSchema = z.enum(["services", "server"]);
export type AzureDevOpsDeployment = z.infer<typeof azureDevOpsDeploymentSchema>;

export const azureDevOpsRepositorySchema = z
  .object({
    providerId: z.literal("azure_devops"),
    deployment: azureDevOpsDeploymentSchema,
    serviceUrl: z.string().url(),
    organization: z.string().trim().min(1),
    project: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .strict()
  .superRefine((repository, context) => {
    const rawPath = repository.serviceUrl.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*([^?#]*)/iu)?.[1];
    let unsafePath = repository.serviceUrl.includes("\\") || rawPath === undefined;
    for (const segment of rawPath?.split("/") ?? []) {
      try {
        const decoded = decodeURIComponent(segment);
        if (
          decoded === "." ||
          decoded === ".." ||
          decoded.includes("/") ||
          decoded.includes("\\") ||
          decoded.includes("%")
        ) {
          unsafePath = true;
        }
      } catch {
        unsafePath = true;
      }
    }
    if (unsafePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Azure DevOps service address contains an unsafe path.",
        path: ["serviceUrl"],
      });
    }
    let serviceUrl: URL;
    try {
      serviceUrl = new URL(repository.serviceUrl);
    } catch {
      return;
    }
    if (
      !["http:", "https:"].includes(serviceUrl.protocol) ||
      serviceUrl.username ||
      serviceUrl.password ||
      serviceUrl.search ||
      serviceUrl.hash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "The Azure DevOps service address must use HTTP or HTTPS without credentials, a query, or a fragment.",
        path: ["serviceUrl"],
      });
    }
    if (
      repository.deployment === "services" &&
      (serviceUrl.protocol !== "https:" ||
        serviceUrl.hostname.toLowerCase() !== "dev.azure.com" ||
        serviceUrl.pathname.replace(/\/+$/u, "") !== "")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Azure DevOps Services must use https://dev.azure.com as its service address.",
        path: ["serviceUrl"],
      });
    }
  });
export type AzureDevOpsRepository = z.infer<typeof azureDevOpsRepositorySchema>;

export const azureDevOpsRemoteMappingSchema = z
  .object({
    remoteName: z.string().trim().min(1),
    fetchUrl: z.string().trim().min(1),
    pushUrls: z.array(z.string().trim().min(1)).min(1),
    repository: azureDevOpsRepositorySchema,
  })
  .strict();
export type AzureDevOpsRemoteMapping = z.infer<typeof azureDevOpsRemoteMappingSchema>;

export const azureDevOpsProviderSettingsSchema = z
  .object({
    remoteMappings: z.array(azureDevOpsRemoteMappingSchema).optional(),
    httpConsentCollectionUrl: z.string().url().optional(),
    areaPath: z.string().trim().min(1).optional(),
  })
  .strict();
export type AzureDevOpsProviderSettings = z.infer<typeof azureDevOpsProviderSettingsSchema>;

export const validateAzureDevOpsProviderSettings = (
  repository: AzureDevOpsRepository | undefined,
  settings: AzureDevOpsProviderSettings | undefined,
  context: z.RefinementCtx,
): void => {
  if (!repository && settings?.remoteMappings?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Azure DevOps remote mappings require a repository.",
      path: ["settings", "remoteMappings"],
    });
  }
  if (!repository) return;

  const remoteNames = new Set<string>();
  for (const [index, mapping] of (settings?.remoteMappings ?? []).entries()) {
    if (remoteNames.has(mapping.remoteName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each Azure DevOps remote mapping must use a different remote name.",
        path: ["settings", "remoteMappings", index, "remoteName"],
      });
    }
    remoteNames.add(mapping.remoteName);
    if (
      mapping.repository.deployment !== repository.deployment ||
      mapping.repository.serviceUrl !== repository.serviceUrl ||
      mapping.repository.organization !== repository.organization ||
      mapping.repository.project !== repository.project ||
      mapping.repository.name !== repository.name
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The remote mapping must use the configured Azure DevOps repository.",
        path: ["settings", "remoteMappings", index, "repository"],
      });
    }
  }
};

export const azureDevOpsDeviceCodeSchema = z
  .object({
    attemptId: z.string().uuid(),
    verificationUri: z.string().url(),
    userCode: z.string().min(1),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type AzureDevOpsDeviceCode = z.infer<typeof azureDevOpsDeviceCodeSchema>;

export const azureDevOpsConnectionStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("disconnected") }).strict(),
  z
    .object({
      status: z.literal("pending"),
      deviceCode: azureDevOpsDeviceCodeSchema,
    })
    .strict(),
  z.object({ status: z.literal("connected"), account: z.string().nullable() }).strict(),
  z.object({ status: z.literal("error"), reason: z.string().min(1) }).strict(),
]);
export type AzureDevOpsConnectionState = z.infer<typeof azureDevOpsConnectionStateSchema>;

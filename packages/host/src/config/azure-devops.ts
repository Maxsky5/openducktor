const DEFAULT_AZURE_DEVOPS_ENTRA_CLIENT_ID = "bac43573-dc2b-4b13-b536-8ea09b9c8816";

export const resolveAzureDevOpsEntraClientId = (processEnv: NodeJS.ProcessEnv): string => {
  const override = processEnv.OPENDUCKTOR_AZURE_DEVOPS_CLIENT_ID;
  return override === undefined ? DEFAULT_AZURE_DEVOPS_ENTRA_CLIENT_ID : override.trim();
};

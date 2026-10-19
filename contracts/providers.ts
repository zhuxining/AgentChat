/** Shared JSON wire contract; contains references and never resolved credentials. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type CredentialSource =
  | { type: "keyring"; entry: string }
  | { type: "env"; variable: string }
  | { type: "file"; path: string; entry: string };
export type ProviderAuthentication =
  | { type: "apiKey"; source: CredentialSource }
  | { type: "oauth"; source: { type: "keyring"; entry: string } }
  | { type: "ambient" };
/** Values in headers must be public literals or ${credential:entry} references. */
export type ProviderInstance = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  baseUrl?: string;
  headers?: Record<string, string>;
  auth: ProviderAuthentication;
  /** Non-secret supplier configuration, e.g. AWS_REGION or GOOGLE_CLOUD_PROJECT. */
  parameters?: Record<string, string>;
  visibleModels: string[];
  modelOverrides: Record<string, { [key: string]: Json }>;
  customModels: { [key: string]: Json }[];
};
export type ProviderCatalogEntry = {
  type: string;
  name: string;
  authentication: ("apiKey" | "oauth" | "ambient")[];
  modelCount: number;
  apis: string[];
};
export type ProviderInstanceStatus = {
  instance: ProviderInstance;
  configured: boolean;
  status: "configured" | "missing" | "disabled" | "error";
  message?: string;
};
export type ProviderModel = {
  id: string;
  name: string;
  custom: boolean;
  overridden: boolean;
  visible: boolean;
  definition: { [key: string]: Json };
  defaults?: { [key: string]: Json };
};
export type ProviderReference = {
  kind: "bot" | "conversation" | "defaults";
  id: string;
  modelId: string;
};
export type ProviderTestResult = {
  instanceId: string;
  modelId: string;
  version: string;
  testedAt: string;
  success: boolean;
  category?: "credential" | "authentication" | "network" | "protocol" | "model";
  message: string;
};
export type ProviderLogin = {
  id: string;
  instanceId: string;
  status: "pending" | "success" | "cancelled" | "error";
  url?: string;
  instructions?: string;
  prompt?: {
    type: "text" | "secret" | "select" | "manual_code";
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
    options?: { id: string; label: string; description?: string }[];
  };
  progress?: string;
  error?: string;
};
export type ProviderRequest =
  | { action: "list"; instanceId?: string; type?: string; search?: string }
  | { action: "save"; expectedVersion: string; instance: ProviderInstance }
  | { action: "remove"; expectedVersion: string; instanceId: string }
  | { action: "test"; expectedVersion: string; instanceId: string; modelId: string }
  | { action: "writeCredential"; instanceId: string; value: string }
  | { action: "deleteCredential"; instanceId: string }
  | { action: "login"; instanceId: string }
  | { action: "loginStatus"; loginId: string }
  | { action: "loginRespond"; loginId: string; value: string }
  | { action: "cancelLogin"; loginId: string }
  | { action: "logout"; instanceId: string }
  | { action: "refreshModels"; instanceId: string };
export type ProviderResponse = {
  version: string;
  restartRequired: boolean;
  catalog?: ProviderCatalogEntry[];
  instances?: ProviderInstanceStatus[];
  models?: ProviderModel[];
  references?: ProviderReference[];
  test?: ProviderTestResult;
  login?: ProviderLogin;
  saved?: boolean;
};

import { getStoredKeys, saveStoredKeys, clearStoredKeys, type StoredKeys } from "@/dashboard/lib/storage";

export type KeyField = "aimlApiKey" | "featherlessApiKey" | "humanReviewerApiKey";
export type ModelField = "aimlModel" | "featherlessModel";

export const KEY_LABELS: Record<KeyField, string> = {
  aimlApiKey: "AIML API Key",
  featherlessApiKey: "Featherless API Key",
  humanReviewerApiKey: "Human Reviewer API Key",
};

export const KEY_ENV_NAMES: Record<KeyField, string> = {
  aimlApiKey: "AIML_API_KEY",
  featherlessApiKey: "FEATHERLESS_API_KEY",
  humanReviewerApiKey: "HUMAN_REVIEWER_USER_API_KEY",
};

export const MODEL_ENV_NAMES: Record<ModelField, string> = {
  aimlModel: "AIML_MODEL",
  featherlessModel: "FEATHERLESS_MODEL",
};

/** Which provider key each model field pairs with, for side-by-side rows. */
export const MODEL_FOR_KEY: Partial<Record<KeyField, ModelField>> = {
  aimlApiKey: "aimlModel",
  featherlessApiKey: "featherlessModel",
};

export function loadKeyForm(): StoredKeys {
  return (
    getStoredKeys() ?? {
      aimlApiKey: "",
      featherlessApiKey: "",
      humanReviewerApiKey: "",
      aimlModel: "",
      featherlessModel: "",
      updatedAt: "",
    }
  );
}

export function persistKeyForm(form: {
  aimlApiKey: string;
  featherlessApiKey: string;
  humanReviewerApiKey: string;
  aimlModel: string;
  featherlessModel: string;
}): StoredKeys {
  return saveStoredKeys({
    aimlApiKey: form.aimlApiKey.trim() || undefined,
    featherlessApiKey: form.featherlessApiKey.trim() || undefined,
    humanReviewerApiKey: form.humanReviewerApiKey.trim() || undefined,
    aimlModel: form.aimlModel.trim() || undefined,
    featherlessModel: form.featherlessModel.trim() || undefined,
  });
}

export function deleteAllKeys(): void {
  clearStoredKeys();
}

/**
 * Gate a run when the server advertises no fallback provider keys. Returns an
 * error message to show the visitor, or null when it is safe to proceed.
 */
export function missingRequiredKeys(keysRequired: boolean): string | null {
  if (!keysRequired) return null;
  const k = getStoredKeys();
  if (!k?.aimlApiKey || !k?.featherlessApiKey) {
    return "Add your AI/ML and Featherless API keys in Settings before starting a run.";
  }
  return null;
}

export function buildEnvSnippet(keys: StoredKeys): string {
  const lines: string[] = [];
  if (keys.aimlApiKey) lines.push(`AIML_API_KEY=${keys.aimlApiKey}`);
  if (keys.featherlessApiKey) lines.push(`FEATHERLESS_API_KEY=${keys.featherlessApiKey}`);
  if (keys.humanReviewerApiKey) lines.push(`HUMAN_REVIEWER_USER_API_KEY=${keys.humanReviewerApiKey}`);
  if (keys.aimlModel) lines.push(`AIML_MODEL=${keys.aimlModel}`);
  if (keys.featherlessModel) lines.push(`FEATHERLESS_MODEL=${keys.featherlessModel}`);
  return lines.join("\n");
}

export function maskKey(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `••••••••${value.slice(-4)}`;
}

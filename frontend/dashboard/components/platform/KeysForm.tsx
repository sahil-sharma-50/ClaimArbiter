"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, CircleAlert, Eye, EyeOff, Info } from "lucide-react";
import { usePublishRouteSlot } from "@/dashboard/components/platform/PlatformSyncContext";
import { ConfirmDialog } from "@/dashboard/components/platform/ConfirmDialog";
import { fetchConfig, testProviderKey, type GatewayConfig } from "@/dashboard/lib/api";
import {
  KEY_LABELS,
  MODEL_FOR_KEY,
  buildEnvSnippet,
  deleteAllKeys,
  loadKeyForm,
  persistKeyForm,
  type KeyField,
  type ModelField,
} from "@/dashboard/lib/settings";
import { Icon } from "@/dashboard/components/ui/Icon";

const FIELDS: KeyField[] = ["aimlApiKey", "featherlessApiKey", "humanReviewerApiKey"];

const PROVIDER_FOR_KEY: Partial<Record<KeyField, "aiml" | "featherless">> = {
  aimlApiKey: "aiml",
  featherlessApiKey: "featherless",
};

const PROVIDER_LABEL: Partial<Record<KeyField, string>> = {
  aimlApiKey: "AIML",
  featherlessApiKey: "Featherless",
  humanReviewerApiKey: "Human reviewer",
};

const FIELD_HELP: Partial<Record<KeyField, string>> = {
  aimlApiKey: "Powers document extraction and structured claim parsing.",
  featherlessApiKey:
    "Powers specialist agent reasoning and claim image analysis during adjudication.",
  humanReviewerApiKey: "Optional Band key for human-in-the-loop review steps.",
};

type MessageTone = "success" | "error" | "info";

type FormState = {
  aimlApiKey: string;
  featherlessApiKey: string;
  humanReviewerApiKey: string;
  aimlModel: string;
  featherlessModel: string;
};

function snapshotForm(form: FormState): string {
  return JSON.stringify(form);
}

const FEEDBACK_ICONS = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
} as const;

export function KeysForm() {
  const [form, setForm] = useState<FormState>(() => {
    const k = loadKeyForm();
    return {
      aimlApiKey: k.aimlApiKey ?? "",
      featherlessApiKey: k.featherlessApiKey ?? "",
      humanReviewerApiKey: k.humanReviewerApiKey ?? "",
      aimlModel: k.aimlModel ?? "",
      featherlessModel: k.featherlessModel ?? "",
    };
  });
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotForm(form));
  const [visible, setVisible] = useState<Record<KeyField, boolean>>({
    aimlApiKey: false,
    featherlessApiKey: false,
    humanReviewerApiKey: false,
  });
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<MessageTone>("info");
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const isDirty = useMemo(() => snapshotForm(form) !== savedSnapshot, [form, savedSnapshot]);

  const savedKeyCount = useMemo(() => {
    try {
      const saved = JSON.parse(savedSnapshot) as FormState;
      return [saved.aimlApiKey, saved.featherlessApiKey, saved.humanReviewerApiKey].filter(Boolean).length;
    } catch {
      return 0;
    }
  }, [savedSnapshot]);

  usePublishRouteSlot(
    "KEYS",
    savedKeyCount === 3 ? "Saved" : savedKeyCount > 0 ? "Partial" : "None",
  );

  useEffect(() => {
    let active = true;
    fetchConfig()
      .then((cfg) => {
        if (!active || !cfg) return;
        setConfig(cfg);
        setForm((f) => ({
          ...f,
          aimlModel: f.aimlModel || cfg.aiml_model,
          featherlessModel: f.featherlessModel || cfg.featherless_model,
        }));
        // Gateway defaults are not user edits; fold them into the saved baseline only.
        setSavedSnapshot((snap) => {
          const saved = JSON.parse(snap) as FormState;
          return snapshotForm({
            ...saved,
            aimlModel: saved.aimlModel || cfg.aiml_model,
            featherlessModel: saved.featherlessModel || cfg.featherless_model,
          });
        });
      })
      .finally(() => {
        if (active) setConfigLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!message || messageTone !== "success") return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message, messageTone]);

  function notify(text: string, tone: MessageTone = "info") {
    setMessage(text);
    setMessageTone(tone);
  }

  function update(field: KeyField | ModelField, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleVisible(field: KeyField) {
    setVisible((v) => ({ ...v, [field]: !v[field] }));
  }

  // True when the server's own .env provides a fallback for this provider. Fields are
  // NEVER locked: a visitor's own key always wins, and the server key only fills a slot
  // they leave blank (see gateway.main.resolve_keys). The flag drives an informational
  // badge, not a disabled input.
  function hasServerFallback(field: KeyField): boolean {
    const provider = PROVIDER_FOR_KEY[field];
    return Boolean(provider && config?.server_keys[provider]);
  }

  // "user"     — visitor typed their own key; runs use it.
  // "fallback" — empty, but the server has a key that will be used instead.
  // "empty"    — empty and no server fallback; a key is required to run.
  function providerStatus(field: KeyField): "user" | "fallback" | "empty" {
    if (form[field].trim()) return "user";
    if (hasServerFallback(field)) return "fallback";
    return "empty";
  }

  async function handleSave() {
    setSaving(true);
    try {
      persistKeyForm(form);
      setSavedSnapshot(snapshotForm(form));
      notify("Keys saved to this browser.", "success");
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteAll() {
    deleteAllKeys();
    const cleared: FormState = {
      aimlApiKey: "",
      featherlessApiKey: "",
      humanReviewerApiKey: "",
      aimlModel: config?.aiml_model ?? "",
      featherlessModel: config?.featherless_model ?? "",
    };
    setForm(cleared);
    setSavedSnapshot(snapshotForm(cleared));
    setConfirmDeleteOpen(false);
    notify("All keys deleted from this browser.", "success");
  }

  async function handleTest(provider: "aiml" | "featherless") {
    const label = provider === "aiml" ? "AIML" : "Featherless";
    const hasFallback = Boolean(config?.server_keys[provider]);
    const key = provider === "aiml" ? form.aimlApiKey : form.featherlessApiKey;
    if (!key.trim()) {
      notify(
        hasFallback
          ? `Enter your own ${label} key to test it. Left blank, runs use the server's key.`
          : `Enter an ${label} key first.`,
        "info",
      );
      return;
    }
    setTesting(provider);
    setMessage(null);
    try {
      await testProviderKey(provider, key.trim());
      notify(`${label} connection OK.`, "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Test failed", "error");
    } finally {
      setTesting(null);
    }
  }

  async function handleCopySnippet() {
    const snippet = buildEnvSnippet({
      aimlApiKey: form.aimlApiKey.trim() || undefined,
      featherlessApiKey: form.featherlessApiKey.trim() || undefined,
      humanReviewerApiKey: form.humanReviewerApiKey.trim() || undefined,
      aimlModel: form.aimlModel.trim() || undefined,
      featherlessModel: form.featherlessModel.trim() || undefined,
      updatedAt: new Date().toISOString(),
    });
    if (!snippet) {
      notify("No keys to copy.", "info");
      return;
    }
    setCopying(true);
    try {
      await navigator.clipboard.writeText(snippet);
      notify(".env snippet copied to clipboard.", "success");
    } catch {
      notify("Couldn't copy to clipboard. Check browser permissions.", "error");
    } finally {
      setCopying(false);
    }
  }

  const FeedbackIcon = FEEDBACK_ICONS[messageTone];

  return (
    <>
    <form
      className="platform-split-main settings-main settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
      aria-busy={configLoading || saving}
    >
      {isDirty && (
        <p className="settings-dirty" role="status">
          <Icon as={AlertCircle} size={14} />
          Unsaved changes
        </p>
      )}

      <div className="settings-providers">
        {configLoading
          ? FIELDS.map((field) => (
              <div key={field} className="settings-provider settings-provider-skeleton" aria-hidden>
                <div className="settings-skeleton-line settings-skeleton-title" />
                <div className="settings-skeleton-line settings-skeleton-field" />
                <div className="settings-skeleton-line settings-skeleton-field" />
              </div>
            ))
          : FIELDS.map((field) => {
              const model = MODEL_FOR_KEY[field];
              const provider = PROVIDER_FOR_KEY[field];
              const sectionTitle = PROVIDER_LABEL[field] ?? KEY_LABELS[field];
              const status = providerStatus(field);
              const badgeClass = status === "user" ? "is-configured" : "is-server";
              const badgeLabel = status === "user" ? "Using your key" : "Server fallback";
              const keyId = `${field}-key`;
              const modelId = model ? `${model}-model` : undefined;

              return (
                <section
                  key={field}
                  className="settings-provider"
                  aria-labelledby={`${field}-heading`}
                  aria-busy={testing === provider}
                >
                  <div className="settings-provider-head">
                    <div className="settings-provider-meta">
                      <h2 id={`${field}-heading`} className="settings-provider-title">
                        {sectionTitle}
                      </h2>
                      {status !== "empty" && (
                        <span className={`settings-provider-badge ${badgeClass}`}>
                          {badgeLabel}
                        </span>
                      )}
                    </div>
                    {provider && (
                      <button
                        type="button"
                        className="btn btn-secondary settings-provider-test"
                        onClick={() => void handleTest(provider)}
                        disabled={testing !== null}
                        aria-busy={testing === provider}
                      >
                        {testing === provider ? "Testing…" : "Test connection"}
                      </button>
                    )}
                  </div>

                  <div className={`settings-provider-fields${model ? " has-model" : ""}`}>
                    <div className="settings-field">
                      <label className="label" htmlFor={keyId}>
                        API key
                      </label>
                      <div className="settings-input-row">
                        <input
                          id={keyId}
                          name={field}
                          type={visible[field] ? "text" : "password"}
                          value={form[field]}
                          onChange={(e) => update(field, e.target.value)}
                          className="input"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="Paste key"
                          aria-describedby={`${field}-help`}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary settings-reveal"
                          onClick={() => toggleVisible(field)}
                          aria-label={visible[field] ? "Hide key" : "Show key"}
                        >
                          <Icon as={visible[field] ? EyeOff : Eye} size={16} />
                        </button>
                      </div>
                      <p id={`${field}-help`} className="settings-field-help">
                        {FIELD_HELP[field]}
                        {status === "fallback" && " Leave blank to use the server's key."}
                      </p>
                    </div>

                    {model && modelId && (
                      <div className="settings-field">
                        <label className="label" htmlFor={modelId}>
                          Model
                        </label>
                        <input
                          id={modelId}
                          name={model}
                          type="text"
                          value={form[model]}
                          onChange={(e) => update(model, e.target.value)}
                          className="input"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={config ? "Default from gateway" : "Loading default…"}
                          aria-describedby={`${modelId}-help`}
                        />
                        <p id={`${modelId}-help`} className="settings-field-help">
                          Override the gateway default model name.
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
      </div>

      {message && (
        <p
          className={`settings-feedback settings-feedback-${messageTone}`}
          role={messageTone === "error" ? "alert" : "status"}
          aria-live={messageTone === "error" ? "assertive" : "polite"}
        >
          <Icon as={FeedbackIcon} size={16} className="settings-feedback-icon" aria-hidden />
          {message}
        </p>
      )}

      <footer className="settings-actions">
        <div className="settings-actions-main">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || configLoading || !isDirty}
            aria-busy={saving}
          >
            {saving ? "Saving…" : "Save to browser"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleCopySnippet()}
            disabled={copying || configLoading}
            aria-busy={copying}
          >
            {copying ? "Copying…" : "Copy .env snippet"}
          </button>
        </div>
        <button
          type="button"
          className="btn btn-danger settings-actions-danger"
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={configLoading}
        >
          Delete all keys
        </button>
      </footer>
    </form>

    <ConfirmDialog
      open={confirmDeleteOpen}
      title="Delete all keys?"
      body={
        <>
          All provider keys stored in this browser will be cleared. You&apos;ll need to
          re-enter them before starting a self-hosted run.
        </>
      }
      confirmLabel="Delete keys"
      busyLabel="Deleting…"
      onConfirm={confirmDeleteAll}
      onCancel={() => setConfirmDeleteOpen(false)}
    />
    </>
  );
}

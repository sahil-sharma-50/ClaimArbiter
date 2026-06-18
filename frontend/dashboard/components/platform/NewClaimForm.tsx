"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileImage,
  FileText,
  ImagePlus,
  Loader2,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import { createClaim, createClaimWithFiles, type ClaimInput } from "@/dashboard/lib/api";
import { missingRequiredKeys } from "@/dashboard/lib/settings";
import { recordSession } from "@/dashboard/lib/sessions";
import {
  usePlatformSyncState,
  usePublishRouteSlot,
} from "@/dashboard/components/platform/PlatformSyncContext";
import { PlatformPageBrief } from "@/dashboard/components/platform/PlatformPageBrief";
import { Icon } from "@/dashboard/components/ui/Icon";

type FormState = {
  claim_id: string;
  policy_id: string;
  incident_date: string;
  reported_date: string;
  incident_location: string;
  incident_time: string;
  claimant_name: string;
  claimant_email: string;
  claimant_phone: string;
  claimant_address: string;
  claimant_dob: string;
  damage_description: string;
  currency: string;
  estimated_repair: string;
  loss_amount: string;
  deductible: string;
  other_insurance: string;
  narrative: string;
  declaration: boolean;
};

const BLANK: FormState = {
  claim_id: "CLM-2026-0100",
  policy_id: "POL-MER-8812",
  incident_date: "2026-06-01",
  reported_date: "2026-06-02",
  incident_location: "",
  incident_time: "",
  claimant_name: "",
  claimant_email: "",
  claimant_phone: "",
  claimant_address: "",
  claimant_dob: "",
  damage_description: "",
  currency: "USD",
  estimated_repair: "",
  loss_amount: "",
  deductible: "500",
  other_insurance: "",
  narrative: "",
  declaration: false,
};

// A realistic, fully-detailed example claim. The narrative clears the 120-char
// minimum and reads like a real medical filing so the agents can classify and
// investigate it end-to-end.
const EXAMPLE: FormState = {
  claim_id: "CLM-2026-0042",
  policy_id: "POL-MER-8812",
  incident_date: "2026-05-28",
  reported_date: "2026-05-29",
  incident_location: "Riverside Medical Center, Building C, Portland OR",
  incident_time: "14:30",
  claimant_name: "Jordan Reyes",
  claimant_email: "jordan.reyes@example.com",
  claimant_phone: "+1-555-0142",
  claimant_address: "418 Maple Court, Portland, OR 97205",
  claimant_dob: "1989-03-11",
  damage_description: "Lumbar MRI, physical therapy course, and prescribed bracing",
  currency: "USD",
  estimated_repair: "8400",
  loss_amount: "8400",
  deductible: "500",
  other_insurance: "None",
  narrative:
    "Slipped on an unmarked wet floor in the lobby and landed on my lower back. The treating clinic ordered an MRI, diagnosed a lumbar disc injury, and billed for a twelve-week physical therapy course plus a lumbar support brace. I am submitting the radiology report and treatment images for review.",
  declaration: false,
};

const MAX_PHOTOS = 6;
const MAX_FILE_MB = 8;
const NARRATIVE_MIN = 120;

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR"] as const;

const REQUIRED_KEYS = [
  "claim_id",
  "claimant_name",
  "incident_date",
  "loss_amount",
  "narrative",
] as const satisfies readonly (keyof FormState)[];

const STEPS = [
  {
    id: "claim",
    icon: FileText,
    title: "Claim & incident",
    short: "Claim",
    description: "Reference numbers and where it happened.",
    guidance:
      "The claim ID routes this case through Band adjudication. Agents classify the domain from your story — there is no category to pick.",
    fields: ["claim_id", "incident_date"] as const,
  },
  {
    id: "parties",
    icon: User,
    title: "Claimant",
    short: "Claimant",
    description: "Who is filing and how to reach them.",
    guidance:
      "Contact and identity details sync to the intake agent. Specialist routing is inferred from the narrative and evidence — not from these fields.",
    fields: ["claimant_name"] as const,
  },
  {
    id: "loss",
    icon: Wallet,
    title: "Loss & narrative",
    short: "Loss",
    description: "Amounts, other coverage, and what happened.",
    guidance:
      "Be specific in the narrative — at least a few sentences. Intake classifies the domain and routes to the right specialist from this story.",
    fields: ["loss_amount", "narrative"] as const,
  },
  {
    id: "evidence",
    icon: FileImage,
    title: "Evidence & declaration",
    short: "Evidence",
    description: "Upload supporting files and sign the declaration.",
    guidance:
      "Photos and PDFs feed the Evidence Analyst. The declaration is a binding statement that your claim is true and complete.",
    fields: [] as const,
  },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function narrativeLength(form: FormState): number {
  return form.narrative.trim().length;
}

function fieldError(key: keyof FormState, form: FormState): string | null {
  switch (key) {
    case "claim_id":
      return form.claim_id.trim() ? null : "Claim ID is required.";
    case "claimant_name":
      return form.claimant_name.trim() ? null : "Claimant name is required.";
    case "claimant_email":
      if (!form.claimant_email.trim()) return null;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.claimant_email.trim())
        ? null
        : "Enter a valid email address.";
    case "incident_date":
      return form.incident_date.trim() ? null : "Incident date is required.";
    case "loss_amount":
      if (!form.loss_amount.trim()) return "Loss amount is required.";
      return Number.isNaN(Number(form.loss_amount)) ? "Enter a valid number." : null;
    case "narrative":
      if (!form.narrative.trim()) return "Tell us what happened.";
      return narrativeLength(form) < NARRATIVE_MIN
        ? `Please describe what happened in at least ${NARRATIVE_MIN} characters.`
        : null;
    default:
      return null;
  }
}

function validateForm(form: FormState): string | null {
  for (const key of REQUIRED_KEYS) {
    const err = fieldError(key, form);
    if (err) return err;
  }
  const emailErr = fieldError("claimant_email", form);
  if (emailErr) return emailErr;
  return null;
}

function validateStep(stepIndex: number, form: FormState): string | null {
  const step = STEPS[stepIndex];
  for (const key of step.fields) {
    const err = fieldError(key, form);
    if (err) return err;
  }
  return null;
}

function stepComplete(stepIndex: number, form: FormState): boolean {
  return validateStep(stepIndex, form) === null;
}

function validateFiles(photos: File[], document: File | null): string | null {
  if (photos.length > MAX_PHOTOS) return `At most ${MAX_PHOTOS} photos.`;
  const tooBig = [...photos, ...(document ? [document] : [])].find(
    (f) => f.size > MAX_FILE_MB * 1024 * 1024,
  );
  if (tooBig) return `${tooBig.name} exceeds ${MAX_FILE_MB} MB.`;
  if (document && document.type !== "application/pdf")
    return "Supporting document must be a PDF.";
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCurrency(value: string, currency: string): string {
  const n = Number(value);
  if (!value.trim() || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

function FormField({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="new-claim-field">
      <label className="new-claim-label" htmlFor={id}>
        {label}
        {required && (
          <span className="new-claim-required" aria-hidden>
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="new-claim-field-help">
          {hint}
        </p>
      )}
      <div className="new-claim-control" aria-describedby={describedBy}>
        {children}
      </div>
      {error && (
        <p id={errorId} className="new-claim-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function FileDropZone({
  id,
  label,
  accept,
  multiple,
  files,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  accept: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  hint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFromList(list: FileList | null) {
    const next = Array.from(list ?? []);
    onChange(multiple ? next.slice(0, MAX_PHOTOS) : next.slice(0, 1));
  }

  return (
    <div className="new-claim-field">
      <span className="new-claim-label" id={`${id}-label`}>
        {label}
      </span>
      <p className="new-claim-field-help">{hint}</p>
      <div
        className={`new-claim-drop${dragOver ? " is-dragover" : ""}${files.length ? " has-files" : ""}`}
        role="group"
        aria-labelledby={`${id}-label`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFromList(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id={id}
          className="new-claim-drop-input"
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={(e) => pickFromList(e.target.files)}
        />
        <span className="new-claim-drop-icon" aria-hidden>
          <Icon as={ImagePlus} size={20} />
        </span>
        <p className="new-claim-drop-title">
          Drop files here or{" "}
          <button
            type="button"
            className="new-claim-drop-trigger"
            onClick={() => inputRef.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="new-claim-drop-meta">Up to {MAX_FILE_MB} MB each</p>
      </div>
      {files.length > 0 && (
        <ul className="new-claim-file-list" aria-live="polite">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="new-claim-file-item">
              <span className="new-claim-file-name">{file.name}</span>
              <span className="new-claim-file-size">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="new-claim-file-remove"
                onClick={() => onChange(files.filter((f) => f !== file))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepNav({
  currentStep,
  form,
  onGoTo,
}: {
  currentStep: number;
  form: FormState;
  onGoTo: (index: number) => void;
}) {
  return (
    <nav className="new-claim-steps" aria-label="Intake steps">
      <ol className="new-claim-steps-list">
        {STEPS.map((step, index) => {
          const done = stepComplete(index, form);
          const active = index === currentStep;
          const reachable =
            index <= currentStep ||
            STEPS.slice(0, index).every((_, i) => stepComplete(i, form));

          return (
            <li key={step.id} className="new-claim-steps-item">
              <button
                type="button"
                className={`new-claim-step-btn${active ? " is-active" : ""}${done ? " is-done" : ""}`}
                aria-current={active ? "step" : undefined}
                disabled={!reachable && !active}
                onClick={() => reachable && onGoTo(index)}
              >
                <span className="new-claim-step-marker" aria-hidden>
                  {done && !active ? (
                    <Icon as={Check} size={14} />
                  ) : (
                    <span className="new-claim-step-num">{index + 1}</span>
                  )}
                </span>
                <span className="new-claim-step-copy">
                  <span className="new-claim-step-title">{step.short}</span>
                  <span className="new-claim-step-desc">{step.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="new-claim-review-row">
      <dt className="new-claim-review-label">{label}</dt>
      <dd className="new-claim-review-value">{value || "—"}</dd>
    </div>
  );
}

export function NewClaimForm() {
  const router = useRouter();
  const { gatewayOk, keysRequired } = usePlatformSyncState();
  const offline = gatewayOk === false;
  const formId = useId();

  const [form, setForm] = useState<FormState>(BLANK);
  const [photos, setPhotos] = useState<File[]>([]);
  const [supportingDoc, setSupportingDoc] = useState<File | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Seconds left on the "starting up" countdown shown inside the submit button.
  // Booting the Band agents takes ~15s, so we count down to set expectations
  // instead of showing a featureless spinner. Floors at 0; never goes negative.
  const [startupCountdown, setStartupCountdown] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [stepAttempted, setStepAttempted] = useState(false);

  const step = STEPS[currentStep];
  const isLastStep = currentStep === STEPS.length - 1;
  const completedCount = STEPS.filter((_, i) => stepComplete(i, form)).length;
  const narrativeCount = narrativeLength(form);
  const narrativeMet = narrativeCount >= NARRATIVE_MIN;

  usePublishRouteSlot(
    "MODE",
    submitAttempted && submitError
      ? "Needs fix"
      : `Step ${currentStep + 1}/${STEPS.length}`,
  );

  // Tick the startup countdown down to 0 once a submit kicks it off. The request
  // usually resolves (and the live console opens) before it reaches 0; if the boot
  // runs long we hold at 0 rather than counting into negatives.
  useEffect(() => {
    if (startupCountdown === null || startupCountdown <= 0) return;
    const t = setTimeout(() => {
      setStartupCountdown((s) => (s === null ? null : Math.max(0, s - 1)));
    }, 1000);
    return () => clearTimeout(t);
  }, [startupCountdown]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function touch(key: keyof FormState) {
    setTouched((t) => ({ ...t, [key]: true }));
  }

  function touchStepFields(stepIndex: number) {
    const keys = STEPS[stepIndex].fields;
    setTouched((t) => {
      const next = { ...t };
      for (const key of keys) next[key] = true;
      return next;
    });
  }

  function showError(key: keyof FormState): string | null {
    if (!touched[key] && !submitAttempted && !stepAttempted) return null;
    return fieldError(key, form);
  }

  function loadExample() {
    setForm(EXAMPLE);
    setSubmitError(null);
    setTouched({});
    setSubmitAttempted(false);
    setStepAttempted(false);
    setCurrentStep(0);
  }

  function goToStep(index: number) {
    setCurrentStep(index);
    setStepAttempted(false);
    setSubmitError(null);
  }

  function handleNext() {
    setStepAttempted(true);
    touchStepFields(currentStep);
    const problem = validateStep(currentStep, form);
    if (problem) {
      setSubmitError(problem);
      return;
    }
    setSubmitError(null);
    setStepAttempted(false);
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function handleBack() {
    setSubmitError(null);
    setStepAttempted(false);
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    setStepAttempted(true);
    // The declaration is the deliberate, final consent to run the claim. Guard here
    // too (not just via the disabled button) so a claim never starts unconfirmed —
    // e.g. an Enter keypress landing on the freshly-swapped submit button.
    if (!form.declaration) {
      setSubmitError("Tick the declaration to confirm and submit your claim.");
      return;
    }
    const problem =
      validateForm(form) ?? validateFiles(photos, supportingDoc) ?? missingRequiredKeys(keysRequired);
    if (problem) {
      setSubmitError(problem);
      const firstBad = STEPS.findIndex((_, i) => validateStep(i, form) !== null);
      if (firstBad >= 0) setCurrentStep(firstBad);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setStartupCountdown(15);

    const payload: ClaimInput = {
      claim_id: form.claim_id.trim(),
      policy_id: form.policy_id.trim() || "POL-MER-8812",
      incident_date: form.incident_date.trim(),
      reported_date: form.reported_date.trim() || form.incident_date.trim(),
      incident_location: form.incident_location.trim() || undefined,
      incident_time: form.incident_time.trim() || undefined,
      claimant: {
        name: form.claimant_name.trim(),
        phone: form.claimant_phone.trim(),
        email: form.claimant_email.trim(),
        address: form.claimant_address.trim(),
        dob: form.claimant_dob.trim(),
      },
      damage: {
        description: form.damage_description.trim(),
        estimated_repair: Number(form.estimated_repair) || 0,
      },
      currency: form.currency || "USD",
      loss_amount: Number(form.loss_amount) || 0,
      deductible: Number(form.deductible) || 0,
      other_insurance: form.other_insurance.trim() || undefined,
      narrative: form.narrative.trim(),
      declaration: form.declaration,
    };

    try {
      const hasFiles = photos.length > 0 || supportingDoc !== null;
      const { chat_id } = hasFiles
        ? await createClaimWithFiles(payload, photos, supportingDoc)
        : await createClaim(payload);
      recordSession(chat_id);
      router.push(`/app/live?chat_id=${encodeURIComponent(chat_id)}`);
    } catch (err) {
      // The submit stays LOCKED after a failure — booting the Band agents blocks the
      // request ~15s (a cold Featherless validation ping can run even longer) and may
      // time out *after* the claim room was already created. Silently re-enabling the
      // button would revert a form whose claim may be live, and invite a duplicate
      // submit. So we surface the error but keep the submitted state; the operator
      // recovers explicitly via the "Try again" action below (which clears it).
      setSubmitError(err instanceof Error ? err.message : "Failed to create claim");
      setStartupCountdown(null);
    }
  }

  // Explicit recovery from a stuck/slow submit: clears the locked state so the
  // operator can retry. Used by the "Try again" action shown with a submit error.
  function resetSubmitState() {
    setSubmitting(false);
    setStartupCountdown(null);
    setSubmitError(null);
  }

  function renderStepContent() {
    switch (step.id as StepId) {
      case "claim":
        return (
          <div className="new-claim-stack">
            <div className="new-claim-grid">
              <FormField id="claim_id" label="Claim ID" required error={showError("claim_id")}>
                <input
                  className={`input${showError("claim_id") ? " input-invalid" : ""}`}
                  id="claim_id"
                  name="claim_id"
                  autoComplete="off"
                  value={form.claim_id}
                  onChange={(e) => set("claim_id", e.target.value)}
                  onBlur={() => touch("claim_id")}
                />
              </FormField>
              <FormField id="policy_id" label="Policy ID">
                <input
                  className="input"
                  id="policy_id"
                  name="policy_id"
                  autoComplete="off"
                  value={form.policy_id}
                  onChange={(e) => set("policy_id", e.target.value)}
                />
              </FormField>
            </div>
            <div className="new-claim-grid">
              <FormField
                id="incident_date"
                label="Incident date"
                required
                error={showError("incident_date")}
              >
                <input
                  className={`input${showError("incident_date") ? " input-invalid" : ""}`}
                  id="incident_date"
                  name="incident_date"
                  type="date"
                  value={form.incident_date}
                  onChange={(e) => set("incident_date", e.target.value)}
                  onBlur={() => touch("incident_date")}
                />
              </FormField>
              <FormField id="reported_date" label="Reported date">
                <input
                  className="input"
                  id="reported_date"
                  name="reported_date"
                  type="date"
                  value={form.reported_date}
                  onChange={(e) => set("reported_date", e.target.value)}
                />
              </FormField>
            </div>
            <div className="new-claim-grid">
              <FormField id="incident_location" label="Incident location">
                <input
                  className="input"
                  id="incident_location"
                  name="incident_location"
                  autoComplete="off"
                  placeholder="Address or place where it happened"
                  value={form.incident_location}
                  onChange={(e) => set("incident_location", e.target.value)}
                />
              </FormField>
              <FormField id="incident_time" label="Time of day">
                <input
                  className="input"
                  id="incident_time"
                  name="incident_time"
                  type="time"
                  value={form.incident_time}
                  onChange={(e) => set("incident_time", e.target.value)}
                />
              </FormField>
            </div>
          </div>
        );

      case "parties":
        return (
          <div className="new-claim-stack">
            <FormField
              id="claimant_name"
              label="Full name"
              required
              error={showError("claimant_name")}
            >
              <input
                className={`input${showError("claimant_name") ? " input-invalid" : ""}`}
                id="claimant_name"
                name="claimant_name"
                autoComplete="name"
                value={form.claimant_name}
                onChange={(e) => set("claimant_name", e.target.value)}
                onBlur={() => touch("claimant_name")}
              />
            </FormField>
            <div className="new-claim-grid">
              <FormField id="claimant_email" label="Email" error={showError("claimant_email")}>
                <input
                  className={`input${showError("claimant_email") ? " input-invalid" : ""}`}
                  id="claimant_email"
                  name="claimant_email"
                  type="email"
                  autoComplete="email"
                  value={form.claimant_email}
                  onChange={(e) => set("claimant_email", e.target.value)}
                  onBlur={() => touch("claimant_email")}
                />
              </FormField>
              <FormField id="claimant_phone" label="Phone">
                <input
                  className="input"
                  id="claimant_phone"
                  name="claimant_phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.claimant_phone}
                  onChange={(e) => set("claimant_phone", e.target.value)}
                />
              </FormField>
            </div>
            <FormField id="claimant_address" label="Mailing address">
              <input
                className="input"
                id="claimant_address"
                name="claimant_address"
                autoComplete="street-address"
                placeholder="Street, city, state, ZIP"
                value={form.claimant_address}
                onChange={(e) => set("claimant_address", e.target.value)}
              />
            </FormField>
            <FormField id="claimant_dob" label="Date of birth">
              <input
                className="input"
                id="claimant_dob"
                name="claimant_dob"
                type="date"
                value={form.claimant_dob}
                onChange={(e) => set("claimant_dob", e.target.value)}
              />
            </FormField>
          </div>
        );

      case "loss":
        return (
          <div className="new-claim-stack">
            <FormField id="damage_description" label="Loss / injury description">
              <input
                className="input"
                id="damage_description"
                name="damage_description"
                placeholder="Short summary of what was damaged, lost, or injured"
                value={form.damage_description}
                onChange={(e) => set("damage_description", e.target.value)}
              />
            </FormField>
            <div className="new-claim-grid new-claim-grid-3">
              <FormField id="currency" label="Currency">
                <select
                  className="input"
                  id="currency"
                  name="currency"
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="estimated_repair" label="Estimated cost">
                <input
                  className="input tabular"
                  id="estimated_repair"
                  name="estimated_repair"
                  inputMode="decimal"
                  value={form.estimated_repair}
                  onChange={(e) => set("estimated_repair", e.target.value)}
                />
              </FormField>
              <FormField
                id="loss_amount"
                label="Loss amount"
                required
                error={showError("loss_amount")}
              >
                <input
                  className={`input tabular${showError("loss_amount") ? " input-invalid" : ""}`}
                  id="loss_amount"
                  name="loss_amount"
                  inputMode="decimal"
                  value={form.loss_amount}
                  onChange={(e) => set("loss_amount", e.target.value)}
                  onBlur={() => touch("loss_amount")}
                />
              </FormField>
            </div>
            <div className="new-claim-grid">
              <FormField id="deductible" label="Deductible">
                <input
                  className="input tabular"
                  id="deductible"
                  name="deductible"
                  inputMode="decimal"
                  value={form.deductible}
                  onChange={(e) => set("deductible", e.target.value)}
                />
              </FormField>
              <FormField
                id="other_insurance"
                label="Other insurance"
                hint="Any other policy covering part of this loss?"
              >
                <input
                  className="input"
                  id="other_insurance"
                  name="other_insurance"
                  placeholder="Insurer & policy, or 'None'"
                  value={form.other_insurance}
                  onChange={(e) => set("other_insurance", e.target.value)}
                />
              </FormField>
            </div>
            <FormField
              id="narrative"
              label="What happened"
              required
              hint="Describe the incident in your own words — what happened, how, and what was affected. Minimum a few sentences."
              error={showError("narrative")}
            >
              <textarea
                className={`input new-claim-textarea${showError("narrative") ? " input-invalid" : ""}`}
                id="narrative"
                name="narrative"
                rows={6}
                value={form.narrative}
                onChange={(e) => set("narrative", e.target.value)}
                onBlur={() => touch("narrative")}
              />
              <p
                className={`new-claim-counter${narrativeMet ? " is-met" : ""}`}
                aria-live="polite"
              >
                {narrativeMet ? (
                  <>
                    <Icon as={Check} size={13} aria-hidden /> Minimum met · {narrativeCount}{" "}
                    characters
                  </>
                ) : (
                  <>
                    {narrativeCount} / {NARRATIVE_MIN} characters minimum
                  </>
                )}
              </p>
            </FormField>
          </div>
        );

      case "evidence":
        return (
          <div className="new-claim-step-sections">
            <div className="new-claim-evidence-grid">
              <FileDropZone
                id="damage_photos"
                label={`Supporting photos / images (up to ${MAX_PHOTOS})`}
                accept="image/jpeg,image/png,image/webp"
                multiple
                files={photos}
                onChange={setPhotos}
                hint="JPG, PNG, or WebP. Photos of the damage, injury, or scene. Without uploads, the demo uses golden evidence."
              />
              <FileDropZone
                id="supporting_document"
                label="Supporting document (PDF)"
                accept="application/pdf"
                files={supportingDoc ? [supportingDoc] : []}
                onChange={(files) => setSupportingDoc(files[0] ?? null)}
                hint="Report, estimate, invoice, or medical record as a PDF."
              />
            </div>

            <section className="new-claim-subsection" aria-labelledby="declaration-heading">
              <header className="new-claim-subsection-head">
                <span className="new-claim-subsection-icon" aria-hidden>
                  <Icon as={ShieldCheck} size={15} />
                </span>
                <div>
                  <h3 id="declaration-heading" className="new-claim-subsection-title">
                    Declaration
                  </h3>
                  <p className="new-claim-subsection-desc">
                    Your claim is reviewed by automated adjudication agents. False or misleading
                    statements can be flagged for investigation.
                  </p>
                </div>
              </header>
              <label
                className={`new-claim-declaration${form.declaration ? " is-on" : ""}${
                  showError("declaration") ? " is-invalid" : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="new-claim-risk-input"
                  checked={form.declaration}
                  onChange={(e) => {
                    set("declaration", e.target.checked);
                    touch("declaration");
                  }}
                />
                <span className="new-claim-risk-copy">
                  <span className="new-claim-risk-title">
                    I declare this information is true and complete
                  </span>
                  <span className="new-claim-risk-desc">
                    I confirm that the details, amounts, and evidence I have provided are accurate
                    to the best of my knowledge.
                  </span>
                </span>
              </label>
              {showError("declaration") && (
                <p className="new-claim-field-error" role="alert">
                  {showError("declaration")}
                </p>
              )}
            </section>

            <aside className="new-claim-review" aria-label="Claim summary">
              <h3 className="new-claim-review-title">Ready to submit</h3>
              <dl className="new-claim-review-list">
                <ReviewRow label="Claim" value={form.claim_id} />
                <ReviewRow label="Domain" value="Classified by intake" />
                <ReviewRow label="Claimant" value={form.claimant_name} />
                <ReviewRow
                  label="Loss"
                  value={formatCurrency(form.loss_amount, form.currency)}
                />
                <ReviewRow
                  label="Evidence"
                  value={
                    photos.length || supportingDoc
                      ? `${photos.length} photo${photos.length === 1 ? "" : "s"}${supportingDoc ? " + PDF" : ""}`
                      : "Demo evidence"
                  }
                />
                <ReviewRow
                  label="Declaration"
                  value={form.declaration ? "Signed" : "Not signed"}
                />
              </dl>
            </aside>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="platform-page new-claim-page">
      <div className="platform-split-layout">
        <aside className="platform-split-aside new-claim-aside">
          <PlatformPageBrief
            kicker="Intake"
            title="New claim"
            sub="File any claim — property, medical, accident, or other. Intake classifies the domain from your story; specialists are recruited only when signals warrant it."
          />

          <StepNav currentStep={currentStep} form={form} onGoTo={goToStep} />

          <div className="new-claim-aside-foot">
            <div className="new-claim-guidance" role="note">
              <p className="new-claim-guidance-label">This step</p>
              <p className="new-claim-guidance-text">{step.guidance}</p>
            </div>

            <div className="new-claim-progress">
              <div className="new-claim-progress-meter" aria-hidden>
                <div
                  className="new-claim-progress-fill"
                  style={{ width: `${(completedCount / STEPS.length) * 100}%` }}
                />
              </div>
              <p className="new-claim-progress-caption">
                {completedCount} of {STEPS.length} complete
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary new-claim-demo-btn"
              onClick={loadExample}
            >
              Load example claim
            </button>
          </div>
        </aside>

        <div className="platform-split-main new-claim-main">
          <form id={formId} className="new-claim-form" onSubmit={handleSubmit} noValidate>
            {offline && (
              <p className="new-claim-feedback new-claim-feedback-error" role="status">
                <Icon as={AlertCircle} size={16} className="new-claim-feedback-icon" />
                Gateway offline. Submitting is disabled until the backend is reachable.
              </p>
            )}
            {submitError && (
              <p className="new-claim-feedback new-claim-feedback-error" role="alert">
                <Icon as={CircleAlert} size={16} className="new-claim-feedback-icon" />
                <span>{submitError}</span>
                {submitting && (
                  <button
                    type="button"
                    className="new-claim-retry-link"
                    onClick={resetSubmitState}
                  >
                    Try again
                  </button>
                )}
              </p>
            )}

            <div className="new-claim-guidance new-claim-guidance-mobile" role="note">
              <p className="new-claim-guidance-text">{step.guidance}</p>
            </div>

            <div className="new-claim-panel">
              <header className="new-claim-panel-head">
                <span className="new-claim-panel-icon" aria-hidden>
                  <Icon as={step.icon} size={18} />
                </span>
                <div className="new-claim-panel-meta">
                  <p className="new-claim-panel-kicker">
                    Step {currentStep + 1} of {STEPS.length}
                  </p>
                  <h2 className="new-claim-panel-title">{step.title}</h2>
                  <p className="new-claim-panel-desc">{step.description}</p>
                </div>
              </header>
              <div className="new-claim-panel-body">{renderStepContent()}</div>
            </div>

            <div className="new-claim-actions">
              <div className="new-claim-actions-nav">
                {currentStep > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={submitting}
                    onClick={handleBack}
                  >
                    <Icon as={ChevronLeft} size={16} aria-hidden />
                    Back
                  </button>
                )}
                {!isLastStep ? (
                  <button type="button" className="btn btn-primary" onClick={handleNext}>
                    Continue
                    <Icon as={ChevronRight} size={16} aria-hidden />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting || offline || !form.declaration}
                    aria-busy={submitting}
                  >
                    {submitting ? (
                      <>
                        <Icon as={Loader2} size={16} className="new-claim-spin" aria-hidden />
                        {startupCountdown && startupCountdown > 0
                          ? `Starting agents… ${startupCountdown}s`
                          : "Starting agents…"}
                      </>
                    ) : (
                      "Submit claim"
                    )}
                  </button>
                )}
              </div>
              <div className="new-claim-actions-foot">
                <button
                  type="button"
                  className="new-claim-reset-link"
                  disabled={submitting}
                  onClick={() => {
                    setForm(BLANK);
                    setPhotos([]);
                    setSupportingDoc(null);
                    setSubmitError(null);
                    setTouched({});
                    setSubmitAttempted(false);
                    setStepAttempted(false);
                    setCurrentStep(0);
                  }}
                >
                  Reset form
                </button>
                <p className="new-claim-actions-hint">
                  {isLastStep
                    ? form.declaration
                      ? "Opens the live console when adjudication starts."
                      : "Tick the declaration above to enable submission."
                    : "Complete required fields to continue."}
                </p>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

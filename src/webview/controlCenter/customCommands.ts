import type { ControlCenterCustomCommandDraft } from './contracts';

const TARGET_ID = /^\S{1,256}$/u;

export function readCustomCommandDraft(
  form: HTMLFormElement,
): ControlCenterCustomCommandDraft | undefined {
  const label = form.querySelector<HTMLInputElement>('#custom-command-label');
  const description = form.querySelector<HTMLInputElement>('#custom-command-description');
  const phrases = form.querySelector<HTMLTextAreaElement>('#custom-command-phrases');
  const kind = form.querySelector<HTMLSelectElement>('#custom-command-kind');
  const target = form.querySelector<HTMLInputElement>('#custom-command-target');
  const enabled = form.querySelector<HTMLInputElement>('#custom-command-enabled');
  const agentEnabled = form.querySelector<HTMLInputElement>('#custom-command-agent-enabled');
  const parsedPhrases = parsePhraseLines(phrases?.value ?? '');
  const draft = {
    label: label?.value.trim() ?? '',
    description: description?.value.trim() ?? '',
    phrases: parsedPhrases ?? [],
    kind: kind?.value,
    targetId: target?.value.trim() ?? '',
    enabled: enabled?.checked,
    agentEnabled: agentEnabled?.checked,
  };
  const valid = isCustomCommandDraft(draft);
  for (const field of [label, phrases, kind, target, enabled, agentEnabled]) {
    if (field) field.toggleAttribute('aria-invalid', !valid);
  }
  const summary = form.querySelector<HTMLElement>('#custom-command-error');
  if (summary) {
    summary.hidden = valid;
    if (!valid) summary.focus();
  }
  return valid ? draft as ControlCenterCustomCommandDraft : undefined;
}

export function isCustomCommandDraft(value: {
  label: unknown;
  description: unknown;
  phrases: unknown;
  kind: unknown;
  targetId: unknown;
  enabled: unknown;
  agentEnabled: unknown;
}): value is ControlCenterCustomCommandDraft {
  return bounded(value.label, 1, 80)
    && bounded(value.description, 0, 240)
    && isPhraseList(value.phrases)
    && (value.kind === 'command' || value.kind === 'language-model-tool')
    && typeof value.targetId === 'string'
    && TARGET_ID.test(value.targetId)
    && typeof value.enabled === 'boolean'
    && typeof value.agentEnabled === 'boolean';
}

export function parsePhraseLines(value: string): string[] | undefined {
  const phrases = value.split(/\r?\n/u).map((phrase) => phrase.trim()).filter(Boolean);
  return isPhraseList(phrases) ? phrases : undefined;
}

function isPhraseList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  let total = 0;
  const unique = new Set<string>();
  for (const phrase of value) {
    if (!bounded(phrase, 1, 120) || unique.has(phrase)) return false;
    unique.add(phrase);
    total += Array.from(phrase).length;
  }
  return total <= 1_200;
}

function bounded(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string'
    && Array.from(value).length >= minimum
    && Array.from(value).length <= maximum;
}

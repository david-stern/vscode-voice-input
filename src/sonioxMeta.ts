// Fetch Soniox model list + supported languages.
// Models: GET /v1/models (auth required) — real-time data.
// Languages: hardcoded baseline (stable), best-effort doc scrape for refresh.

const SONIOX_API = 'https://api.soniox.com/v1';
export const SONIOX_MODELS_ENDPOINT = `${SONIOX_API}/models`;
const LANG_DOCS_URL = 'https://soniox.com/docs/stt/concepts/supported-languages';

export interface ModelInfo {
  id: string;
  type?: 'async' | 'realtime' | string;
  description?: string;
}

export type SonioxModelKind = 'async' | 'realtime';

export interface SupersededSonioxModelAlias {
  readonly id: string;
  readonly type: SonioxModelKind;
  readonly status: 'superseded';
  readonly replacement: string;
}

export interface LanguageInfo {
  code: string;
  name: string;
}

export const HARDCODED_LANGUAGES: LanguageInfo[] = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'sq', name: 'Albanian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'eu', name: 'Basque' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'et', name: 'Estonian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'gl', name: 'Galician' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'ko', name: 'Korean' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'ms', name: 'Malay' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'cy', name: 'Welsh' },
];

export const HARDCODED_MODELS: ModelInfo[] = [
  { id: 'stt-async-v5', type: 'async', description: 'Async v5 (active)' },
  { id: 'stt-rt-v5', type: 'realtime', description: 'Real-time v5 (active)' },
];

export const SONIOX_ACTIVE_MODEL_ALLOWLIST: Readonly<Record<SonioxModelKind, readonly string[]>> =
  Object.freeze({
    async: Object.freeze(['stt-async-v5']),
    realtime: Object.freeze(['stt-rt-v5']),
  });

export const SONIOX_SUPERSEDED_MODEL_ALIASES: readonly SupersededSonioxModelAlias[] =
  Object.freeze([
    Object.freeze({
      id: 'stt-async-v4',
      type: 'async',
      status: 'superseded',
      replacement: 'stt-async-v5',
    }),
    Object.freeze({
      id: 'stt-rt-v4',
      type: 'realtime',
      status: 'superseded',
      replacement: 'stt-rt-v5',
    }),
  ]);

/** Resolves persisted v4 aliases without ever selecting an unknown provider model. */
export function resolveSonioxModel(model: string | undefined, type: SonioxModelKind): string {
  const normalized = typeof model === 'string' ? model.trim() : '';
  if (SONIOX_ACTIVE_MODEL_ALLOWLIST[type].includes(normalized)) return normalized;
  const alias = SONIOX_SUPERSEDED_MODEL_ALIASES.find((candidate) => (
    candidate.type === type && candidate.id === normalized
  ));
  return alias?.replacement ?? SONIOX_ACTIVE_MODEL_ALLOWLIST[type][0];
}

/** Metadata remains informational; only this projection is selectable for transport. */
export function allowlistedSonioxModels(models: readonly ModelInfo[]): ModelInfo[] {
  return models.filter((model) => (
    (model.type === 'async' || model.type === 'realtime')
    && SONIOX_ACTIVE_MODEL_ALLOWLIST[model.type].includes(model.id)
  ));
}

export async function fetchModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const response = await fetch(SONIOX_MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error('http');
    const body = (await response.json()) as Record<string, unknown>;
    // Defensive: API may return { models: [...] } or { data: [...] } or top-level array.
    const models =
      (body.models as ModelInfo[] | undefined) ??
      (body.data as ModelInfo[] | undefined) ??
      (Array.isArray(body) ? (body as unknown as ModelInfo[]) : null);
    if (!models || models.length === 0) throw new Error('shape');
    return models.map((model) => ({
      id: String((model as { id?: string }).id ?? (model as { model?: string }).model ?? ''),
      type: (model as { type?: string }).type,
      description:
        (model as { description?: string }).description ??
        (model as { display_name?: string }).display_name,
    })).filter((model) => model.id);
  } catch {
    // Provider response bodies, credentials and raw network errors stay at this boundary.
    throw new Error('Soniox model metadata is unavailable');
  }
}

/**
 * Best-effort scrape of the public docs page. Falls back to the hardcoded
 * list on any failure. Languages change rarely — the hardcoded list is the
 * primary source of truth, this just lets users refresh on demand.
 */
export async function fetchLanguages(): Promise<LanguageInfo[]> {
  try {
    const res = await fetch(LANG_DOCS_URL);
    if (!res.ok) throw new Error(`docs HTTP ${res.status}`);
    const html = await res.text();
    const langs = parseLangsFromHtml(html);
    if (langs.length < 30) throw new Error(`scrape gave only ${langs.length} entries`);
    return [{ code: 'auto', name: 'Auto-detect' }, ...langs];
  } catch {
    return HARDCODED_LANGUAGES;
  }
}

function parseLangsFromHtml(html: string): LanguageInfo[] {
  // Find <table> rows with "<td>Name</td><td>code</td>" pattern.
  const out: LanguageInfo[] = [];
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  const scope = tableMatch ? tableMatch[0] : html;
  const rowRe = /<tr[^>]*>\s*<td[^>]*>\s*([A-Za-z][A-Za-z\s\-']*)\s*<\/td>\s*<td[^>]*>\s*([a-z]{2,3})\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(scope))) {
    out.push({ name: m[1].trim(), code: m[2].trim() });
  }
  return out;
}

// Fetch Soniox model list + supported languages.
// Models: GET /v1/models (auth required) — real-time data.
// Languages: hardcoded baseline (stable), best-effort doc scrape for refresh.

import { log } from './log';

const SONIOX_API = 'https://api.soniox.com/v1';
const LANG_DOCS_URL = 'https://soniox.com/docs/stt/concepts/supported-languages';

export interface ModelInfo {
  id: string;
  type?: 'async' | 'realtime' | string;
  description?: string;
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
  { id: 'stt-async-v4', type: 'async', description: 'Async v4 (recommended)' },
  { id: 'stt-rt-v4', type: 'realtime', description: 'Real-time v4' },
];

export async function fetchModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch(`${SONIOX_API}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Soniox /v1/models HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  // Defensive: API may return { models: [...] } or { data: [...] } or top-level array.
  const arr =
    (body.models as ModelInfo[] | undefined) ??
    (body.data as ModelInfo[] | undefined) ??
    (Array.isArray(body) ? (body as unknown as ModelInfo[]) : null);
  if (!arr || arr.length === 0) {
    log('soniox /v1/models: unexpected shape', body);
    throw new Error('Soniox /v1/models returned unexpected shape');
  }
  return arr.map((m) => ({
    id: String((m as { id?: string }).id ?? (m as { model?: string }).model ?? ''),
    type: (m as { type?: string }).type,
    description:
      (m as { description?: string }).description ??
      (m as { display_name?: string }).display_name,
  })).filter((m) => m.id);
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
    log('languages scraped:', langs.length);
    return [{ code: 'auto', name: 'Auto-detect' }, ...langs];
  } catch (e) {
    log('language scrape failed, using hardcoded:', (e as Error).message);
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

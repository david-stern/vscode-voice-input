import type { CredentialService } from '../../config';
import {
  HARDCODED_LANGUAGES,
  HARDCODED_MODELS,
  fetchLanguages,
  fetchModels,
  type LanguageInfo,
  type ModelInfo,
} from '../../sonioxMeta';

export interface MetadataViewPort {
  postMeta(
    models: ModelInfo[],
    languages: LanguageInfo[],
    loading: boolean,
    error?: string,
  ): void;
}

export interface MetadataState {
  models: ModelInfo[];
  languages: LanguageInfo[];
  loading: boolean;
  error?: string;
}

/** Owns best-effort Soniox metadata refresh without exposing the credential. */
export class TranscriptionMetadataService {
  private revision = 0;
  private readonly metadata: MetadataState = {
    models: [...HARDCODED_MODELS],
    languages: [...HARDCODED_LANGUAGES],
    loading: false,
  };

  constructor(
    private readonly credentials: Pick<CredentialService, 'status' | 'use'>,
    private readonly view: MetadataViewPort,
    private readonly logger: (message: string) => void,
  ) {}

  get state(): MetadataState {
    return {
      models: this.metadata.models.map((model) => ({ ...model })),
      languages: this.metadata.languages.map((language) => ({ ...language })),
      loading: this.metadata.loading,
      error: this.metadata.error,
    };
  }

  async refresh(): Promise<void> {
    const revision = ++this.revision;
    this.metadata.loading = true;
    this.metadata.error = undefined;
    this.publish();
    let models = this.metadata.models;
    let languages = this.metadata.languages;
    let metadataError: string | undefined;
    const tasks: Promise<void>[] = [];
    const configured = (await this.credentials.status('soniox')).configured;
    if (revision !== this.revision) return;
    if (configured) {
      tasks.push(this.credentials.use('soniox', async (apiKey) => {
        try {
          models = await fetchModels(apiKey);
          this.logger(`models fetched: ${models.length}`);
        } catch {
          this.logger('models fetch failed: unavailable');
          metadataError = 'models: unavailable';
        }
      }).then(() => undefined));
    } else {
      this.logger('no api key — skipping model fetch');
    }
    tasks.push(fetchLanguages()
      .then((fetchedLanguages) => { languages = fetchedLanguages; })
      .catch(() => { this.logger('languages fetch failed: unavailable'); }));
    await Promise.all(tasks);
    if (revision !== this.revision) return;
    this.metadata.models = models;
    this.metadata.languages = languages;
    this.metadata.error = metadataError;
    this.metadata.loading = false;
    this.publish();
  }

  private publish(): void {
    this.view.postMeta(
      this.metadata.models,
      this.metadata.languages,
      this.metadata.loading,
      this.metadata.error,
    );
  }
}

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

export interface MetadataNetworkAuthority {
  selected(): boolean;
  capture(): PromiseLike<Readonly<object> | undefined> | Readonly<object> | undefined;
  revalidate(authority: Readonly<object>): PromiseLike<boolean> | boolean;
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
    private readonly networkAuthority?: MetadataNetworkAuthority,
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
    if (this.networkAuthority && !this.networkAuthority.selected()) {
      this.logger('Soniox not selected — publishing packaged metadata without network');
      this.metadata.loading = false;
      this.publish();
      return;
    }
    const configured = (await this.credentials.status('soniox')).configured;
    if (revision !== this.revision) return;
    const authority = configured && this.networkAuthority
      ? await this.captureNetworkAuthority()
      : undefined;
    if (revision !== this.revision) return;
    if (configured && (!this.networkAuthority || authority)) {
      tasks.push(this.credentials.use('soniox', async (apiKey) => {
        if (authority && !await this.networkAuthority!.revalidate(authority)) return;
        // Models and languages are independent sources with independent failure modes:
        // the best-effort docs scrape must never be able to hide a successful model
        // fetch, and a failed model fetch must never drop the language list.
        const [modelResult, languageResult] = await Promise.allSettled([
          fetchModels(apiKey),
          fetchLanguages(),
        ]);
        if (modelResult.status === 'fulfilled') {
          models = modelResult.value;
          this.logger(`models fetched: ${models.length}`);
        } else {
          this.logger('models fetch failed: unavailable');
          metadataError = 'models: unavailable';
        }
        if (languageResult.status === 'fulfilled') {
          languages = languageResult.value;
        } else {
          this.logger('languages fetch failed: packaged list retained');
        }
      }).then(() => undefined));
    } else {
      this.logger('Soniox metadata gate incomplete — skipping network fetch');
    }
    await Promise.all(tasks);
    if (revision !== this.revision) return;
    this.metadata.models = models;
    this.metadata.languages = languages;
    this.metadata.error = metadataError;
    this.metadata.loading = false;
    this.publish();
  }

  private async captureNetworkAuthority(): Promise<Readonly<object> | undefined> {
    if (!this.networkAuthority) return undefined;
    try {
      const authority = await this.networkAuthority.capture();
      return authority && await this.networkAuthority.revalidate(authority)
        ? authority
        : undefined;
    } catch {
      return undefined;
    }
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

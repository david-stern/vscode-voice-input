import {
  DEFAULT_CONTROL_CENTER_CAPABILITIES,
  type ControlCenterDeepLink,
  type ControlCenterDisplayState,
  type ControlCenterFocusTarget,
  type ControlCenterHostMessage,
  type ControlCenterAgentRow,
  type ControlCenterCustomCommandRow,
  type ControlCenterManagementPageProjection,
  type ControlCenterPlanningProviderProjection,
} from '../../webview/controlCenter/contracts';
import {
  nextControlCenterRevision,
  normalizeControlCenterDeepLink,
  parseControlCenterBrowserMessage,
  parseControlCenterHostMessage,
  sanitizeControlCenterDisplayState,
} from '../../webview/controlCenter/protocol';
import type {
  ControlCenterCommandPageProjection,
  ControlCenterControllerOptions,
  ControlCenterDisposable,
  ControlCenterPanelFactory,
  ControlCenterPanelPort,
  ControlCenterPersistence,
  ControlCenterStateSource,
} from './controllerContracts';

export type {
  ControlCenterCommandPageProjection,
  ControlCenterControllerOptions,
  ControlCenterDisposable,
  ControlCenterIntentResult,
  ControlCenterPanelFactory,
  ControlCenterPanelPort,
  ControlCenterPersistence,
  ControlCenterStateSource,
} from './controllerContracts';

const DISPLAY_STATE_KEY = 'voiceInput.controlCenter.display.v1';

const DEFAULT_SOURCE: ControlCenterStateSource = {
  readProjection: () => ({
    routeState: 'not-configured',
    language: 'en',
    direction: 'ltr',
    effectiveAutoMode: false,
    capabilities: { ...DEFAULT_CONTROL_CENTER_CAPABILITIES },
  }),
  readCommandPage: () => ({ filteredCount: 0, rows: [] }),
};

/**
 * Owns the one serialized panel lifecycle, the host revision, and bounded display state.
 * Speech sessions, pending actions, secrets, and authority deliberately remain outside.
 */
export class ControlCenterController implements ControlCenterDisposable {
  private readonly factory: ControlCenterPanelFactory;
  private readonly persistence: ControlCenterPersistence;
  private readonly source: ControlCenterStateSource;
  private panel: ControlCenterPanelPort | undefined;
  private panelSubscriptions: ControlCenterDisposable[] = [];
  private display: ControlCenterDisplayState;
  private transient: Pick<ControlCenterDeepLink['params'], 'commandId' | 'setupStep'> = {};
  private pendingExplicit: ControlCenterDeepLink | undefined;
  private revision = 0;
  private sentRevision: number | undefined;
  private acknowledgedRevision: number | undefined;
  private browserReady = false;
  private panelGeneration = 0;
  private disposed = false;
  private intentSignatures = new Set<string>();
  private agentPage = 1;
  private customCommandPage = 1;
  private serial: Promise<void> = Promise.resolve();
  constructor(options: ControlCenterControllerOptions) {
    this.factory = options.factory;
    this.persistence = options.persistence;
    this.source = options.source ?? DEFAULT_SOURCE;
    this.display = sanitizeControlCenterDisplayState(this.persistence.get(DISPLAY_STATE_KEY));
  }
  get generation(): number { return this.panelGeneration; }
  get currentDisplayState(): Readonly<ControlCenterDisplayState> { return { ...this.display }; }
  get hasPanel(): boolean { return Boolean(this.panel); }
  createOrShow(route?: unknown, params?: unknown): Promise<void> {
    if (route !== undefined) {
      this.pendingExplicit = normalizeControlCenterDeepLink(route, params, {
        isKnownCommandId: (id) => this.isKnownCommandId(id),
      });
    }
    return this.enqueue(async () => {
      if (this.disposed) return;
      if (!this.panel) this.attach(this.factory.create());
      this.panel?.reveal();
      if (this.browserReady && this.pendingExplicit) await this.publishSnapshot({ kind: 'route-h1' });
    });
  }
  adoptOrCreate(restoredPanel: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) return;
      const candidate = this.factory.adopt(restoredPanel);
      if (this.panel && this.panel.identity !== candidate.identity) {
        candidate.dispose();
        if (this.browserReady && this.pendingExplicit) await this.publishSnapshot({ kind: 'route-h1' });
        return;
      }
      if (!this.panel) this.attach(candidate);
    });
  }
  refresh(focusTarget?: ControlCenterFocusTarget): Promise<void> {
    return this.enqueue(async () => {
      if (this.browserReady && this.panel) await this.publishSnapshot(focusTarget);
    });
  }
  postStatus(
    status: Omit<Extract<ControlCenterHostMessage, { type: 'statusUpdate' }>, 'type' | 'revision'>,
  ): Promise<void> {
    return this.postEphemeral({ type: 'statusUpdate', revision: this.revision, ...status });
  }

  postTranscript(
    transcript: Omit<Extract<ControlCenterHostMessage, { type: 'transcriptUpdate' }>, 'type' | 'revision'>,
  ): Promise<void> {
    return this.postEphemeral({ type: 'transcriptUpdate', revision: this.revision, ...transcript });
  }

  postCommandDetails(
    details: Omit<Extract<ControlCenterHostMessage, { type: 'commandDetails' }>, 'type' | 'revision'>,
  ): Promise<void> {
    return this.postEphemeral({ type: 'commandDetails', revision: this.revision, ...details });
  }

  whenIdle(): Promise<void> { return this.serial; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const current = this.panel;
    this.invalidatePanelAuthority(current);
    this.clearPanel(current);
    current?.dispose();
    this.pendingExplicit = undefined;
    this.intentSignatures.clear();
  }
  private enqueue(operation: () => Promise<void> | void): Promise<void> {
    this.serial = this.serial.then(operation, operation);
    return this.serial;
  }
  private attach(panel: ControlCenterPanelPort): void {
    this.clearPanel(this.panel);
    this.panel = panel;
    this.browserReady = false;
    this.sentRevision = undefined;
    this.acknowledgedRevision = undefined;
    this.panelGeneration += 1;
    this.panelSubscriptions = [
      panel.onMessage((message) => { void this.enqueue(() => this.handleBrowserMessage(message)); }),
      panel.onDispose(() => {
        if (this.panel?.identity !== panel.identity) return;
        this.invalidatePanelAuthority(panel);
        void this.enqueue(() => {
          if (this.panel?.identity !== panel.identity) return;
          this.clearPanel(panel);
        });
      }),
    ];
  }
  private clearPanel(panel: ControlCenterPanelPort | undefined): void {
    if (!panel || this.panel?.identity !== panel.identity) return;
    for (const subscription of this.panelSubscriptions.splice(0)) subscription.dispose();
    this.panel = undefined;
    this.browserReady = false;
    this.sentRevision = undefined;
    this.acknowledgedRevision = undefined;
    this.transient = {};
    this.agentPage = 1;
    this.customCommandPage = 1;
    this.intentSignatures.clear();
  }
  private async handleBrowserMessage(raw: unknown): Promise<void> {
    const message = parseControlCenterBrowserMessage(raw, {
      isKnownCommandId: (id) => this.isKnownCommandId(id),
    });
    if (!message) {
      this.source.logRejected?.('browser-message', 'invalid-envelope');
      return;
    }
    if (message.type === 'ready') {
      this.browserReady = true;
      this.agentPage = 1;
      this.customCommandPage = 1;
      await this.publishSnapshot(this.pendingExplicit ? { kind: 'route-h1' } : undefined);
      return;
    }
    if (message.type === 'ack') {
      if (message.revision === this.sentRevision && message.revision === this.revision) {
        this.acknowledgedRevision = message.revision;
      }
      return;
    }
    if (message.revision !== this.revision
      || this.sentRevision !== this.revision
      || this.acknowledgedRevision !== this.revision) {
      this.source.logRejected?.('browser-message', 'stale-revision');
      return;
    }
    const signature = JSON.stringify(message);
    if (this.intentSignatures.has(signature)) {
      this.source.logRejected?.('browser-message', 'duplicate-intent');
      return;
    }
    this.intentSignatures.add(signature);

    if (message.type === 'navigateIntent') {
      this.display = {
        route: message.route,
        ...(message.params?.filter === undefined ? {} : { filter: message.params.filter }),
        ...(message.params?.page === undefined ? {} : { page: message.params.page }),
      };
      this.transient = {
        ...(message.params?.commandId === undefined ? {} : { commandId: message.params.commandId }),
        ...(message.params?.setupStep === undefined ? {} : { setupStep: message.params.setupStep }),
      };
      await this.persistDisplay();
      await this.publishSnapshot(message.params?.commandId
        ? { kind: 'command-row', commandId: message.params.commandId }
        : { kind: 'route-h1' });
      return;
    }
    if (message.type === 'setFilterIntent') {
      this.display = { ...this.display, filter: message.filter, page: 1 };
      await this.persistDisplay();
      await this.publishSnapshot({ kind: 'results-heading' }, true);
      return;
    }
    if (message.type === 'setPageIntent') {
      this.display = { ...this.display, page: message.page };
      await this.persistDisplay();
      await this.publishSnapshot({ kind: 'results-heading' }, true);
      return;
    }
    if (message.type === 'setManagementPageIntent') {
      if (message.target === 'agents') this.agentPage = message.page;
      else this.customCommandPage = message.page;
      await this.publishSnapshot({ kind: 'results-heading' });
      return;
    }

    const result = await this.source.handleIntent?.(message, this.currentDisplayState);
    if (result?.commandDetails) await this.postProjected({
      type: 'commandDetails', revision: this.revision, ...result.commandDetails,
    });
    if (result?.customCommandDetails) await this.postProjected({
      type: 'customCommandDetails', revision: this.revision, ...result.customCommandDetails,
    });
    if (result?.refresh) await this.publishSnapshot(result.focusTarget);
  }
  private async publishSnapshot(
    focusTarget?: ControlCenterFocusTarget,
    preferFirstCommand = false,
  ): Promise<void> {
    const panel = this.panel;
    if (!panel || !this.browserReady) return;
    await this.applyPendingExplicit();
    const projection = await this.source.readProjection(this.currentDisplayState);
    let commandProjection = this.display.route === 'commands'
      ? await this.source.readCommandPage(this.currentDisplayState)
      : undefined;
    const planningProjection = this.display.route === 'assistant'
      ? await this.readPlanningProviders()
      : undefined;
    let agentProjection = this.display.route === 'assistant'
      ? await this.readAgentPage(this.agentPage)
      : undefined;
    let customCommandProjection = this.display.route === 'commands'
      ? await this.readCustomCommandPage(this.customCommandPage)
      : undefined;
    if (commandProjection) {
      const totalPages = Math.max(1, Math.ceil(commandProjection.filteredCount / 25));
      if ((this.display.page ?? 1) > totalPages) {
        this.display = { ...this.display, page: totalPages };
        await this.persistDisplay();
        commandProjection = await this.source.readCommandPage(this.currentDisplayState);
      }
    }
    if (agentProjection) {
      const totalPages = Math.max(1, Math.ceil(agentProjection.totalCount / 8));
      if (this.agentPage > totalPages) {
        this.agentPage = totalPages;
        agentProjection = await this.readAgentPage(this.agentPage);
      }
    }
    if (customCommandProjection) {
      const totalPages = Math.max(1, Math.ceil(customCommandProjection.totalCount / 10));
      if (this.customCommandPage > totalPages) {
        this.customCommandPage = totalPages;
        customCommandProjection = await this.readCustomCommandPage(this.customCommandPage);
      }
    }
    const commandPage = commandProjection ? this.commandPageFor(commandProjection) : undefined;
    if (this.display.route === 'commands' && !commandPage) {
      this.source.logRejected?.('command-page', 'inconsistent-projection');
      return;
    }
    this.revision = nextControlCenterRevision(this.revision);
    this.intentSignatures.clear();
    const effectiveFocusTarget = preferFirstCommand && commandProjection?.rows[0]
      ? { kind: 'command-row' as const, commandId: commandProjection.rows[0].commandId }
      : focusTarget;
    const snapshot: ControlCenterHostMessage = {
      type: 'stateSnapshot',
      revision: this.revision,
      state: {
        ...this.display,
        routeState: projection.routeState,
        ...this.transient,
        language: projection.language,
        direction: projection.direction,
        effectiveAutoMode: projection.effectiveAutoMode,
        ...(projection.pendingReview ? { pendingReview: projection.pendingReview } : {}),
        ...(commandPage ? { commandPage } : {}),
      },
      capabilities: {
        sttProvider: projection.capabilities.sttProvider,
        sttState: projection.capabilities.sttState,
        streamingPartials: projection.capabilities.streamingPartials,
        systemTtsState: projection.capabilities.systemTtsState,
        localSpeechState: 'pending-not-available',
        remoteProcessing: projection.capabilities.remoteProcessing,
      },
      ...(effectiveFocusTarget ? { focusTarget: effectiveFocusTarget } : {}),
    };
    if (!this.validOutbound(snapshot)) return;
    this.sentRevision = this.revision;
    this.acknowledgedRevision = undefined;
    await panel.postMessage(snapshot);
    if (commandProjection && commandPage && commandPage.pageRowCount > 0) {
      for (let offset = 0, chunkIndex = 1; offset < commandProjection.rows.length; offset += 10, chunkIndex += 1) {
        const message: ControlCenterHostMessage = {
          type: 'commandPageChunk',
          revision: this.revision,
          chunkIndex,
          chunkCount: commandPage.chunkCount,
          rows: commandProjection.rows.slice(offset, offset + 10).map((row) => ({ ...row })),
        };
        if (!this.validOutbound(message)) return;
        await panel.postMessage(message);
      }
    }
    if (planningProjection && agentProjection) {
      await this.postProjected({
        type: 'planningProviderState', revision: this.revision,
        selectedProvider: planningProjection.selectedProvider,
        items: planningProjection.items.map((item) => ({ ...item })),
      });
      await this.postProjected({
        type: 'agentPageState', revision: this.revision,
        pageIndex: this.agentPage, pageSize: 8,
        totalCount: agentProjection.totalCount,
        pageRowCount: agentProjection.rows.length,
        items: agentProjection.rows.map((item) => ({ ...item })),
      });
    }
    if ((this.display.route === 'home' || this.display.route === 'voice')
      && this.source.readSetupState) {
      await this.postProjected({
        type: 'setupState', revision: this.revision, ...this.source.readSetupState(),
      });
    }
    if (this.display.route === 'diagnostics' && this.source.readDiagnosticsState) {
      await this.postProjected({
        type: 'diagnosticsState', revision: this.revision, ...this.source.readDiagnosticsState(),
      });
    }
    if (customCommandProjection) {
      await this.postProjected({
        type: 'customCommandPageState', revision: this.revision,
        pageIndex: this.customCommandPage, pageSize: 10,
        totalCount: customCommandProjection.totalCount,
        pageRowCount: customCommandProjection.rows.length,
        items: customCommandProjection.rows.map((item) => ({ ...item })),
      });
    }
  }
  private async readPlanningProviders(): Promise<ControlCenterPlanningProviderProjection> {
    return this.source.readPlanningProviders
      ? await this.source.readPlanningProviders()
      : { selectedProvider: 'off', items: [] };
  }
  private async readAgentPage(
    page: number,
  ): Promise<ControlCenterManagementPageProjection<ControlCenterAgentRow>> {
    return this.source.readAgentPage
      ? await this.source.readAgentPage(page)
      : { totalCount: 0, rows: [] };
  }
  private async readCustomCommandPage(
    page: number,
  ): Promise<ControlCenterManagementPageProjection<ControlCenterCustomCommandRow>> {
    return this.source.readCustomCommandPage
      ? await this.source.readCustomCommandPage(page)
      : { totalCount: 0, rows: [] };
  }
  private async postProjected(message: ControlCenterHostMessage): Promise<void> {
    if (!this.panel || !this.validOutbound(message)) return;
    await this.panel.postMessage(message);
  }
  private commandPageFor(projection: ControlCenterCommandPageProjection) {
    const pageIndex = this.display.page ?? 1;
    if (!Number.isInteger(projection.filteredCount)
      || projection.filteredCount < 0
      || projection.filteredCount > 100
      || projection.rows.length > 25) return undefined;
    const totalPages = Math.max(1, Math.ceil(projection.filteredCount / 25));
    if (pageIndex > totalPages) return undefined;
    const expectedRows = Math.min(25, Math.max(0, projection.filteredCount - ((pageIndex - 1) * 25)));
    if (projection.rows.length !== expectedRows) return undefined;
    return {
      pageIndex,
      pageSize: 25 as const,
      filteredCount: projection.filteredCount,
      pageRowCount: projection.rows.length,
      chunkCount: Math.ceil(projection.rows.length / 10),
    };
  }

  private async applyPendingExplicit(): Promise<void> {
    const deepLink = this.pendingExplicit;
    if (!deepLink) return;
    this.pendingExplicit = undefined;
    this.display = {
      route: deepLink.route,
      ...(deepLink.params.filter === undefined ? {} : { filter: deepLink.params.filter }),
      ...(deepLink.params.page === undefined ? {} : { page: deepLink.params.page }),
    };
    this.transient = {
      ...(deepLink.params.commandId === undefined ? {} : { commandId: deepLink.params.commandId }),
      ...(deepLink.params.setupStep === undefined ? {} : { setupStep: deepLink.params.setupStep }),
    };
    await this.persistDisplay();
  }

  private persistDisplay(): Promise<void> {
    return Promise.resolve(this.persistence.update(DISPLAY_STATE_KEY, { ...this.display }));
  }

  private postEphemeral(message: ControlCenterHostMessage): Promise<void> {
    return this.enqueue(async () => {
      if (!this.panel || !this.browserReady || message.revision !== this.revision) return;
      if (!this.validOutbound(message)) return;
      await this.panel.postMessage(message);
    });
  }

  private validOutbound(message: ControlCenterHostMessage): boolean {
    const parsed = parseControlCenterHostMessage(message, {
      isKnownCommandId: (id) => this.isKnownCommandId(id),
    });
    if (parsed) return true;
    this.source.logRejected?.('outbound-message', message.type);
    return false;
  }

  private invalidatePanelAuthority(panel: ControlCenterPanelPort | undefined): void {
    if (!panel || this.panel?.identity !== panel.identity) return;
    this.panelGeneration = nextControlCenterRevision(this.panelGeneration);
    this.source.invalidateAuthority?.();
  }

  private isKnownCommandId(commandId: string): boolean {
    return this.source.isKnownCommandId?.(commandId) ?? true;
  }
}

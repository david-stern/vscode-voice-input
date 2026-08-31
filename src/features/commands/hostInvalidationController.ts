export interface HostInvalidationControllerOptions {
  isTargetTransitioning(): boolean;
  clearPendingSend(): void;
  cancelMapping(): void;
  invalidatePlanning(): void;
  stopAssistant(): PromiseLike<void>;
  publish(): Promise<void> | void;
  publishSettings(reason: 'configuration' | 'trust'): Promise<void> | void;
}

/** Centralizes authority invalidation when host focus, trust or configuration changes. */
export class HostInvalidationController {
  constructor(private readonly options: HostInvalidationControllerOptions) {}

  configurationChanged(affectsVoiceInput: boolean, affectsAudioDevice = false): void {
    if (!affectsVoiceInput) return;
    this.options.cancelMapping();
    this.options.invalidatePlanning();
    if (affectsAudioDevice) void this.options.stopAssistant();
    void this.options.publish();
    void this.options.publishSettings('configuration');
  }

  workspaceTrustGranted(): void {
    this.options.cancelMapping();
    this.options.invalidatePlanning();
    void this.options.stopAssistant();
    void this.options.publish();
    void this.options.publishSettings('trust');
  }

  windowFocusChanged(focused: boolean): void {
    if (!focused) this.targetChanged();
  }

  targetChanged(): void {
    if (this.options.isTargetTransitioning()) return;
    this.options.clearPendingSend();
    this.options.cancelMapping();
  }
}

import type { AssistantFeature } from '../assistant';
import type { MappingFeature } from '../mappings';
import type { HostStatePublisher } from '../state';
import { HostInvalidationController } from './hostInvalidationController';

export interface HostLifecycleOptions {
  target: { readonly isTransitioning: boolean };
  assistant: Pick<AssistantFeature, 'clearPendingSend' | 'invalidatePlanning' | 'stop'>;
  mappings: Pick<MappingFeature, 'cancel'>;
  state: Pick<HostStatePublisher, 'pushFull'>;
  settings: {
    externalConfigurationChanged(): void;
    externalWorkspaceTrustChanged(): void;
  };
}

/** Composes the host-neutral invalidation policy used by the VS Code lifecycle adapter. */
export function createHostInvalidationController(
  options: HostLifecycleOptions,
): HostInvalidationController {
  return new HostInvalidationController({
    isTargetTransitioning: () => options.target.isTransitioning,
    clearPendingSend: () => options.assistant.clearPendingSend(false),
    cancelMapping: () => options.mappings.cancel(false),
    invalidatePlanning: () => options.assistant.invalidatePlanning(),
    stopAssistant: () => options.assistant.stop(),
    publish: () => options.state.pushFull(),
    publishSettings: (reason) => {
      if (reason === 'configuration') options.settings.externalConfigurationChanged();
      else options.settings.externalWorkspaceTrustChanged();
    },
  });
}

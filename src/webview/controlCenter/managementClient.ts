import type {
  ControlCenterBrowserMessage,
  ControlCenterPlanningProviderId,
} from './contracts';

type PostMessage = (message: ControlCenterBrowserMessage) => void;

export function submitProviderProfile(
  form: HTMLFormElement,
  revision: number,
  post: PostMessage,
): void {
  const provider = form.dataset.providerId as ControlCenterPlanningProviderId | undefined;
  const enabled = form.querySelector<HTMLInputElement>('[data-field="provider-enabled"]')?.checked;
  const model = form.querySelector<HTMLInputElement>('[data-field="provider-model"]')?.value.trim();
  if (!provider || enabled === undefined || !model) return;
  post({ type: 'planningProviderIntent', revision, provider,
    operation: 'save-profile', enabled, model });
}

export function submitAgentProfile(
  form: HTMLFormElement,
  revision: number,
  post: PostMessage,
): void {
  const id = form.dataset.agentId;
  const provider = form.querySelector<HTMLSelectElement>('[data-field="agent-provider"]')?.value;
  const model = form.querySelector<HTMLInputElement>('[data-field="agent-model"]')?.value.trim();
  if (!id || !provider || !model) return;
  post({ type: 'agentManagementIntent', revision, operation: 'update-profile',
    id, provider: provider as ControlCenterPlanningProviderId, model });
}

export function postPlanningProviderAction(
  action: string | undefined,
  target: HTMLElement,
  revision: number,
  post: PostMessage,
): void {
  const provider = target.closest<HTMLElement>('[data-provider-id]')?.dataset.providerId as
    ControlCenterPlanningProviderId | undefined;
  const operations = {
    'set-provider-credential': 'set-credential',
    'replace-provider-credential': 'replace-credential',
    'clear-provider-credential': 'clear-credential',
    'test-planning-provider': 'test',
    'cancel-planning-provider-test': 'cancel-test',
    'review-provider-consent': 'review-consent',
    'revoke-provider-consent': 'revoke-consent',
  } as const;
  const operation = action ? operations[action as keyof typeof operations] : undefined;
  if (provider && operation) post({
    type: 'planningProviderIntent', revision, provider, operation,
  });
}

export function postAgentAction(
  action: string | undefined,
  target: HTMLElement,
  revision: number,
  post: PostMessage,
): void {
  const id = target.closest<HTMLElement>('[data-agent-id]')?.dataset.agentId;
  if (!id) return;
  if (action === 'toggle-agent-enabled') post({
    type: 'agentManagementIntent', revision,
    operation: 'set-enabled', id, enabled: target.dataset.enabled === 'true',
  });
  else if (action === 'set-default-agent') post({
    type: 'agentManagementIntent', revision, operation: 'set-default', id,
  });
  else if (action === 'duplicate-agent') post({
    type: 'agentManagementIntent', revision, operation: 'duplicate', id,
  });
  else if (action === 'delete-agent') post({
    type: 'agentManagementIntent', revision, operation: 'delete', id,
  });
}

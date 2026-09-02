export const CONTROL_CENTER_PLANNING_PROVIDERS = [
  'deepseek',
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'ollama',
  'bedrock',
  'grok',
] as const;

export type ControlCenterPlanningProviderId =
  (typeof CONTROL_CENTER_PLANNING_PROVIDERS)[number];
export type ControlCenterPlanningProviderSelection = 'off' | ControlCenterPlanningProviderId;

export const CONTROL_CENTER_AGENT_TEMPLATES = [
  'teacher-lecturer',
  'secretary',
  'friend',
  'tour-guide',
  'mathematician',
  'philosopher',
] as const;

export type ControlCenterAgentTemplateId = (typeof CONTROL_CENTER_AGENT_TEMPLATES)[number];

export interface ControlCenterPlanningProvider {
  id: ControlCenterPlanningProviderId;
  name: string;
  enabled: boolean;
  model: string;
  locality: 'local-loopback' | 'remote';
  credentialRequired: boolean;
  credentialConfigured: boolean;
  consentRequired: boolean;
  consentAcknowledged: boolean;
}

export interface ControlCenterAgentRow {
  id: string;
  name: string;
  description: string;
  provider: ControlCenterPlanningProviderId;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  instructionsConfigured: boolean;
}

export interface ControlCenterCustomCommandRow {
  id: string;
  label: string;
  description: string;
  kind: 'command' | 'language-model-tool';
  targetId: string;
  enabled: boolean;
  agentEnabled: boolean;
}

export interface ControlCenterCustomCommandDraft {
  label: string;
  description: string;
  phrases: string[];
  kind: 'command' | 'language-model-tool';
  targetId: string;
  enabled: boolean;
  agentEnabled: boolean;
}

export interface ControlCenterCustomCommandDetails extends ControlCenterCustomCommandDraft {
  id: string;
}

export interface ControlCenterPlanningProviderProjection {
  selectedProvider: ControlCenterPlanningProviderSelection;
  items: readonly ControlCenterPlanningProvider[];
}

export interface ControlCenterManagementPageProjection<Row> {
  totalCount: number;
  rows: readonly Row[];
}

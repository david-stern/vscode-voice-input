import { SAFE_ASSISTANT_ACTIONS, type SafeAssistantAction } from './policy';
import {
  OpenAICompatibleChatPlannerClient,
  PLANNER_TARGETS,
  PlannerError,
  REMOTE_PLANNER_ACTIONS,
  buildPlannerMessages,
  getProviderDescriptor,
  parseAssistantPlan,
  type AssistantPlan,
  type MinimalTargetMetadata as SharedMinimalTargetMetadata,
  type PlannerErrorCode,
  type PlannerInput,
  type PlannerLogEvent,
  type PlannerRuntimeOptions,
  type PlannerTarget,
  type PlannerTargetKind,
} from '../inference';

/** @deprecated Use the provider-neutral exports from `../inference`. */
export const DEFAULT_DEEPSEEK_MODEL = getProviderDescriptor('deepseek').defaultModel;

/** @deprecated Use SAFE_ASSISTANT_ACTIONS from `./policy`. */
export const SMART_ASSISTANT_ACTIONS = SAFE_ASSISTANT_ACTIONS;
export type SmartAssistantAction = SafeAssistantAction;

/** A remote model can request a send, but can never confirm one. */
export const DEEPSEEK_MODEL_ACTIONS = REMOTE_PLANNER_ACTIONS;

/** @deprecated Use PLANNER_TARGETS from `../inference`. */
export const SMART_ASSISTANT_TARGETS = PLANNER_TARGETS;
export type SmartAssistantTarget = PlannerTarget;
export type TargetKind = PlannerTargetKind;
export type MinimalTargetMetadata = SharedMinimalTargetMetadata;

export type DeepSeekPlan = AssistantPlan;
export type DeepSeekPlanningInput = PlannerInput;
export type DeepSeekLogEvent = PlannerLogEvent;

export interface DeepSeekClientOptions extends PlannerRuntimeOptions {
  apiKey: string;
}

export type DeepSeekErrorCode = PlannerErrorCode;
export { PlannerError as DeepSeekClientError };

/** @deprecated Build provider-neutral prompts with buildPlannerMessages. */
export const buildDeepSeekPlanningMessages = buildPlannerMessages;

/** @deprecated Parse provider-neutral plans with parseAssistantPlan. */
export const parseDeepSeekPlan = parseAssistantPlan;

/** Compatibility facade for existing DeepSeek-only feature wiring. */
export async function planWithDeepSeek(
  input: DeepSeekPlanningInput,
  options: DeepSeekClientOptions,
): Promise<DeepSeekPlan> {
  return new OpenAICompatibleChatPlannerClient('deepseek', options).plan(input);
}

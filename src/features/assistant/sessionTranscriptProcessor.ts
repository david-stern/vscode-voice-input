import {
  DEFAULT_WAKE_PHRASES,
  isWakeOnlyUtterance,
  parseAssistantCommand,
  parseAssistantText,
  trimAssistantCommand,
  type AssistantIntent,
} from '../../assistant';
import type { TargetSnapshot } from '../../assistant/context';
import type { SettingsRepository } from '../../config';
import { PlannerError } from '../../inference';
import type { MappingFeature } from '../mappings';
import type { AssistantActionController } from './actionController';
import type { AssistantFeedbackController } from './feedbackController';
import type { AssistantPlanningService } from './planningService';

export class AssistantFinalTranscriptError extends Error {
  constructor(public readonly phase: 'planning' | 'action') {
    super('Assistant final transcript processing failed safely.');
    this.name = 'AssistantFinalTranscriptError';
  }
}

/** A wake phrase spoken alone arms this window for exactly one following utterance. */
export const WAKE_ARM_WINDOW_MS = 8_000;

export interface AssistantFinalTranscriptProcessorOptions {
  settings: Pick<SettingsRepository, 'read'>;
  mappings: Pick<MappingFeature, 'routeVoiceRequest'>;
  planning: AssistantPlanningService;
  actions: AssistantActionController;
  feedback: AssistantFeedbackController;
  localize(english: string, hebrew: string): string;
  now?(): number;
}

/** Only finalized text may cross this wake/matcher/planner/action boundary. */
export class AssistantFinalTranscriptProcessor {
  private armedUntil = 0;

  constructor(private readonly options: AssistantFinalTranscriptProcessorOptions) {}

  /** True while a wake-only utterance still authorizes the next finalized utterance. */
  get isWakeArmed(): boolean {
    return this.armedUntil > this.now();
  }

  /** Listening stops, session changes and consumed windows all clear the arming. */
  disarmWake(): void {
    this.armedUntil = 0;
  }

  async process(
    text: string,
    snapshot: TargetSnapshot,
    utteranceId: string,
    signal: AbortSignal,
    isCurrent: () => boolean,
    beforeActionBoundary?: () => void,
  ): Promise<void> {
    if (!text || signal.aborted || !isCurrent()) return;
    const request = this.authorize(text);
    if (!request) return;
    beforeActionBoundary?.();

    let phase: 'planning' | 'action' = 'planning';
    try {
      const mappingRoute = await this.options.mappings.routeVoiceRequest(
        request.postWakeText,
        snapshot,
        utteranceId,
      );
      if (mappingRoute.handled) return;

      const fallbackPlan = this.options.planning.deterministic(
        request.postWakeText,
        request.intent,
      );
      const plan = request.intent.kind === 'action' && request.intent.action === 'confirm-send'
        ? fallbackPlan
        : await this.options.planning.create(
          request.postWakeText,
          snapshot,
          signal,
          fallbackPlan,
        );
      if (!isCurrent() || signal.aborted) return;
      phase = 'action';
      await this.options.actions.execute(plan, snapshot, utteranceId);
    } catch (error) {
      if (signal.aborted || !isCurrent()) return;
      if (error instanceof PlannerError) {
        this.options.feedback.speak(this.options.localize(
          'The selected provider could not safely plan this request, so I made no change.',
          'הספק שנבחר לא הצליח לתכנן את הבקשה בבטחה, ולכן לא ביצעתי שינוי.',
        ));
        return;
      }
      if (phase === 'action') {
        this.options.feedback.speak(this.options.localize(
          'The action failed safely, so I made no further change.',
          'הפעולה נכשלה באופן בטוח, ולכן לא ביצעתי שינוי נוסף.',
        ));
        return;
      }
      throw new AssistantFinalTranscriptError(phase);
    }
  }

  /**
   * Wake authority for one finalized utterance. It is granted either by the wake
   * prefix of this utterance or by a wake-only utterance inside the arming window;
   * every finalized utterance consumes the window exactly once.
   */
  private authorize(text: string): { postWakeText: string; intent: AssistantIntent } | undefined {
    const settings = this.options.settings.read().values;
    const wakePhrases = settings.assistantWakePhrase
      ? [settings.assistantWakePhrase]
      : DEFAULT_WAKE_PHRASES;
    const parsed = parseAssistantText(text, { wakePhrases });
    const armedUntil = this.armedUntil;
    this.armedUntil = 0;

    if (parsed.wakeDetected) {
      if (isWakeOnlyUtterance(parsed)) {
        this.armWake();
        return undefined;
      }
      return { postWakeText: parsed.postWakeText, intent: parsed.intent };
    }
    if (armedUntil === 0 || this.now() > armedUntil) return undefined;
    const command = trimAssistantCommand(text);
    if (!command) return undefined;
    return { postWakeText: command, intent: parseAssistantCommand(command) };
  }

  private armWake(): void {
    this.armedUntil = this.now() + WAKE_ARM_WINDOW_MS;
    this.options.feedback.speak(this.options.localize('Yes?', 'כן?'));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

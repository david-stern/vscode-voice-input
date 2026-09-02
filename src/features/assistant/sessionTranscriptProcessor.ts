import { DEFAULT_WAKE_PHRASES, parseAssistantText } from '../../assistant';
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

export interface AssistantFinalTranscriptProcessorOptions {
  settings: Pick<SettingsRepository, 'read'>;
  mappings: Pick<MappingFeature, 'routeVoiceRequest'>;
  planning: AssistantPlanningService;
  actions: AssistantActionController;
  feedback: AssistantFeedbackController;
  localize(english: string, hebrew: string): string;
}

/** Only finalized text may cross this wake/matcher/planner/action boundary. */
export class AssistantFinalTranscriptProcessor {
  constructor(private readonly options: AssistantFinalTranscriptProcessorOptions) {}

  async process(
    text: string,
    snapshot: TargetSnapshot,
    utteranceId: string,
    signal: AbortSignal,
    isCurrent: () => boolean,
    beforeActionBoundary?: () => void,
  ): Promise<void> {
    if (!text || signal.aborted || !isCurrent()) return;
    const settings = this.options.settings.read().values;
    const wakePhrases = settings.assistantWakePhrase
      ? [settings.assistantWakePhrase]
      : DEFAULT_WAKE_PHRASES;
    const parsed = parseAssistantText(text, { wakePhrases });
    if (!parsed.wakeDetected) return;
    beforeActionBoundary?.();

    let phase: 'planning' | 'action' = 'planning';
    try {
      const mappingRoute = await this.options.mappings.routeVoiceRequest(
        parsed.postWakeText,
        snapshot,
        utteranceId,
      );
      if (mappingRoute.handled) return;

      const fallbackPlan = this.options.planning.deterministic(
        parsed.postWakeText,
        parsed.intent,
      );
      const plan = parsed.intent.kind === 'action' && parsed.intent.action === 'confirm-send'
        ? fallbackPlan
        : await this.options.planning.create(
          parsed.postWakeText,
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
}

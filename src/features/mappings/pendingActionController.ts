import {
  MappingCapabilityPolicy,
  mappingFingerprint,
  type CustomMapping,
  type CustomMappingExecutor,
  type MappingExecutionFailure,
} from '../../assistant';
import type { TargetSnapshot } from '../../assistant/context';
import type { PendingAssistantAction } from '../../webview/protocol';
import type { MappingStore } from './store';

export type Localize = (english: string, hebrew: string) => string;

export interface PendingActionControllerOptions {
  store: Pick<MappingStore, 'get'>;
  executor: Pick<CustomMappingExecutor, 'execute'>;
  isWorkspaceTrusted(): boolean;
  captureTarget(): TargetSnapshot;
  clearPendingSend(): void;
  speak(message: string): void;
  publish(): void;
  localize: Localize;
  capability?: MappingCapabilityPolicy;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
  autoMode?: {
    snapshot(): { effective: boolean; epoch: number; fingerprint: string };
    onWillChange?(listener: () => void): { dispose(): void };
  };
  targetFingerprint?(snapshot: TargetSnapshot): string;
}

/**
 * Owns the short-lived voice capability and its timer. It never accepts a
 * runtime target, argument, or tool input from either voice or a webview.
 */
export class PendingActionController {
  private readonly capability: MappingCapabilityPolicy;
  private readonly setTimer: NonNullable<PendingActionControllerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<PendingActionControllerOptions['clearTimer']>;
  private readonly now: NonNullable<PendingActionControllerOptions['now']>;
  private pending: PendingAssistantAction | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private executionEpoch = 0;
  private readonly autoSubscription: { dispose(): void } | undefined;

  constructor(private readonly options: PendingActionControllerOptions) {
    this.capability = options.capability ?? new MappingCapabilityPolicy();
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.now = options.now ?? Date.now;
    this.autoSubscription = options.autoMode?.onWillChange?.(() => this.cancel(false));
  }

  get state(): PendingAssistantAction | undefined {
    return this.pending ? { ...this.pending } : undefined;
  }

  request(mapping: CustomMapping, snapshot: TargetSnapshot, utteranceId: string): void {
    this.cancel(false);
    this.options.clearPendingSend();
    if (!this.options.isWorkspaceTrusted()) {
      this.options.speak(this.executionFeedback('workspace-untrusted'));
      return;
    }

    const autoMode = this.autoModeSnapshot();
    if (autoMode?.effective) {
      if (!this.options.targetFingerprint) {
        this.options.speak(this.executionFeedback('target-changed'));
        return;
      }
      const executionEpoch = this.executionEpoch;
      void this.executeAuto(mapping, snapshot, autoMode, executionEpoch);
      return;
    }

    const requestedAt = this.now();
    const capability = this.capability.request(mapping, utteranceId, snapshot, requestedAt);
    this.pending = {
      id: mapping.id,
      label: mapping.label,
      targetId: mappingTargetId(mapping),
    };
    this.timer = this.setTimer(() => {
      if (this.pending?.id !== mapping.id) return;
      this.cancel(false);
      this.options.speak(this.options.localize(
        'I did not run the custom action because its twelve-second approval window expired.',
        'לא הפעלתי את הפעולה המותאמת מפני שחלון האישור בן שתים־עשרה השניות פג.',
      ));
    }, Math.max(1, capability.expiresAt - this.now() + 25));
    this.options.speak(this.options.localize(
      `I found “${mapping.label}”. Say “confirm action” or use the approval button within twelve seconds. It will run ${mappingTargetId(mapping)}.`,
      `מצאתי את „${mapping.label}”. אמור „אשר פעולה” או השתמש בכפתור האישור בתוך שתים־עשרה שניות. היעד שיופעל הוא ${mappingTargetId(mapping)}.`,
    ));
    this.options.publish();
  }

  async confirm(confirmationId: string): Promise<void> {
    const executionEpoch = this.executionEpoch;
    const cancelled = () => executionEpoch !== this.executionEpoch;
    const decision = this.capability.confirm(
      (id) => this.options.store.get(id),
      this.options.captureTarget(),
      confirmationId,
      this.now(),
    );
    this.clearPendingState();
    if (!decision.allowed) {
      this.options.speak(this.options.localize(
        `I did not run the custom action because the approval was no longer valid (${decision.reason}).`,
        `לא הפעלתי את הפעולה המותאמת מפני שהאישור כבר לא היה תקף (${decision.reason}).`,
      ));
      return;
    }

    const mapping = this.options.store.get(decision.mappingId);
    const result = await this.options.executor.execute(decision.mappingId, {
      source: 'voice',
      expectedFingerprint: decision.fingerprint,
      cancellationToken: {
        get isCancellationRequested() { return cancelled(); },
      },
    });
    if (cancelled()) return;
    if (!result.ok) {
      this.options.speak(this.executionFeedback(result.reason));
      return;
    }
    this.options.speak(this.options.localize(
      `I ran “${mapping?.label ?? 'custom action'}” after your separate approval.`,
      `הפעלתי את „${mapping?.label ?? 'הפעולה המותאמת'}” לאחר האישור הנפרד שלך.`,
    ));
  }

  confirmIfPending(mappingId: string, confirmationId: string): Promise<void> | undefined {
    if (this.pending?.id !== mappingId) return undefined;
    return this.confirm(confirmationId);
  }

  cancelIfPending(mappingId: string, announce = true): void {
    if (this.pending?.id === mappingId) this.cancel(announce);
  }

  cancel(announce = false): void {
    this.executionEpoch += 1;
    const hadPending = this.pending !== undefined;
    this.clearPendingState();
    this.capability.cancel();
    if (announce && hadPending) {
      this.options.speak(this.options.localize(
        'I cancelled the pending custom action.',
        'ביטלתי את הפעולה המותאמת שהמתינה לאישור.',
      ));
    } else if (hadPending) {
      this.options.publish();
    }
  }

  dispose(): void {
    this.cancel(false);
    this.autoSubscription?.dispose();
  }

  private clearPendingState(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  private executionFeedback(reason: MappingExecutionFailure): string {
    const messages: Record<MappingExecutionFailure, readonly [string, string]> = {
      'workspace-untrusted': [
        'I did not run the action because this workspace is not trusted.',
        'לא הפעלתי את הפעולה מפני שסביבת העבודה אינה מהימנה.',
      ],
      cancelled: ['The custom action was cancelled.', 'הפעולה המותאמת בוטלה.'],
      busy: [
        'Another custom action is already running, so I did not start this one.',
        'פעולה מותאמת אחרת כבר פועלת, ולכן לא התחלתי את הפעולה הזו.',
      ],
      'mapping-not-found': [
        'I did not run the action because its mapping no longer exists.',
        'לא הפעלתי את הפעולה מפני שהמיפוי שלה כבר אינו קיים.',
      ],
      'mapping-disabled': [
        'I did not run the action because its mapping is disabled.',
        'לא הפעלתי את הפעולה מפני שהמיפוי שלה מושבת.',
      ],
      'mapping-not-agent-enabled': [
        'This mapping is not available to Agent Mode.',
        'המיפוי הזה אינו זמין למצב Agent.',
      ],
      'mapping-changed': [
        'I did not run the action because its mapping changed after approval.',
        'לא הפעלתי את הפעולה מפני שהמיפוי השתנה לאחר האישור.',
      ],
      'authority-changed': [
        'I stopped because Auto Mode authority changed before dispatch.',
        'עצרתי מפני שסמכות מצב Auto השתנתה לפני ההפעלה.',
      ],
      'target-changed': [
        'I stopped because the target changed before dispatch.',
        'עצרתי מפני שהיעד השתנה לפני ההפעלה.',
      ],
      'target-unavailable': [
        'I did not run the action because its VS Code command or tool is no longer available.',
        'לא הפעלתי את הפעולה מפני שפקודת VS Code או הכלי כבר אינם זמינים.',
      ],
      'invalid-voice-token': [
        'I rejected an invalid voice invocation.',
        'דחיתי הפעלה קולית לא תקינה.',
      ],
      'outcome-unknown-do-not-retry': [
        'The action reported an error after dispatch began, so it may already have run. I will not retry it automatically; check the result before choosing whether to run it again.',
        'הפעולה דיווחה על שגיאה לאחר שההפעלה התחילה, ולכן ייתכן שכבר בוצעה. לא אנסה אותה שוב אוטומטית; יש לבדוק את התוצאה לפני שמחליטים אם להפעיל שוב.',
      ],
      'execution-failed': [
        'The custom action failed safely. No result data was retained.',
        'הפעולה המותאמת נכשלה באופן בטוח. לא נשמרו נתוני תוצאה.',
      ],
    };
    const [english, hebrew] = messages[reason];
    return this.options.localize(english, hebrew);
  }

  private autoModeSnapshot(): { effective: boolean; epoch: number; fingerprint: string } | undefined {
    try {
      const snapshot = this.options.autoMode?.snapshot();
      if (
        !snapshot
        || typeof snapshot.effective !== 'boolean'
        || !Number.isSafeInteger(snapshot.epoch)
        || snapshot.epoch < 0
        || !/^[A-Za-z0-9._:-]{1,256}$/u.test(snapshot.fingerprint)
      ) return undefined;
      return snapshot;
    } catch {
      return undefined;
    }
  }

  private async executeAuto(
    mapping: CustomMapping,
    snapshot: TargetSnapshot,
    autoMode: { effective: boolean; epoch: number; fingerprint: string },
    executionEpoch: number,
  ): Promise<void> {
    const cancelled = () => executionEpoch !== this.executionEpoch;
    let targetFingerprint: string;
    try {
      targetFingerprint = this.options.targetFingerprint?.(snapshot) ?? '';
    } catch {
      targetFingerprint = '';
    }
    if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(targetFingerprint)) {
      this.options.speak(this.executionFeedback('target-changed'));
      return;
    }
    const result = await this.options.executor.execute(mapping.id, {
      source: 'voice',
      expectedFingerprint: mappingFingerprint(mapping),
      expectedAuthority: {
        epoch: autoMode.epoch,
        fingerprint: autoMode.fingerprint,
      },
      expectedTargetFingerprint: targetFingerprint,
      cancellationToken: {
        get isCancellationRequested() { return cancelled(); },
      },
    });
    if (executionEpoch !== this.executionEpoch) return;
    if (!result.ok) {
      this.options.speak(this.executionFeedback(result.reason));
      return;
    }
    this.options.speak(this.options.localize(
      `I ran “${mapping.label}” under the current Auto Mode authority.`,
      `הפעלתי את „${mapping.label}” תחת סמכות מצב Auto הנוכחית.`,
    ));
  }
}

export function mappingTargetId(mapping: CustomMapping): string {
  return mapping.kind === 'command' ? mapping.commandId : mapping.toolName;
}

import { revalidateTargetSnapshot, type TargetSnapshot } from '../../assistant/context';
import { BUILTIN_CHAT_SUBMIT_COMMAND } from '../../assistant/chat';
import { type SafeActionPolicy } from '../../assistant/policy';
import type { PendingAssistantSend } from '../../webview/protocol';
import type { AssistantFeedbackController } from './feedbackController';

export interface PendingChatSendHost {
  prepareBuiltInChatDraft(
    text: string,
    targetStillValid: () => boolean,
  ): Promise<TargetSnapshot | undefined>;
  hasCommand(commandId: string): Promise<boolean>;
  executeCommand(commandId: string, ...args: unknown[]): PromiseLike<unknown>;
}

export interface PendingChatSendTarget {
  capture(): TargetSnapshot;
}

export interface PendingChatSendLifecycleOptions {
  host: PendingChatSendHost;
  target: PendingChatSendTarget;
  policy: SafeActionPolicy;
  feedback: Pick<AssistantFeedbackController, 'speak'>;
  privilegedExecutionAllowed(): boolean;
  originalTargetStillValid(captured: TargetSnapshot): boolean;
  labelChat(): string;
  localize(english: string, hebrew: string): string;
  publish(): Promise<void> | void;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

/** Owns the prepared-chat draft and its separate, expiring submit authority. */
export class PendingChatSendLifecycle {
  private pendingSend: PendingAssistantSend | undefined;
  private pendingChatDraft: { id: string; text: string; snapshot: TargetSnapshot } | undefined;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PendingChatSendLifecycleOptions) {}

  get pending(): PendingAssistantSend | undefined {
    return this.pendingSend ? { ...this.pendingSend } : undefined;
  }

  get hasPending(): boolean {
    return this.pendingSend !== undefined;
  }

  clear(announce = false): void {
    this.clearTimer();
    if (!this.pendingSend) return;
    this.pendingSend = undefined;
    this.pendingChatDraft = undefined;
    this.options.policy.cancelPendingSend();
    if (announce) {
      this.options.feedback.speak(this.text(
        'I cancelled the pending send.',
        'ביטלתי את השליחה הממתינה.',
      ));
    }
    void this.options.publish();
  }

  async confirm(
    captured: TargetSnapshot,
    utteranceId: string,
    actionStillCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!actionStillCurrent()) return;
    if (!this.pendingSend || !this.pendingChatDraft || this.pendingChatDraft.id !== this.pendingSend.id) {
      const noPending = this.options.policy.confirmSend(this.options.target.capture(), utteranceId);
      if (!noPending.allowed) this.explainPolicy(noPending.explanation);
      return;
    }
    const pendingState = this.pendingSend;
    const draft = this.pendingChatDraft;
    const pendingStillMatches = () =>
      actionStillCurrent()
      && this.pendingSend?.id === pendingState.id
      && this.pendingChatDraft === draft
      && this.options.policy.getPendingSend() !== null;
    const bothCapturedContextsMatch = (current: TargetSnapshot) =>
      revalidateTargetSnapshot(captured, current).valid
      && revalidateTargetSnapshot(draft.snapshot, current).valid;
    if (!pendingStillMatches() || !bothCapturedContextsMatch(this.options.target.capture())) {
      this.clear(false);
      this.options.feedback.speak(this.text(
        'I did not send because the draft context changed or the confirmation expired.',
        'לא שלחתי מפני שהקשר הטיוטה השתנה או שחלון האישור פג.',
      ));
      return;
    }
    const prepared = await this.options.host.prepareBuiltInChatDraft(
      draft.text,
      () => pendingStillMatches()
        && bothCapturedContextsMatch(this.options.target.capture()),
    );
    if (!actionStillCurrent()) return;
    if (!prepared) {
      this.clear(false);
      this.options.feedback.speak(this.text(
        'I did not send because the confirmation target changed.',
        'לא שלחתי מפני שיעד האישור השתנה.',
      ));
      return;
    }
    if (!(await this.options.host.hasCommand(BUILTIN_CHAT_SUBMIT_COMMAND))) {
      if (!actionStillCurrent()) return;
      this.clear(false);
      this.options.feedback.speak(this.text(
        'I left the text prepared, but this VS Code version does not expose the safe built-in chat submit command. Please send it manually.',
        'השארתי את הטקסט מוכן, אך גרסת VS Code הזו אינה חושפת פקודת שליחה בטוחה לצ׳אט המובנה. יש לשלוח ידנית.',
      ));
      return;
    }
    if (!actionStillCurrent()) return;
    const finalTarget = this.options.target.capture();
    if (
      !pendingStillMatches()
      || !bothCapturedContextsMatch(finalTarget)
      || !revalidateTargetSnapshot(prepared, finalTarget).valid
    ) {
      this.clear(false);
      this.options.feedback.speak(this.text(
        'I did not send because the chat context changed before submission.',
        'לא שלחתי מפני שהקשר הצ׳אט השתנה לפני השליחה.',
      ));
      return;
    }
    const decision = this.options.policy.confirmSend(finalTarget, utteranceId);
    if (!decision.allowed) {
      this.pendingSend = undefined;
      this.pendingChatDraft = undefined;
      this.explainPolicy(decision.explanation);
      void this.options.publish();
      return;
    }
    if (!this.options.privilegedExecutionAllowed()) {
      this.clear(false);
      return;
    }
    await this.options.host.executeCommand(BUILTIN_CHAT_SUBMIT_COMMAND);
    if (!actionStillCurrent()) return;
    this.pendingSend = undefined;
    this.pendingChatDraft = undefined;
    this.clearTimer();
    this.options.feedback.speak(this.text(
      'I sent the prepared message after your separate confirmation.',
      'שלחתי את ההודעה המוכנה לאחר האישור הנפרד שלך.',
    ));
    void this.options.publish();
  }

  async request(
    captured: TargetSnapshot,
    content: string,
    utteranceId: string,
    actionStillCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!actionStillCurrent() || !this.options.originalTargetStillValid(captured)) return;
    const pendingSnapshot = await this.options.host.prepareBuiltInChatDraft(
      content,
      () => actionStillCurrent() && this.options.originalTargetStillValid(captured),
    );
    if (!pendingSnapshot || !actionStillCurrent()) return;
    const pending = this.options.policy.requestPreparedChatSend(pendingSnapshot, utteranceId);
    if (!pending.allowed) {
      this.explainPolicy(pending.explanation);
      return;
    }
    this.pendingSend = {
      id: utteranceId,
      preview: content.slice(0, 300),
      targetLabel: this.options.labelChat(),
    };
    this.pendingChatDraft = { id: utteranceId, text: content, snapshot: pendingSnapshot };
    this.clearTimer();
    this.pendingTimer = this.options.setTimer(() => {
      if (this.pendingSend?.id !== utteranceId) return;
      this.pendingSend = undefined;
      this.pendingChatDraft = undefined;
      this.options.policy.cancelPendingSend();
      this.options.feedback.speak(this.text(
        'I did not send because the confirmation window expired.',
        'לא שלחתי מפני שחלון האישור פג.',
      ));
      void this.options.publish();
    }, 12_050);
    this.options.feedback.speak(this.text(
      'I prepared the message in chat. Say “confirm send” or use the approval button within twelve seconds.',
      'הכנתי את ההודעה בצ׳אט. אמור „אשר שליחה” או השתמש בכפתור האישור בתוך שתים־עשרה שניות.',
    ));
    void this.options.publish();
  }

  dispose(): void {
    this.clear(false);
  }

  private clearTimer(): void {
    if (this.pendingTimer === undefined) return;
    this.options.clearTimer(this.pendingTimer);
    this.pendingTimer = undefined;
  }

  private explainPolicy(explanation: { en: string; he: string }): void {
    this.options.feedback.speak(this.text(explanation.en, explanation.he));
  }

  private text(english: string, hebrew: string): string {
    return this.options.localize(english, hebrew);
  }
}

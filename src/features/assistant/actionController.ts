import { revalidateTargetSnapshot, type RequestedTargetKind, type ResolvedTargetKind, type TargetSnapshot } from '../../assistant/context';
import type { AgentActionProposal, AgentAuthorityContext, AgentAuthorityPolicy, AgentRecord } from '../../agents';
import type { DeepSeekPlan } from '../../assistant/deepseek';
import {
  SafeActionPolicy,
  insertTerminalText,
  validateTerminalText,
  type PolicyExplanation,
  type RepeatedAction,
  type TerminalTextTarget,
} from '../../assistant/policy';
import type { AssistantFeedbackController } from './feedbackController';
import type { AssistantIdSequence } from './idSequence';
import { PendingChatSendLifecycle } from './pendingChatSend';
import {
  actionTargetEvidence,
  actionTargetLabel,
  authorityAction,
  successfulActionFeedback,
  targetAuthorityFingerprint,
  writeHereMayTargetTerminal,
} from './actionAuthority';

export interface AssistantTargetPort {
  capture(
    requestedTarget?: RequestedTargetKind,
    provenFocus?: Exclude<ResolvedTargetKind, 'unknown'> | null,
  ): TargetSnapshot;
  forRequestedTarget(
    snapshot: TargetSnapshot,
    requestedTarget: Exclude<RequestedTargetKind, 'here'>,
  ): TargetSnapshot;
}

export interface AssistantActionHost {
  confirmAgentAction(preview: AssistantActionApprovalPreview): Promise<boolean>;
  focusBuiltInChat(targetStillValid: () => boolean): Promise<boolean>;
  prepareBuiltInChatDraft(
    text: string,
    targetStillValid: () => boolean,
  ): Promise<TargetSnapshot | undefined>;
  hasCommand(commandId: string): Promise<boolean>;
  executeCommand(commandId: string, ...args: unknown[]): PromiseLike<unknown>;
  activeTerminal(): TerminalTextTarget | undefined;
  hasActiveEditor(): boolean;
  injectIntoEditor(text: string, targetStillValid: () => boolean): Promise<boolean>;
  injectIntoFocusedControl(text: string, targetStillValid: () => boolean): Promise<boolean>;
}

export interface AssistantActionApprovalPreview {
  agentName: string;
  proposal: Readonly<AgentActionProposal>;
  permissionTier: 'confirmation-required';
  expiresAt: number;
}

export interface AssistantActionControllerOptions {
  host: AssistantActionHost;
  target: AssistantTargetPort;
  feedback: AssistantFeedbackController;
  sequence: AssistantIdSequence;
  localize(english: string, hebrew: string): string;
  publish(): Promise<void> | void;
  stopAssistant(): Promise<void>;
  authority?: AgentAuthorityPolicy;
  activeAgent?(): AgentRecord | undefined;
  isWorkspaceTrusted?(): boolean;
  resolveMapping?(mappingId: string): ReturnType<AgentAuthorityContext['resolveMapping']>;
  policy?: SafeActionPolicy;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Owns target-safe assistant mutations, repeat memory and separate chat-send authority. */
export class AssistantActionController {
  private readonly policy: SafeActionPolicy;
  private readonly pendingSends: PendingChatSendLifecycle;
  private targetName = '';
  private confidence: number | undefined;
  private executionEpoch = 0;

  constructor(private readonly options: AssistantActionControllerOptions) {
    this.policy = options.policy ?? new SafeActionPolicy();
    this.pendingSends = new PendingChatSendLifecycle({
      host: options.host,
      target: options.target,
      policy: this.policy,
      feedback: options.feedback,
      privilegedExecutionAllowed: () => this.privilegedExecutionAllowed(),
      originalTargetStillValid: (captured) => this.originalTargetStillValid(captured),
      labelChat: () => actionTargetLabel('chat', options.localize),
      localize: options.localize,
      publish: options.publish,
      setTimer: options.setTimer ?? setTimeout,
      clearTimer: options.clearTimer ?? clearTimeout,
    });
  }

  get pending() {
    return this.pendingSends.pending;
  }

  get targetLabel(): string {
    return this.targetName;
  }

  get planConfidence(): number | undefined {
    return this.confidence;
  }

  clearPending(announce = false): void {
    this.executionEpoch += 1;
    this.options.authority?.revoke();
    this.pendingSends.clear(announce);
  }

  async confirmIfPending(id: string): Promise<void> {
    if (this.pendingSends.pending?.id !== id) return;
    try {
      await this.execute({
        action: 'confirm-send',
        target: 'current',
        content: null,
        spokenReply: '',
        reason: '',
        confidence: 1,
        requiresConfirmation: false,
      }, this.options.target.capture(), this.options.sequence.next('ui-confirm'), false);
    } catch {
      this.clearPending(false);
      this.options.feedback.speak(this.text(
        'The send confirmation failed safely. The prepared text was not submitted.',
        'אישור השליחה נכשל באופן בטוח. הטקסט המוכן לא נשלח.',
      ));
    }
  }

  async execute(
    plan: DeepSeekPlan,
    captured: TargetSnapshot,
    utteranceId: string,
    remember = true,
  ): Promise<void> {
    const executionEpoch = this.executionEpoch;
    if (plan.action === 'stop-listening') {
      await this.executeAuthorized(plan, captured, utteranceId, remember, executionEpoch);
      return;
    }
    if (plan.action === 'repeat-last') {
      if (this.pendingSends.hasPending) this.pendingSends.clear(false);
      if (!this.originalTargetStillValid(captured)) return;
      const repeated = this.policy.repeatLast(this.options.target.capture());
      if (!repeated.allowed) this.explainPolicy(repeated.explanation);
      else await this.executeRepeatedAction(repeated.instruction, utteranceId, executionEpoch);
      return;
    }
    if (!this.options.authority) {
      await this.executeAuthorized(plan, captured, utteranceId, remember, executionEpoch);
      return;
    }
    const activeAgent = this.options.activeAgent?.();
    const action = authorityAction(plan.action, captured);
    const targetEvidence = actionTargetEvidence(plan, captured, this.options.localize);
    const proposal: AgentActionProposal = {
      proposalId: this.options.sequence.next('proposal'),
      agentId: activeAgent?.id ?? 'agent_unavailable',
      provider: activeAgent?.provider ?? 'deepseek',
      model: activeAgent?.model ?? 'unavailable',
      action,
      reason: plan.reason.trim() || this.text(
        'This locally validated assistant action was requested.',
        'הפעולה המקומית המאומתת של העוזר התבקשה.',
      ),
      confidence: plan.confidence,
      targetEvidence,
    };
    const context = this.authorityContext(captured, activeAgent, targetEvidence);
    let decision = this.options.authority.request(proposal, context);
    if (decision.status === 'confirmation-required') {
      const accepted = await this.options.host.confirmAgentAction({
        agentName: activeAgent?.name ?? this.text('Unavailable agent', 'סוכן לא זמין'),
        proposal: decision.preview,
        permissionTier: decision.permissionTier,
        expiresAt: decision.expiresAt,
      });
      if (!this.executionIsCurrent(executionEpoch)) return;
      if (!accepted) {
        this.options.authority.revoke();
        this.options.feedback.speak(this.text(
          'I cancelled the proposed action.',
          'ביטלתי את הפעולה המוצעת.',
        ));
        return;
      }
      const confirmationSnapshot = this.options.target.capture();
      decision = this.options.authority.confirm(
        decision.pendingId,
        this.options.sequence.next('confirmation'),
        this.authorityContext(
          confirmationSnapshot,
          this.options.activeAgent?.(),
          actionTargetEvidence(plan, confirmationSnapshot, this.options.localize),
        ),
      );
    }
    if (!this.executionIsCurrent(executionEpoch)) return;
    if (decision.status !== 'authorized') {
      this.options.feedback.speak(this.text(
        'I did not act because local permission or target validation failed.',
        'לא פעלתי מפני שאימות ההרשאה המקומית או היעד נכשל.',
      ));
      return;
    }
    const executionSnapshot = this.options.target.capture();
    const result = await this.options.authority.execute(
      decision.authorizationId,
      this.authorityContext(
        executionSnapshot,
        this.options.activeAgent?.(),
        actionTargetEvidence(plan, executionSnapshot, this.options.localize),
      ),
      () => this.executeAuthorized(plan, captured, utteranceId, remember, executionEpoch),
    );
    if (!result.ok && this.executionIsCurrent(executionEpoch)) {
      this.options.feedback.speak(this.text(
        'I did not act because the approval expired or its authority changed.',
        'לא פעלתי מפני שהאישור פג או שההרשאה שלו השתנתה.',
      ));
    }
  }

  private async executeAuthorized(
    plan: DeepSeekPlan,
    captured: TargetSnapshot,
    utteranceId: string,
    remember: boolean,
    executionEpoch: number,
  ): Promise<void> {
    if (!this.executionIsCurrent(executionEpoch)) return;
    this.confidence = plan.confidence;
    const currentTarget = plan.action === 'write-editor' ? 'editor'
      : plan.action === 'write-terminal' ? 'terminal'
      : plan.action === 'write-chat' || plan.action === 'request-send' ? 'chat'
      : captured.resolvedTarget;
    this.targetName = actionTargetLabel(currentTarget, this.options.localize);
    void this.options.publish();

    if (plan.action !== 'confirm-send' && this.pendingSends.hasPending) {
      this.pendingSends.clear(false);
    }

    if (plan.action === 'answer-only') {
      if (plan.spokenReply) this.options.feedback.speak(plan.spokenReply);
      return;
    }
    if (plan.action === 'stop-listening') {
      this.options.feedback.speak(this.text(
        'I am stopping the assistant because you asked me to.',
        'אני מפסיק את העוזר מפני שביקשת ממני.',
      ));
      await this.options.stopAssistant();
      return;
    }
    if (plan.action === 'repeat-last') return;
    if (plan.action === 'open-chat') {
      if (!this.privilegedExecutionAllowed() || !this.originalTargetStillValid(captured)) return;
      if (!(await this.options.host.focusBuiltInChat(
        () => this.executionIsCurrent(executionEpoch)
          && this.privilegedExecutionAllowed()
          && this.originalTargetStillValid(captured),
      ))) return;
      if (!this.executionIsCurrent(executionEpoch)) return;
      this.options.feedback.speak(successfulActionFeedback(
        plan,
        this.text('I opened the built-in chat.', 'פתחתי את הצ׳אט המובנה.'),
      ));
      if (remember) this.policy.rememberLast({ action: 'open-chat' });
      return;
    }
    if (plan.action === 'open-terminal') {
      if (!this.privilegedExecutionAllowed() || !this.originalTargetStillValid(captured)) return;
      await this.options.host.executeCommand('workbench.action.terminal.toggleTerminal');
      if (!this.executionIsCurrent(executionEpoch)) return;
      this.options.feedback.speak(successfulActionFeedback(
        plan,
        this.text('I opened the terminal.', 'פתחתי את המסוף.'),
      ));
      if (remember) this.policy.rememberLast({ action: 'open-terminal' });
      return;
    }
    if (plan.action === 'open-settings') {
      if (!this.privilegedExecutionAllowed() || !this.originalTargetStillValid(captured)) return;
      await this.options.host.executeCommand('workbench.action.openSettings', 'voiceInput');
      if (!this.executionIsCurrent(executionEpoch)) return;
      this.options.feedback.speak(successfulActionFeedback(
        plan,
        this.text('I opened Voice Input settings.', 'פתחתי את הגדרות Voice Input.'),
      ));
      if (remember) this.policy.rememberLast({ action: 'open-settings' });
      return;
    }
    if (plan.action === 'confirm-send') {
      await this.pendingSends.confirm(
        captured,
        utteranceId,
        () => this.executionIsCurrent(executionEpoch),
      );
      return;
    }

    const content = plan.content ?? '';
    if (plan.action === 'request-send') {
      await this.pendingSends.request(
        captured,
        content,
        utteranceId,
        () => this.executionIsCurrent(executionEpoch),
      );
      return;
    }

    if (plan.action === 'write-chat') {
      if (!this.originalTargetStillValid(captured)) return;
      const prepared = await this.options.host.prepareBuiltInChatDraft(
        content,
        () => this.executionIsCurrent(executionEpoch)
          && this.originalTargetStillValid(captured),
      );
      if (!prepared || !this.executionIsCurrent(executionEpoch)) return;
      if (remember) this.policy.rememberLast({ action: 'write-chat', text: content });
      this.options.feedback.speak(successfulActionFeedback(plan, this.text(
        'I prepared the draft in the built-in chat without sending it.',
        'הכנתי את הטיוטה בצ׳אט המובנה בלי לשלוח אותה.',
      )));
      return;
    }

    if (
      plan.action === 'write-terminal'
      || (plan.action === 'write-here' && captured.resolvedTarget === 'terminal')
    ) {
      const initial = this.options.target.forRequestedTarget(captured, 'terminal');
      const terminal = this.options.host.activeTerminal();
      const current = this.options.target.capture('terminal', terminal ? 'terminal' : null);
      if (!terminal) {
        this.options.feedback.speak(this.text(
          'I could not find an active terminal.',
          'לא מצאתי מסוף פעיל.',
        ));
        return;
      }
      if (!this.privilegedExecutionAllowed()) return;
      const inserted = insertTerminalText(terminal, content, initial, current);
      if (!inserted.allowed) {
        this.explainPolicy(inserted.explanation);
        return;
      }
    } else if (plan.action === 'write-editor') {
      const initial = this.options.target.forRequestedTarget(captured, 'editor');
      const current = this.options.target.capture(
        'editor',
        this.options.host.hasActiveEditor() ? 'editor' : null,
      );
      const decision = this.policy.authorizeWrite('write-editor', content, initial, current);
      if (!decision.allowed) {
        this.explainPolicy(decision.explanation);
        return;
      }
      if (!this.privilegedExecutionAllowed()) return;
      if (!(await this.options.host.injectIntoEditor(
        content,
        () => this.executionIsCurrent(executionEpoch),
      ))) {
        if (!this.executionIsCurrent(executionEpoch)) return;
        this.options.feedback.speak(this.text(
          'The editor rejected the edit, so I made no change.',
          'העורך דחה את העריכה, ולכן לא ביצעתי שינוי.',
        ));
        return;
      }
    } else {
      const current = this.options.target.capture();
      if (writeHereMayTargetTerminal(captured)) {
        const terminalFailure = validateTerminalText(content);
        if (terminalFailure) {
          this.explainPolicy(terminalFailure);
          return;
        }
      }
      const decision = this.policy.authorizeWrite('write-here', content, captured, current);
      if (!decision.allowed) {
        this.explainPolicy(decision.explanation);
        return;
      }
      let targetChangedDuringPaste = false;
      const inserted = await this.options.host.injectIntoFocusedControl(content, () => {
        const valid = this.executionIsCurrent(executionEpoch)
          && revalidateTargetSnapshot(captured, this.options.target.capture()).valid;
        if (!valid) targetChangedDuringPaste = true;
        return valid;
      });
      if (!this.executionIsCurrent(executionEpoch)) return;
      if (!inserted) {
        this.options.feedback.speak(targetChangedDuringPaste
          ? this.text(
            'I stopped before pasting because the focused target changed.',
            'עצרתי לפני ההדבקה מפני שהיעד הממוקד השתנה.',
          )
          : this.text(
            'I copied the text to the clipboard, but could not confirm that it was pasted.',
            'העתקתי את הטקסט ללוח, אך לא הצלחתי לוודא שהוא הודבק.',
          ));
        return;
      }
    }

    if (!this.executionIsCurrent(executionEpoch)) return;
    if (remember) this.policy.rememberLast({ action: plan.action, text: content });
    this.options.feedback.speak(successfulActionFeedback(plan, this.text('Done.', 'בוצע.')));
  }

  dispose(): void {
    this.executionEpoch += 1;
    this.pendingSends.dispose();
  }

  private authorityContext(
    snapshot: TargetSnapshot,
    activeAgent: AgentRecord | undefined,
    targetEvidence: string,
  ): AgentAuthorityContext {
    return {
      workspaceTrusted: this.options.isWorkspaceTrusted?.() ?? false,
      activeAgent,
      targetFingerprint: targetAuthorityFingerprint(snapshot),
      targetEvidence,
      resolveMapping: (mappingId) => this.options.resolveMapping?.(mappingId),
    };
  }

  private async executeRepeatedAction(
    repeated: RepeatedAction,
    utteranceId: string,
    executionEpoch: number,
  ): Promise<void> {
    if (!this.executionIsCurrent(executionEpoch)) return;
    const plan: DeepSeekPlan = {
      action: repeated.action,
      target: repeated.action === 'write-editor' ? 'editor'
        : repeated.action === 'write-terminal' ? 'terminal'
        : repeated.action === 'write-chat' ? 'chat'
        : repeated.action === 'write-here' ? 'current'
        : repeated.action === 'open-chat' ? 'chat'
        : repeated.action === 'open-terminal' ? 'terminal'
        : 'none',
      content: repeated.text ?? null,
      spokenReply: '',
      reason: this.text(
        'I repeated the recent action on the current target.',
        'חזרתי על הפעולה האחרונה ביעד הנוכחי.',
      ),
      confidence: 1,
      requiresConfirmation: false,
    };
    await this.execute(plan, repeated.snapshot, utteranceId, false);
  }

  private executionIsCurrent(executionEpoch: number): boolean {
    return executionEpoch === this.executionEpoch;
  }
  private originalTargetStillValid(captured: TargetSnapshot): boolean {
    const validation = revalidateTargetSnapshot(captured, this.options.target.capture());
    if (validation.valid) return true;
    this.explainPolicy({
      code: validation.reason,
      en: `I stopped because the original target is no longer safe (${validation.reason}).`,
      he: `עצרתי מפני שהיעד המקורי כבר אינו בטוח (${validation.reason}).`,
    });
    return false;
  }

  private privilegedExecutionAllowed(): boolean {
    return !this.options.authority || (this.options.isWorkspaceTrusted?.() ?? false);
  }

  private explainPolicy(explanation: PolicyExplanation): void {
    this.options.feedback.speak(this.text(explanation.en, explanation.he));
  }

  private text(english: string, hebrew: string): string {
    return this.options.localize(english, hebrew);
  }
}

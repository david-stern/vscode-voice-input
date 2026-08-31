import * as vscode from 'vscode';

import type { AssistantSessionStatusPort } from '../features/assistant/sessionController';
import type { FeedbackStatusPort } from '../features/assistant/feedbackController';
import type { RecordingStatusPort } from '../features/recording/pushToTalkController';
import type { NativeLocalize } from './nativeLocalization';

export interface RecordingIndicatorPort {
  postRecording(recording: boolean): void;
}

/** Presents recording/assistant state without owning either workflow. */
export class VoiceInputStatusBar implements
  RecordingStatusPort,
  AssistantSessionStatusPort,
  FeedbackStatusPort,
  vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );

  constructor(
    private readonly indicator: RecordingIndicatorPort,
    private readonly assistantActive: () => boolean,
    private readonly localize: NativeLocalize,
  ) {
    this.item.command = 'voiceInput.toggleRecording';
    this.idle();
    this.item.show();
  }

  idle(): void {
    if (this.assistantActive()) {
      this.item.text = this.text(
        '$(radio-tower) Voice — assistant listening',
        '$(radio-tower) Voice — העוזר מאזין',
      );
      this.item.tooltip = this.text(
        'Voice Input assistant is listening. Click to start push-to-talk instead.',
        'העוזר של Voice Input מאזין. לחיצה תפעיל במקום זאת הקלטה בלחיצה.',
      );
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.indicator.postRecording(false);
      return;
    }
    this.item.text = '$(mic) Voice';
    this.item.tooltip = process.platform === 'darwin'
      ? this.text(
        'Voice Input — click or Ctrl+Option+M to toggle',
        'Voice Input — לחיצה או Ctrl+Option+M להפעלה או עצירה',
      )
      : this.text(
        'Voice Input — click or Alt+M to toggle',
        'Voice Input — לחיצה או Alt+M להפעלה או עצירה',
      );
    this.item.backgroundColor = undefined;
    this.indicator.postRecording(false);
  }

  recording(): void {
    this.item.text = this.text('$(record) Voice — recording', '$(record) Voice — מקליט');
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.indicator.postRecording(true);
  }

  busy(label: string): void {
    this.item.text = `$(sync~spin) Voice — ${label}`;
    this.item.tooltip = this.text(
      'Voice Input is processing audio.',
      'Voice Input מעבד שמע.',
    );
    this.item.backgroundColor = undefined;
  }

  captureError(message: string): void {
    this.item.text = this.text(
      '$(error) Voice — recording stopped',
      '$(error) Voice — ההקלטה הופסקה',
    );
    this.item.tooltip = message;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.indicator.postRecording(false);
  }

  listening(): void {
    this.item.text = this.text(
      '$(radio-tower) Voice — assistant listening',
      '$(radio-tower) Voice — העוזר מאזין',
    );
    this.item.tooltip = this.text(
      'Voice Input assistant is listening. Run Toggle Assistant Listening to stop.',
      'העוזר של Voice Input מאזין. יש להפעיל את פקודת החלפת מצב ההאזנה כדי לעצור.',
    );
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  transcribing(): void {
    this.item.text = this.text(
      '$(sync~spin) Voice — assistant transcribing',
      '$(sync~spin) Voice — העוזר מתמלל',
    );
    this.item.tooltip = this.text(
      'Voice Input assistant is transcribing one completed speech segment.',
      'העוזר של Voice Input מתמלל מקטע דיבור אחד שהושלם.',
    );
    this.item.backgroundColor = undefined;
  }

  stoppedWithError(message: string): void {
    this.item.text = this.text(
      '$(error) Voice — assistant stopped',
      '$(error) Voice — העוזר הופסק',
    );
    this.item.tooltip = message;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.indicator.postRecording(false);
  }

  showFeedback(message: string): void {
    this.item.tooltip = message;
    vscode.window.setStatusBarMessage(`$(comment-discussion) Voice: ${message}`, 8_000);
  }

  dispose(): void {
    this.item.dispose();
  }

  private text(english: string, hebrew: string): string {
    return this.localize(english, hebrew);
  }
}

/** One monotonic host-local namespace for speech, utterance and UI confirmation IDs. */
export class AssistantIdSequence {
  private value = 0;

  next(prefix: string, now = Date.now()): string {
    this.value += 1;
    return `${prefix}-${now}-${this.value}`;
  }
}

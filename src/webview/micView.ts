/**
 * Compatibility surface for extension-host imports. The implementation lives
 * under `webview/mic` so provider lifecycle, document, and CSS have clear
 * ownership boundaries.
 */
export { MicViewProvider } from './mic/provider';
export type {
  AssistantMappingSummary,
  AssistantProviderId,
  AssistantProviderStatus,
  HostMessage,
  PendingAssistantAction,
  PendingAssistantSend,
  ViewState,
  WebviewMessage,
} from './protocol';

import { LlmToolCall } from './openai-compatible.service';

export interface PendingToolMessage {
  tool_call_id: string;
  content: string;
}

export interface PendingToolResumeContext {
  assistantContent?: string | null;
  assistantReasoningContent?: string | null;
  assistantToolCalls: LlmToolCall[];
  priorToolMessages: PendingToolMessage[];
  approvedToolCallId: string;
}

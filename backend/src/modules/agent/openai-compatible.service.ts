import { BadGatewayException, Injectable } from '@nestjs/common';
import { RuntimeModelConfig } from '../model-configs/model-configs.service';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface LlmToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmAssistantMessage {
  content?: string;
  tool_calls?: LlmToolCall[];
}

@Injectable()
export class OpenAiCompatibleService {
  async chat(input: {
    config: RuntimeModelConfig;
    messages: LlmMessage[];
    tools?: unknown[];
    temperature?: number;
  }): Promise<LlmAssistantMessage> {
    const response = await fetch(`${input.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.config.apiKey}`,
      },
      body: JSON.stringify({
        model: input.config.modelName,
        messages: input.messages,
        tools: input.config.supportsTools ? input.tools : undefined,
        temperature: input.temperature ?? 0.2,
      }),
    }).catch((error) => {
      throw new BadGatewayException(error instanceof Error ? error.message : 'Model request failed.');
    });

    if (!response.ok) {
      throw new BadGatewayException(`Model provider returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: LlmAssistantMessage }>;
    };
    const message = payload.choices?.[0]?.message;
    if (!message) {
      throw new BadGatewayException('Model provider returned an empty response.');
    }
    return message;
  }
}


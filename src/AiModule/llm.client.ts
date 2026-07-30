import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmProviderId =
  | 'openai'
  | 'groq'
  | 'grok'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'local';

type ProviderConfig = {
  id: LlmProviderId;
  apiKeyEnv: string;
  baseUrl: string;
  defaultModel: string;
  /** OpenAI-compatible chat/completions vs Gemini generateContent */
  style: 'openai' | 'gemini';
};

const PROVIDERS: Record<Exclude<LlmProviderId, 'local'>, ProviderConfig> = {
  openai: {
    id: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    style: 'openai',
  },
  groq: {
    id: 'groq',
    apiKeyEnv: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    style: 'openai',
  },
  grok: {
    id: 'grok',
    apiKeyEnv: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-latest',
    style: 'openai',
  },
  gemini: {
    id: 'gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    style: 'gemini',
  },
  openrouter: {
    id: 'openrouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    style: 'openai',
  },
  ollama: {
    id: 'ollama',
    apiKeyEnv: 'OLLAMA_API_KEY', // optional; local usually needs none
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.2',
    style: 'openai',
  },
};

@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);

  constructor(private readonly config: ConfigService) {}

  /** Active provider from AI_PROVIDER (default: first key that is set). */
  resolveProvider(): LlmProviderId {
    const forced = this.config.get<string>('AI_PROVIDER')?.trim().toLowerCase();
    if (forced && forced in PROVIDERS) {
      return forced as LlmProviderId;
    }
    if (forced === 'local') return 'local';

    // Auto-detect: prefer free/cheap options first
    const order: Exclude<LlmProviderId, 'local'>[] = [
      'groq',
      'gemini',
      'openrouter',
      'grok',
      'openai',
      'ollama',
    ];
    for (const id of order) {
      if (this.hasKey(id)) return id;
    }
    return 'local';
  }

  isConfigured(): boolean {
    return this.resolveProvider() !== 'local';
  }

  providerLabel(): LlmProviderId {
    return this.resolveProvider();
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const id = this.resolveProvider();
    if (id === 'local') {
      throw new ServiceUnavailableException(
        'No AI provider configured. Set GROQ_API_KEY (free) or GEMINI_API_KEY / OPENAI_API_KEY.',
      );
    }

    const cfg = PROVIDERS[id];
    const model =
      this.config.get<string>('AI_MODEL')?.trim() ||
      this.config.get<string>('OPENAI_MODEL')?.trim() ||
      cfg.defaultModel;

    try {
      if (cfg.style === 'gemini') {
        return await this.chatGemini(cfg, model, messages);
      }
      return await this.chatOpenAiCompatible(cfg, model, messages);
    } catch (err) {
      this.logger.warn(
        `${id} chat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  private hasKey(id: Exclude<LlmProviderId, 'local'>): boolean {
    if (id === 'ollama') {
      // Ollama is local; treat as configured if AI_PROVIDER=ollama or OLLAMA_BASE_URL set
      return (
        this.config.get<string>('AI_PROVIDER')?.trim().toLowerCase() ===
          'ollama' ||
        !!this.config.get<string>('OLLAMA_BASE_URL')?.trim()
      );
    }
    const env = PROVIDERS[id].apiKeyEnv;
    return !!this.config.get<string>(env)?.trim();
  }

  private apiKey(cfg: ProviderConfig): string {
    return this.config.get<string>(cfg.apiKeyEnv)?.trim() ?? '';
  }

  private baseUrl(cfg: ProviderConfig): string {
    if (cfg.id === 'ollama') {
      return (
        this.config.get<string>('OLLAMA_BASE_URL')?.trim() || cfg.baseUrl
      ).replace(/\/$/, '');
    }
    return cfg.baseUrl;
  }

  private async chatOpenAiCompatible(
    cfg: ProviderConfig,
    model: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const key = this.apiKey(cfg);
    if (cfg.id !== 'ollama' && !key) {
      throw new ServiceUnavailableException(
        `Missing ${cfg.apiKeyEnv} for provider ${cfg.id}`,
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (cfg.id === 'openrouter') {
      headers['HTTP-Referer'] =
        this.config.get<string>('OPENROUTER_SITE_URL') ||
        'http://localhost:3000';
      headers['X-Title'] = 'AI Time Machine';
    }

    const res = await fetch(`${this.baseUrl(cfg)}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `${cfg.id} failed: ${res.status} ${body.slice(0, 240)}`,
      );
      throw new ServiceUnavailableException(
        `${cfg.id} error ${res.status}. Check plan/billing or switch AI_PROVIDER (try groq).`,
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }

  private async chatGemini(
    cfg: ProviderConfig,
    model: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const key = this.apiKey(cfg);
    if (!key) {
      throw new ServiceUnavailableException('Missing GEMINI_API_KEY');
    }

    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const url =
      `${this.baseUrl(cfg)}/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(key)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system
          ? { parts: [{ text: system }] }
          : undefined,
        contents,
        generationConfig: { temperature: 0.3 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(`gemini failed: ${res.status} ${body.slice(0, 240)}`);
      throw new ServiceUnavailableException(
        `gemini error ${res.status}. Check GEMINI_API_KEY / quota.`,
      );
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim() ?? ''
    );
  }
}

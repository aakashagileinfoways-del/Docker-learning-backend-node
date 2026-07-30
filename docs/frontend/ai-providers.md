# AI providers for Time Machine (`/ai/ask`)

Your OpenAI log (`429` quota exceeded) means the **key is valid but the account has no credits**. Switch provider with `AI_PROVIDER` in `.env`.

## Supported in this backend

| Provider | Env key | Free? | Suggested `AI_MODEL` | Get key |
|---|---|---|---|---|
| **Groq** (recommended) | `GROQ_API_KEY` | Yes (generous free tier) | `llama-3.3-70b-versatile` | [console.groq.com/keys](https://console.groq.com/keys) |
| **Gemini** | `GEMINI_API_KEY` | Yes (Google AI Studio free tier) | `gemini-2.0-flash` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **OpenRouter** | `OPENROUTER_API_KEY` | Some free models | `google/gemini-2.0-flash-exp:free` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Ollama** (local) | none | 100% free on your machine | `llama3.2` | [ollama.com](https://ollama.com) |
| **OpenAI** | `OPENAI_API_KEY` | No (needs billing) | `gpt-4o-mini` | platform.openai.com |
| **Grok (xAI)** | `XAI_API_KEY` | Limited / paid | `grok-2-latest` | console.x.ai |
| **local** | — | Always | — | No LLM; ranked timeline only |

## Quick switch (Groq free)

```env
AI_PROVIDER=groq
AI_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_your_key_here
```

Restart the Nest server. `/ai/ask` response `provider` will be `"groq"`.

## Gemini free

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-2.0-flash
GEMINI_API_KEY=your_key_here
```

## Ollama (offline / free forever)

```bash
ollama pull llama3.2
ollama serve
```

```env
AI_PROVIDER=ollama
AI_MODEL=llama3.2
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

## Behavior

1. If cloud provider fails (429 / quota), backend **falls back to local** ranked answer (no hard crash).
2. `/ai/search` never needs a provider — text ranking only.
3. Auto-detect order if `AI_PROVIDER` unset: groq → gemini → openrouter → grok → openai → ollama → local.

## Frontend note

Show `provider` badge on Ask results: `groq` | `gemini` | `openai` | `local` | …

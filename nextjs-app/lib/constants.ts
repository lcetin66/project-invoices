export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/tiff",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf"
]);

export const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "tif",
  "tiff",
  "webp",
  "heic",
  "heif"
]);

export const AI_OPTIONS = {
  openai: { label: "OpenAI GPT-4o-Mini (direkt, Standard)", provider: "openai", model: "gpt-4o-mini" },
  openrouter_openai: {
    label: "OpenAI GPT-4o-Mini über OpenRouter (Standard)",
    provider: "openrouter",
    model: "openai/gpt-4o-mini"
  },
  openai_mini: { label: "OpenAI GPT-4o-Mini (direkt)", provider: "openai", model: "gpt-4o-mini" },
  openrouter_openai_mini: {
    label: "OpenAI GPT-4o-Mini über OpenRouter",
    provider: "openrouter",
    model: "openai/gpt-4o-mini"
  },
  openai_4o: { label: "OpenAI GPT-4o-Mini (direkt)", provider: "openai", model: "gpt-4o-mini" },
  openrouter_openai_4o: {
    label: "OpenAI GPT-4o-Mini über OpenRouter",
    provider: "openrouter",
    model: "openai/gpt-4o-mini"
  },
  deepseek: {
    label: "DeepSeek",
    provider: "openrouter",
    model: "deepseek/deepseek-chat-v3-0324"
  },
  anthropic: {
    label: "Anthropic Claude",
    provider: "openrouter",
    model: "anthropic/claude-3.5-sonnet"
  },
  google: {
    label: "Google Gemini 2.0 Flash (über OpenRouter)",
    provider: "openrouter",
    model: "google/gemini-2.0-flash-001"
  },
  google_pro: {
    label: "Google Gemini 1.5 Pro (über OpenRouter)",
    provider: "openrouter",
    model: "google/gemini-pro-1.5"
  }
} as const;

export type AiServiceKey = keyof typeof AI_OPTIONS;

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
  openai: { label: "OpenAI (direkt)", provider: "openai", model: "gpt-5.4-mini" },
  openrouter_openai: {
    label: "OpenAI über OpenRouter",
    provider: "openrouter",
    model: "openai/gpt-5.4-mini"
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
    label: "Google Gemini",
    provider: "openrouter",
    model: "google/gemini-2.0-flash-001"
  }
} as const;

export type AiServiceKey = keyof typeof AI_OPTIONS;

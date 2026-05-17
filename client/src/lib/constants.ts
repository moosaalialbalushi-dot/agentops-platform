export const C = {
  bg: "#05070d", surface: "#0a0d16", card: "#0f1420", border: "#1a2035",
  borderHi: "#2a3550", accent: "#6366f1", accentHi: "#818cf8",
  green: "#10b981", red: "#ef4444", yellow: "#f59e0b", cyan: "#22d3ee",
  purple: "#a78bfa", orange: "#f97316", text: "#f1f5f9", muted: "#64748b", dim: "#2a3550",
};

export const PERSONAS = {
  researcher: { icon: "◎", label: "Researcher", color: "#22d3ee" },
  guardian:   { icon: "⬟", label: "Guardian",   color: "#ef4444" },
  connector:  { icon: "⌘", label: "Connector",  color: "#a78bfa" },
  strategist: { icon: "◈", label: "Strategist", color: "#f59e0b" },
  architect:  { icon: "⬡", label: "Architect",  color: "#6366f1" },
  engineer:   { icon: "⚙", label: "Engineer",   color: "#10b981" },
};

export const PROVIDERS = {
  claude:      { label: "Claude",      color: "#d97706", logo: "◆" },
  gemini:      { label: "Gemini",      color: "#4285f4", logo: "✦" },
  deepseek:    { label: "DeepSeek",    color: "#10b981", logo: "◉" },
  openai:      { label: "OpenAI",      color: "#74aa9c", logo: "⊕" },
  mistral:     { label: "Mistral",     color: "#ff7000", logo: "◐" },
  cohere:      { label: "Cohere",      color: "#39594d", logo: "◑" },
  groq:        { label: "Groq",        color: "#f55036", logo: "◧" },
  zhipu:       { label: "Z AI (Zhipu)", color: "#00b4d8", logo: "Z" },
  openrouter:  { label: "OpenRouter",  color: "#7c3aed", logo: "⊛" },
  notebooklm:  { label: "NotebookLM",  color: "#1a73e8", logo: "⊞" },
  imagen:      { label: "Imagen",      color: "#34a853", logo: "⬡" },
  nano_banana: { label: "Nano Banana", color: "#34a853", logo: "⬡" },
  ernie_image: { label: "Ernie Image", color: "#ff7000", logo: "E" },
  chartgen:    { label: "ChartGen",    color: "#6366f1", logo: "📊" },
  veo:         { label: "Veo (Video)", color: "#0f9d58", logo: "▶" },
  custom:      { label: "Custom",      color: "#8b5cf6", logo: "✳" },
};

export const MODELS_BY_PROVIDER = {
  claude:     [
    "claude-3-5-sonnet-20241022",
    "claude-3-7-sonnet-20250219",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6",
  ],
  gemini:     [
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ],
  deepseek:   ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
  openai:     [
    "gpt-4o",
    "gpt-4o-mini",
    "o1",
    "o3-mini",
  ],
  mistral:    [
    "mistral-large-latest",
    "codestral-latest",
  ],
  cohere:     ["command-r-plus", "command-r"],
  groq:       [
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "mixtral-8x7b-32768",
  ],
  openrouter: [
    "qwen/qwen-2.5-72b-instruct:free",
    "qwen/qwq-32b:free",
    "deepseek/deepseek-r1:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-exp:free",
  ],
  zhipu: [
    "glm-4-flash",
    "glm-4-plus",
    "glm-z1-flash",
  ],
  notebooklm: [
    "notebooklm-research",
    "notebooklm-slides",
    "notebooklm-summary",
    "notebooklm-qa",
    "notebooklm-podcast",
  ],
  imagen: [
    "imagen-3.0-generate-002",
    "imagen-3.0-fast-generate-001",
  ],
  nano_banana: [
    "nano-banana-2.0-generate-001",
    "nano-banana-1.0-generate-001",
  ],
  ernie_image: [
    "ernie-vilg-v2",
  ],
  chartgen: [
    "mermaid-gen",
    "chartjs-gen",
  ],
  veo:        [
    "veo-2.0-generate-001",
  ],
  custom:     ["custom-model"],
};

export const CAT_COLORS = {
  retrieval: "#22d3ee", execution: "#10b981", documents: "#a78bfa",
  data: "#f59e0b", devtools: "#6366f1", integrations: "#f97316",
  security: "#ef4444", comms: "#34d399", analysis: "#60a5fa", general: "#94a3b8",
};

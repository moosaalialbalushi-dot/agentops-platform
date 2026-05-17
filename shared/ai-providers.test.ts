import { describe, it, expect, vi } from 'vitest';
import { callProvider } from './ai-providers';

describe('callProvider', () => {
  it('throws error for unknown provider', async () => {
    await expect(callProvider('unknown', {} as any)).rejects.toThrow('Unknown provider: "unknown"');
  });

  it('handles lowercase provider names', async () => {
    // We just want to check if it routes correctly without throwing "Unknown provider"
    // Since we don't have API keys, it will throw "not set" errors for known providers
    try {
      await callProvider('claude', { messages: [] } as any);
    } catch (e: any) {
      expect(e.message).toContain('ANTHROPIC_API_KEY not set');
    }
  });

  it('recognizes new providers', async () => {
    try {
      await callProvider('nano_banana', { messages: [] } as any);
    } catch (e: any) {
      expect(e.message).toContain('GEMINI_API_KEY not set');
    }

    try {
      await callProvider('ernie_image', { messages: [] } as any);
    } catch (e: any) {
      expect(e.message).toContain('ERNIE_API_KEY not set');
    }

    try {
      await callProvider('chartgen', { messages: [] } as any);
    } catch (e: any) {
      expect(e.message).toContain('ANTHROPIC_API_KEY not set');
    }
  });
});

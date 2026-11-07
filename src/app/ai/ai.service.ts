import { Injectable, signal } from '@angular/core';
import { AiStatus, BotDecision, ChatRequest, DecideRequest } from './ai.types';
import { offlineDecision, offlineReply } from './offline-bot';
import { personaById } from './personas';

const HEALTH_TIMEOUT_MS = 6_000;
const AI_TIMEOUT_MS = 50_000;

/**
 * Talks to the API server (server/index.mjs). Never throws: if Gemini can't answer, the
 * offline bot answers instead and the result is marked `offline`.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  readonly status = signal<AiStatus>({ state: 'checking' });
  /** Most recent per-request failure, for a small notice in the UI. */
  readonly lastError = signal<string | null>(null);

  private health: Promise<AiStatus> | null = null;

  constructor() {
    void this.checkHealth();
  }

  /** Re-checks the server. Concurrent callers share one request. */
  checkHealth(): Promise<AiStatus> {
    this.health ??= this.fetchHealth().finally(() => (this.health = null));
    return this.health;
  }

  /** `useAi: false` skips the network and plays the built-in logic (saves API quota). */
  async decide(request: DecideRequest, useAi = true): Promise<BotDecision> {
    const persona = personaById(request.personaId)!;
    if (useAi && this.status().state === 'online') {
      try {
        const { decision } = await this.post<{ decision: Omit<BotDecision, 'offline'> }>(
          '/api/decide',
          request,
        );
        this.lastError.set(null);
        return { ...decision, offline: false };
      } catch (error) {
        this.noteFailure(`${persona.name}'s move`, error);
      }
    }
    return offlineDecision(request.view, persona);
  }

  async reply(request: ChatRequest): Promise<{ text: string; offline: boolean }> {
    const persona = personaById(request.personaId)!;
    if (this.status().state === 'online') {
      try {
        const { reply } = await this.post<{ reply: string }>('/api/chat', request);
        this.lastError.set(null);
        return { text: reply, offline: false };
      } catch (error) {
        this.noteFailure(`${persona.name}'s reply`, error);
      }
    }
    return { text: offlineReply(persona), offline: true };
  }

  private async fetchHealth(): Promise<AiStatus> {
    let next: AiStatus;
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        ai: { enabled: boolean; model: string; reason: string | null };
      };
      next = body.ai.enabled
        ? { state: 'online', model: body.ai.model }
        : { state: 'offline', model: body.ai.model, reason: body.ai.reason ?? 'AI disabled' };
    } catch {
      next = {
        state: 'offline',
        reason: 'the API server isn\'t running (start it with "npm run dev")',
      };
    }
    this.status.set(next);
    return next;
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      // 503 means the server has no working key: stop trying until the next health check.
      if (res.status === 503) void this.checkHealth();
      throw new ApiFailure(res.status, json.error ?? `HTTP ${res.status}`);
    }
    return json;
  }

  private noteFailure(what: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ai] ${what} fell back to built-in logic:`, message);
    // 429 = a usage cap or Gemini is busy. The server's message says which, in plain words.
    this.lastError.set(
      error instanceof ApiFailure && error.status === 429
        ? `${message}. Built-in logic handled ${what}.`
        : `Gemini didn't answer for ${what}, so built-in logic stepped in.`,
    );
  }
}

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

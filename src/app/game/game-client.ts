import { Injectable, computed, signal } from '@angular/core';
import type { PlayerAction } from '../poker/engine';
import type { PublicPersona } from '../shared/personas';
import type {
  ClientState,
  JoinRoomResponse,
  PlayerProfile,
  RoomSettings,
} from '../shared/protocol';

const SESSION_KEY = 'willaibeatus.session';

interface Session {
  code: string;
  token: string;
}

/**
 * The browser's side of a table. The server runs the game; this keeps the latest view it pushed
 * (over Server-Sent Events) and sends the player's moves. Survives a page refresh by
 * reconnecting with the saved session.
 */
@Injectable({ providedIn: 'root' })
export class GameClient {
  readonly state = signal<ClientState | null>(null);
  readonly connection = signal<'idle' | 'connecting' | 'open' | 'lost'>('idle');
  /** Last failed request, in plain words. */
  readonly error = signal<string | null>(null);
  /** Server/AI status for the start screen. */
  readonly health = signal<{ enabled: boolean; model: string; reason: string | null } | null>(null);
  readonly busy = signal(false);

  private source: EventSource | null = null;
  private session: Session | null = null;

  readonly view = computed<'start' | 'lobby' | 'game'>(() => {
    const s = this.state();
    if (!s) return 'start';
    return s.phase === 'lobby' ? 'lobby' : 'game';
  });
  readonly table = computed(() => this.state()?.table ?? null);
  readonly legal = computed(() => this.state()?.legal ?? null);
  readonly me = computed(() => {
    const s = this.state();
    return s?.table?.players.find((p) => p.id === s.you.id) ?? null;
  });
  readonly bots = computed(() => this.table()?.players.filter((p) => !p.isHuman) ?? []);

  constructor() {
    void this.checkHealth();
    const saved = readSession();
    if (saved) this.connect(saved.code, saved.token);
  }

  persona(id: string): PublicPersona | undefined {
    return this.state()?.personas[id];
  }

  /** The room code in the page URL (?room=ABCD), for invite links. */
  invitedCode(): string {
    return (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().slice(0, 4);
  }

  inviteLink(): string {
    return `${location.origin}${location.pathname}?room=${this.state()?.code ?? ''}`;
  }

  async checkHealth(): Promise<void> {
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(6000) });
      const body = await res.json();
      this.health.set(body.ai);
    } catch {
      this.health.set({
        enabled: false,
        model: '',
        reason: 'the game server isn\'t running (start it with "npm run dev")',
      });
    }
  }

  async createTable(
    name: string,
    settings: Partial<RoomSettings>,
    profile: PlayerProfile,
  ): Promise<void> {
    const res = await this.request<JoinRoomResponse>(
      '/api/rooms',
      { name, settings, profile },
      false,
    );
    if (res) this.connect(res.code, res.token);
  }

  async joinTable(code: string, name: string, profile: PlayerProfile): Promise<void> {
    const clean = code.trim().toUpperCase();
    const res = await this.request<JoinRoomResponse>(
      `/api/rooms/${clean}/join`,
      { name, profile },
      false,
    );
    if (res) this.connect(res.code, res.token);
  }

  async leave(): Promise<void> {
    if (this.session) await this.request(`/api/rooms/${this.session.code}/leave`);
    this.disconnect();
  }

  start = () => this.roomAction('start');
  ready = () => this.roomAction('ready');
  act = (action: PlayerAction) => this.roomAction('act', { action });
  sendMessage = (botId: string, text: string) => this.roomAction('message', { botId, text });
  announce = (text: string) => this.roomAction('announce', { text });

  async rememberedRounds(name: string): Promise<number> {
    try {
      const res = await fetch(`/api/history?name=${encodeURIComponent(name)}`);
      return (await res.json()).rounds ?? 0;
    } catch {
      return 0;
    }
  }

  async forget(name: string): Promise<void> {
    await this.request('/api/history/forget', { name }, false);
  }

  // --- Internals -------------------------------------------------------------------------------

  private connect(code: string, token: string): void {
    this.source?.close();
    this.session = { code, token };
    writeSession(this.session);
    history.replaceState(null, '', `${location.pathname}?room=${code}`);
    this.connection.set('connecting');

    const source = new EventSource(`/api/rooms/${code}/events?token=${encodeURIComponent(token)}`);
    this.source = source;
    source.onopen = () => this.connection.set('open');
    source.onmessage = (event) => {
      this.connection.set('open');
      this.state.set(JSON.parse(event.data) as ClientState);
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        // The server refused us (table closed or restarted): back to the start screen.
        this.error.set('Lost that table. It may have closed or the server restarted.');
        this.disconnect();
      } else {
        this.connection.set('lost'); // EventSource retries on its own
      }
    };
  }

  private disconnect(): void {
    this.source?.close();
    this.source = null;
    this.session = null;
    writeSession(null);
    this.state.set(null);
    this.connection.set('idle');
    history.replaceState(null, '', location.pathname);
  }

  private async roomAction(path: string, body: object = {}): Promise<void> {
    if (!this.session) return;
    await this.request(`/api/rooms/${this.session.code}/${path}`, body);
  }

  private async request<T>(url: string, body: object = {}, withToken = true): Promise<T | null> {
    this.busy.set(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(withToken && this.session ? { 'X-Player-Token': this.session.token } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.error.set(json.error ?? `Something went wrong (HTTP ${res.status})`);
        return null;
      }
      this.error.set(null);
      return json as T;
    } catch {
      this.error.set("Couldn't reach the game server.");
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode: refreshing the page will just drop you back at the start screen.
  }
}

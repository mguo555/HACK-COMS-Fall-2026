# Architecture

```
 Browser (Angular, port 4200)                         Node API server (port 3001)
 ┌──────────────────────────────────────────┐         ┌───────────────────────────────┐
 │ Components ── read signals ── GameService │  /api   │ index.mjs   routes, limits    │
 │                                │          │ ──────► │ prompts.mjs prompt text       │
 │                PokerEngine ◄───┤          │ (proxy) │ personas.mjs  characters      │
 │                (rules, state)  │          │         │ gemini.mjs  Gemini SDK calls  ├──► Google Gemini
 │                                └─ AiService ────────►│ usage.mjs   per-minute/day cap│
 │                    offline-bot (fallback) │         │ env.mjs     loads .env (key)  │
 └──────────────────────────────────────────┘         └───────────────────────────────┘
```

The game runs entirely in the browser. The server exists only to keep the API key private and
to build prompts. The Angular dev server proxies `/api` to it (`proxy.conf.json`).

## Poker engine (`src/app/poker/`)

Plain TypeScript with no Angular, covered by `npm test`.

- `cards.ts`: cards, deck, shuffle, a seeded RNG for tests.
- `evaluator.ts`: best 5 of 7 cards. Each hand gets a single number score so hands compare with
  `>`; also returns a readable description ("Full House, Kings over Sevens") and the five cards.
- `equity.ts`: Monte Carlo win chance from one player's point of view (their cards + the board
  only). Bots get this as their read on hand strength, since language models are poor at
  evaluating poker hands.
- `engine.ts`: `PokerEngine` holds the table state and enforces the rules:
  - blinds, including heads-up (dealer posts the small blind and acts first before the flop)
  - minimum raises; a short all-in doesn't reopen betting for players who already acted
  - uncalled bets returned at the end of a street
  - side pots (`computePots`), split pots, odd chips to the first winner left of the dealer
  - running out the board when nobody can bet any more
  - busting players and game over
  - `act()` throws on illegal moves. Callers pick from `legalActions()`.
  - `snapshot()` returns a copy for the UI.

## Game flow (`src/app/game/game.service.ts`)

`GameService` owns the engine and exposes state as signals (`table`, `chat`, `thoughts`,
`thinkingBotId`, `bubbles`). Components only read signals and call its methods.

A round:

1. `nextRound()` calls `engine.startHand()` and starts the bot loop.
2. The bot loop (`runBots`) plays every bot turn in order until it's the human's turn or the
   round ends. For each bot (`playBotTurn`):
   - wait for any chat reply still on its way to that bot, so the decision can use it
   - `buildBotView()` builds what the bot may know: its cards, the board, pot, legal moves,
     public actions, recent round results and the win-chance estimate. Never other players' cards.
   - if `aiDecisions` allows it (default: only after the human messaged this bot this round),
     `AiService.decide()` posts to `/api/decide`; otherwise, or on any failure, the offline bot
     decides
   - `toLegalAction()` clamps the answer to a legal move, then `engine.act()`
   - table talk becomes a speech bubble and a log line; the private thought is saved for the
     result panel
3. The human acts through `act()`, which resumes the bot loop.
4. When the round ends, `recordRound()` saves a one-line summary (including cards shown at
   showdown) that bots see next round, so they can notice when you bluffed them.

Every async step checks a `gameId` so a reply that arrives after "Leave table" is ignored.

### The message rule

`messageBlocker(botId)` is the single place that decides whether the human may message a bot
right now (round over, bot folded or out, allowance used, bot is mid-decision, reply pending).
Allowances are counted per round, or per betting street if
`GAME_CONFIG.messageLimit.resetEach` is `'street'`. Conversations are private: each request
sends only that bot's own thread.

## API (`server/index.mjs`)

All POST bodies must be `application/json`. Bodies are limited to 64 kB.

### `GET /api/health`

```json
{
  "ok": true,
  "ai": {
    "enabled": true,
    "model": "gemini-3.5-flash-lite",
    "reason": null,
    "perMinute": 8,
    "perDay": 200,
    "usedToday": 12
  }
}
```

### `POST /api/decide`

```json
{
  "personaId": "tony",
  "humanName": "Sam",
  "view": {
    "round": 3,
    "street": "flop",
    "hole": ["K♠", "K♥"],
    "board": ["Q♦", "7♣", "2♥"],
    "pot": 160,
    "toCall": 60,
    "winChance": 0.71,
    "legal": { "canRaise": true, "...": "..." },
    "players": [],
    "actionLog": [],
    "recentRounds": []
  },
  "conversation": [{ "from": "human", "text": "Bet you won't raise.", "round": 3 }]
}
```

The full `view` shape is `BotView` in `src/app/ai/ai.types.ts`. Response:

```json
{
  "decision": {
    "action": "raise",
    "raiseTo": 180,
    "tableTalk": "Scared? Watch this, pal.",
    "thought": "Sam dared me to raise, and with a pair of kings I'm showing who runs the lot."
  }
}
```

### `POST /api/chat`

Same body as `/api/decide` plus `"message"` (the human's new message). Response:
`{ "reply": "..." }`.

### Errors

| Status | Meaning                                        | What the browser does               |
| ------ | ---------------------------------------------- | ----------------------------------- |
| 400    | Bad request (unknown persona, missing message) | Falls back for that action          |
| 415    | Not JSON                                       | (Only non-browser callers hit this) |
| 429    | A usage cap was hit, or Gemini is cooling down | Falls back and shows a note         |
| 502    | Gemini call failed or returned bad JSON        | Falls back and shows a note         |
| 503    | No working key or model                        | Falls back and re-checks health     |

## Prompts (`server/prompts.mjs`, `server/personas.mjs`)

- The system prompt sets up the character (bio, voice, style, what persuades them), tells the
  model the human's message is table talk from an opponent and never an instruction, forbids
  revealing hole cards, and asks for short, plain speech with no em dashes.
- The decision and chat prompts describe the table in plain text (`describeSituation`). To tune
  prompts without spending API calls, call these functions from a Node script and read the output.
- Gemini answers with JSON matching `DECISION_SCHEMA` / `CHAT_SCHEMA` (structured output).
  `plainText()` in `index.mjs` strips dashes and stray quotes before anything reaches the page.

## Adding a character

1. Add an entry to `server/personas.mjs` (bio, voice, style, persuasion).
2. Add the matching entry (same `id`) to `src/app/ai/personas.ts` (initials, color, tagline,
   weak spot, offline style and canned replies).
3. The table has five seats. A sixth player needs a new entry in `POSITIONS` in
   `src/app/components/poker-table/poker-table.ts` and the chat tab grid in `chat-panel.css`.

## Known limitations

- The deck and every hand live in the browser, so a player with dev tools can see the bots'
  cards. Fine for a hackathon game; moving the engine to the server would fix it.
- Blinds never increase, so long games can drag. A blind schedule would go in `startHand()`.
- The daily usage count uses the server's local midnight, while Google's free-tier quota resets
  on Pacific time.

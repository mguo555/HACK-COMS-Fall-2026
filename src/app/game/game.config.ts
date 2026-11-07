/** Tunable game settings, shared by the server (which runs the tables) and the browser. */
export const GAME_CONFIG = {
  startingStack: 1000,

  /** Blinds go up every `roundsPerLevel` rounds, so games don't drag on. */
  blindLevels: [
    [10, 20],
    [15, 30],
    [25, 50],
    [50, 100],
    [100, 200],
    [200, 400],
    [400, 800],
  ] as [number, number][],
  roundsPerLevel: 8,

  /** Table size. Humans + AI seats never exceed maxSeats. */
  maxSeats: 6,
  maxHumans: 4,
  defaultAiSeats: 4,
  /** AIs the humans must knock out to win (busted AIs are replaced by new ones). */
  defaultKnockoutGoal: 5,

  /**
   * The chat rules: one private message to each AI player, and one announcement to the whole
   * table, per human. 'round' = refills every hand dealt; 'street' = every betting round.
   */
  messageLimit: { perPlayer: 1, resetEach: 'round' as 'round' | 'street' },
  announcementsPerRound: 1,
  maxMessageLength: 280,

  /**
   * When a bot's move is decided by Gemini. 'after-message' (default) only uses Gemini in rounds
   * where a human messaged that bot or announced to the table, so persuasion still shapes its
   * play; other moves use the built-in logic. This keeps usage well inside the free tier.
   * 'always' uses Gemini for every move (several times more calls). Chat always uses Gemini.
   */
  aiDecisions: 'after-message' as 'after-message' | 'always',

  /** A human who doesn't act in time checks (or folds if they can't). */
  turnTimeoutMs: 45_000,
  /** With 2+ humans, the next round starts after this long (or when everyone clicks Ready). */
  nextRoundDelayMs: 15_000,

  /** Bots never act faster than this, so the table is readable. */
  minBotTurnMs: 900,
  /** How long a speech bubble stays above a seat. */
  bubbleMs: 6000,
  /** Monte Carlo samples for a bot's win-chance estimate. */
  equityIterations: 700,
};

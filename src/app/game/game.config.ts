/** Tunable game settings. */
export const GAME_CONFIG = {
  startingStack: 1000,
  smallBlind: 10,
  bigBlind: 20,

  /**
   * The chat rule: how many private messages the human may send each AI player, and when that
   * allowance refills. 'round' = once per hand dealt; 'street' = every betting round
   * (preflop, flop, turn, river).
   */
  messageLimit: { perPlayer: 1, resetEach: 'round' as 'round' | 'street' },
  maxMessageLength: 280,

  /**
   * When a bot's move is decided by Gemini. 'after-message' (default) only uses Gemini in rounds
   * where the human has messaged that bot, so persuasion still shapes its play; other moves use
   * the built-in logic. This keeps usage well inside the free tier. 'always' uses Gemini for
   * every move (several times more calls per round). Chat replies always use Gemini.
   */
  aiDecisions: 'after-message' as 'after-message' | 'always',

  /** Bots never act faster than this, so the table is readable even in offline mode. */
  minBotTurnMs: 900,
  /** How long a speech bubble stays above a seat. */
  bubbleMs: 6000,
  /** Monte Carlo samples for a bot's win-chance estimate. */
  equityIterations: 700,
};

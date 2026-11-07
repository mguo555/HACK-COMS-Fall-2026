import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.POKER_AI_MODEL || 'claude-opus-5-5';
// Low effort keeps each bot turn quick; raise it in .env for deeper (slower) play.
export const EFFORT = process.env.POKER_AI_EFFORT ?? 'low';

// Server-side refusal fallbacks re-run a declined request on another model inside the same call.
// Only send the parameter to model families that accept it.
const SUPPORTS_FALLBACKS = /^claude-(fable-5|opus-5|sonnet-5-5)/.test(MODEL);

// Resolves credentials from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
const client = new Anthropic({ maxRetries: 1, timeout: 45_000 });

let status = { checked: false, enabled: false, reason: 'not checked yet' };

/**
 * Confirms once that credentials work and the model exists (the Models API is free to call).
 * The result is cached after the first success; failures are re-checked on the next call.
 */
export async function checkAi() {
  if (status.enabled) return status;
  try {
    await client.models.retrieve(MODEL);
    status = { checked: true, enabled: true, reason: null };
  } catch (error) {
    let reason = error instanceof Error ? error.message : String(error);
    if (error instanceof Anthropic.AuthenticationError) reason = 'the API key was rejected';
    else if (error instanceof Anthropic.NotFoundError)
      reason = `model ${MODEL} is not available to this key`;
    else if (/authentication method/i.test(reason))
      reason = 'no API key found (set ANTHROPIC_API_KEY in .env)';
    status = { checked: true, enabled: false, reason };
  }
  return status;
}

/**
 * Sends one request and returns the parsed JSON object matching `schema`.
 * Throws if Claude declines, runs out of tokens, or returns something unparseable.
 */
export async function askClaude({ system, prompt, schema, label }) {
  const started = Date.now();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: {
      ...(EFFORT ? { effort: EFFORT } : {}),
      format: { type: 'json_schema', schema },
    },
    ...(SUPPORTS_FALLBACKS
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
      : {}),
  });

  const ms = Date.now() - started;
  const { input_tokens, output_tokens } = response.usage;
  console.log(
    `[claude] ${label} ${response.model} ${ms}ms in=${input_tokens} out=${output_tokens} stop=${response.stop_reason}`,
  );

  if (response.stop_reason === 'refusal') throw new Error('Claude declined this request');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of tokens');

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return JSON.parse(text);
}

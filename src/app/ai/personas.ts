/**
 * UI-side data for the AI players, plus the knobs the offline fallback bot uses.
 * Prompt text lives in server/personas.mjs — keep the `id`s in sync.
 */
export interface PersonaInfo {
  id: string;
  name: string;
  fullName: string;
  initials: string;
  /** Accent color for the avatar and chat bubbles. */
  color: string;
  tagline: string;
  /** Shown in the chat panel as a hint about how to persuade them. */
  weakSpot: string;
  /** Used when Gemini isn't (no key, over a cap, or no message this round). Both 0 to 1. */
  offline: { aggression: number; looseness: number; replies: string[] };
}

export const PERSONAS: PersonaInfo[] = [
  {
    id: 'viktor',
    name: 'Viktor',
    fullName: 'Viktor "The Iceberg" Petrov',
    initials: 'VP',
    color: '#6cc4ff',
    tagline: 'Ex-chess grandmaster. Cold, precise, plays the odds.',
    weakSpot: 'Ignores emotion and bluster. Only a sharp argument about the cards will move him.',
    offline: {
      aggression: 0.6,
      looseness: 0.2,
      replies: [
        'Noted. The cards will decide, not your words.',
        'An interesting opening. I have seen it before.',
        'You talk like someone holding very little.',
      ],
    },
  },
  {
    id: 'rosie',
    name: 'Rosie',
    fullName: 'Rosie Delgado',
    initials: 'RD',
    color: '#ff7aa8',
    tagline: 'Retired kindergarten teacher. Sweet, chatty, sharper than she looks.',
    weakSpot: 'Soft-hearted and trusting. Kindness works; rudeness makes her stubborn.',
    offline: {
      aggression: 0.25,
      looseness: 0.75,
      replies: [
        'Oh sweetheart, you remind me of my grandson.',
        "Well aren't you a charmer. We'll see, dear.",
        'Biscuit would never forgive me if I gave up that easily!',
      ],
    },
  },
  {
    id: 'tony',
    name: 'Big Tony',
    fullName: '"Big Tony" Benedetto',
    initials: 'BT',
    color: '#ffb347',
    tagline: 'Owns three used-car lots and wants you to know it.',
    weakSpot: 'All ego. Dare him and he raises; tell him to fold and he does the opposite.',
    offline: {
      aggression: 0.85,
      looseness: 0.7,
      replies: [
        "Pal, I don't fold. I sell cars for a living.",
        "You think you can scare Big Tony? That's adorable, champ.",
        "Keep talkin'. Makes the win sweeter.",
      ],
    },
  },
  {
    id: 'nate',
    name: 'Nate',
    fullName: 'Nate Kim',
    initials: 'NK',
    color: '#7be0a6',
    tagline: 'Nervous grad student, playing with his rent money.',
    weakSpot: 'Easily spooked. Intimidation makes him fold; reassurance makes him call.',
    offline: {
      aggression: 0.15,
      looseness: 0.3,
      replies: [
        'Oh no. Um. Are you serious right now?',
        "Sorry, sorry. I'm just thinking. A lot.",
        "That's... that's fine. Totally fine. I'm fine.",
      ],
    },
  },
];

export const HUMAN_COLOR = '#b18cff';

export function personaById(id: string): PersonaInfo | undefined {
  return PERSONAS.find((p) => p.id === id);
}

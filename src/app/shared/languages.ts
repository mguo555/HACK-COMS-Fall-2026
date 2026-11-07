/**
 * Languages the AIs can talk in. Each player picks one; their whispers and the reactions to their
 * announcements come back in it. Gemini handles all of these, so it costs nothing extra.
 * `label` is how the language names itself; `name` is what the prompt says.
 */
export interface Language {
  code: string;
  label: string;
  name: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', label: 'English', name: 'English' },
  { code: 'es', label: 'Español', name: 'Spanish' },
  { code: 'zh', label: '中文', name: 'Simplified Chinese' },
  { code: 'hi', label: 'हिन्दी', name: 'Hindi' },
  { code: 'ar', label: 'العربية', name: 'Arabic' },
  { code: 'fr', label: 'Français', name: 'French' },
  { code: 'pt', label: 'Português', name: 'Portuguese' },
  { code: 'bn', label: 'বাংলা', name: 'Bengali' },
  { code: 'ru', label: 'Русский', name: 'Russian' },
  { code: 'ja', label: '日本語', name: 'Japanese' },
  { code: 'ko', label: '한국어', name: 'Korean' },
  { code: 'de', label: 'Deutsch', name: 'German' },
  { code: 'vi', label: 'Tiếng Việt', name: 'Vietnamese' },
  { code: 'tl', label: 'Tagalog', name: 'Tagalog' },
  { code: 'tr', label: 'Türkçe', name: 'Turkish' },
  { code: 'sw', label: 'Kiswahili', name: 'Swahili' },
  { code: 'ur', label: 'اردو', name: 'Urdu' },
  { code: 'it', label: 'Italiano', name: 'Italian' },
  { code: 'pl', label: 'Polski', name: 'Polish' },
  { code: 'ht', label: 'Kreyòl ayisyen', name: 'Haitian Creole' },
];

export function languageByCode(code: unknown): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** Common pronoun sets offered as suggestions; players can type their own. */
export const PRONOUN_SUGGESTIONS = [
  'she/her',
  'he/him',
  'they/them',
  'she/they',
  'he/they',
  'any pronouns',
];

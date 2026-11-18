import {type ClassValue, clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Translator for the few built-in strings of the UI kit (dialog buttons, loaders).
 * Apps register theirs with setUiTranslator; the default returns the English source text.
 */
let uiTranslator: (source: string) => string = source => source;

export function setUiTranslator(translator: (source: string) => string): void {
  uiTranslator = translator;
}

export function uiT(source: string): string {
  return uiTranslator(source);
}

import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

export function languageForPath(path: string | null): LanguageDescription | null {
  if (!path) return null;
  const fileName = path.split(/[\\/]/).pop() ?? path;
  return LanguageDescription.matchFilename(languages, fileName);
}

export function languageName(path: string | null): string {
  if (!path) return 'JavaScript'; // The untitled welcome document contains JavaScript.
  return languageForPath(path)?.name ?? 'Plain Text';
}

/* Accentos-insensitive text matching (handy for Spanish). */
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

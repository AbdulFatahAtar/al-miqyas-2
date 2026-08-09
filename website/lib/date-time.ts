const intlNoBreakWhitespace = /[\u00a0\u202f]/g;

export function normalizeIntlWhitespace(value: string) {
  return value.replace(intlNoBreakWhitespace, " ");
}

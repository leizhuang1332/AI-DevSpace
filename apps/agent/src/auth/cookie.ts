/**
 * Minimal cookie header parser. Supports only what we need:
 *   - header = `name1=value1; name2=value2; ...`
 *   - whitespace around `;` and `=` is tolerated
 *   - duplicate names: first wins
 *   - empty header or missing name → null
 */
export function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  for (const rawPair of header.split(';')) {
    const eq = rawPair.indexOf('=')
    if (eq < 0) continue
    const key = rawPair.slice(0, eq).trim()
    if (key !== name) continue
    const value = rawPair.slice(eq + 1).trim()
    return value
  }
  return null
}

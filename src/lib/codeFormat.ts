import { api } from './tauri'

export const FORMATTABLE_LANGUAGES = new Set(['c', 'cpp', 'c++', 'java', 'python', 'json'])

/** Formatted text with the same trailing-newline shape as `source` — the formatters always end output with one. */
export async function formatCode(language: string, source: string, indentWidth: number, useTab: boolean): Promise<string> {
  const formatted =
    language === 'json'
      ? JSON.stringify(JSON.parse(source), null, useTab ? '\t' : indentWidth)
      : await api.codeFormat.format(language, source, indentWidth, useTab)
  const normalized = formatted.replace(/\r\n/g, '\n')
  return source.endsWith('\n') ? normalized : normalized.replace(/\n$/, '')
}

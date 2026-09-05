import { api } from './tauri'

export function logError(source: string, message: string, context?: string): void {
  void api.errorLog.record(source, message, context ?? null).catch(() => {})
}

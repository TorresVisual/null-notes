import { api } from './tauri'
import { isMobile } from './platform'

export async function getStoredGitToken(): Promise<string> {
  if (!isMobile()) return ''
  return api.git.getGitToken()
}

export async function setStoredGitToken(token: string): Promise<void> {
  if (!isMobile()) return
  await api.git.setGitToken(token)
}

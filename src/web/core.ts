import { commands } from './memoryWorkspace'

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const handler = commands[cmd]
  if (!handler) throw new Error(`'${cmd}' is not available in the web app yet`)
  return handler(args) as T
}

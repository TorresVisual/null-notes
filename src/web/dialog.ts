export async function confirm(message: string): Promise<boolean> {
  return window.confirm(message)
}

export async function message(text: string): Promise<void> {
  window.alert(text)
}

export async function open(): Promise<string | null> {
  return null
}

export async function save(): Promise<string | null> {
  return null
}

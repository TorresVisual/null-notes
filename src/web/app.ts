export async function onBackButtonPress(): Promise<{ unregister: () => Promise<void> }> {
  return { unregister: async () => {} }
}

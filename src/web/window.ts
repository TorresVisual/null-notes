const noop = async () => {}

export function getCurrentWindow() {
  return {
    close: noop,
    minimize: noop,
    toggleMaximize: noop,
    setTitle: async (title: string) => {
      document.title = title
    },
    isMaximized: async () => false,
    onResized: async () => () => {},
  }
}

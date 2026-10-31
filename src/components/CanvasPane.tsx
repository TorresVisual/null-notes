interface CanvasPaneProps {
  path: string
}

export function CanvasPane({ path }: CanvasPaneProps) {
  return <div className="canvas-pane" data-path={path} />
}

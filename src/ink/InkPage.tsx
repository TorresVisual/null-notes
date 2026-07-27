import { useState } from 'react'
import { InkCanvas } from './InkCanvas'

// A page is wider than the typed-note column and starts about a screen tall;
// it grows from there as you write, so this is a floor, not a limit.
const PAGE_WIDTH = 900
const INITIAL_HEIGHT = 1200

interface InkPageProps {
  svgPath: string
}

export function InkPage({ svgPath }: InkPageProps) {
  const [zoom, setZoom] = useState(1)

  return (
    <div className="ink-page">
      <InkCanvas
        svgPath={svgPath}
        width={PAGE_WIDTH}
        height={INITIAL_HEIGHT}
        zoom={zoom}
        onZoomChange={setZoom}
        autoGrow
      />
    </div>
  )
}

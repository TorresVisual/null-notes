import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'

// Same shape as `mermaidTemplates.ts`'s table: one editable list the slash menu
// maps over. Skeletons, not full elements — `insertDiagram` expands them with
// Excalidraw's own `convertToExcalidrawElements`, which wires up the arrow
// bindings and label text so connectors stay attached when a box is dragged.
export interface DiagramTemplate {
  title: string
  description: string
  elements: ExcalidrawElementSkeleton[]
}

function box(id: string, text: string, x: number, y: number, width = 160, height = 60): ExcalidrawElementSkeleton {
  return { type: 'rectangle', id, x, y, width, height, label: { text } }
}

function link(from: string, to: string, type: 'arrow' | 'line' = 'arrow'): ExcalidrawElementSkeleton {
  return { type, x: 0, y: 0, start: { id: from }, end: { id: to } }
}

// Every description leads with "Diagram" so typing the generic "/diagram"
// surfaces all four, as the Mermaid templates do for "/mermaid".
export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    title: 'Stack Diagram',
    description: 'Diagram — memory stack frame, high to low addresses',
    elements: [
      { type: 'text', x: 40, y: 20, text: 'high address' },
      box('args', 'Arguments', 40, 50),
      box('ret', 'Return address', 40, 110),
      box('fp', 'Saved frame pointer', 40, 170),
      box('locals', 'Local variables', 40, 230),
      { type: 'text', x: 40, y: 310, text: 'low address (SP)' },
    ],
  },
  {
    title: 'Register Layout',
    description: 'Diagram — CPU registers feeding an ALU',
    elements: [
      box('pc', 'PC', 40, 40, 120),
      box('r0', 'R0', 40, 120, 120),
      box('r1', 'R1', 40, 200, 120),
      box('alu', 'ALU', 300, 120, 140, 80),
      box('out', 'Result', 560, 120, 120),
      link('r0', 'alu'),
      link('r1', 'alu'),
      link('alu', 'out'),
    ],
  },
  {
    title: 'Network Topology',
    description: 'Diagram — router, switch and hosts',
    elements: [
      box('net', 'Internet', 240, 20),
      box('router', 'Router', 240, 130),
      box('switch', 'Switch', 240, 240),
      box('h1', 'Host A', 20, 360, 140),
      box('h2', 'Host B', 250, 360, 140),
      box('h3', 'Host C', 480, 360, 140),
      link('net', 'router', 'line'),
      link('router', 'switch', 'line'),
      link('switch', 'h1', 'line'),
      link('switch', 'h2', 'line'),
      link('switch', 'h3', 'line'),
    ],
  },
  {
    title: 'Box and Arrow',
    description: 'Diagram — generic boxes connected by arrows',
    elements: [box('a', 'A', 40, 80), box('b', 'B', 300, 80), box('c', 'C', 560, 80), link('a', 'b'), link('b', 'c')],
  },
]

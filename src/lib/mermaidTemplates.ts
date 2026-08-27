// P14-1/P14-2: one editable table, not code scattered per slash command —
// the same shape `mathSnippets.ts`'s `MATH_SNIPPETS` already established.
// Each entry scaffolds a *starting*, correctly-connected diagram through
// Mermaid's own existing grammar (`MermaidBlock.tsx`) rather than adding a
// new rendering engine — guided authoring, not a new diagram type.
export interface MermaidTemplate {
  title: string
  description: string
  code: string
}

// Every description leads with "Mermaid diagram" so typing the generic
// "/mermaid" — the one search term someone might reach for out of habit —
// still surfaces all seven, not just whichever one happens to have "mermaid"
// in its own title.
export const MERMAID_TEMPLATES: MermaidTemplate[] = [
  {
    title: 'Flowchart',
    description: 'Mermaid diagram — steps and a decision',
    code: 'flowchart TD\n    Start([Start]) --> Step[Do something]\n    Step --> Decision{Condition?}\n    Decision -->|Yes| End([End])\n    Decision -->|No| Step',
  },
  {
    title: 'Graph',
    description: 'Mermaid diagram — generic nodes and edges',
    code: 'graph TD\n    A --> B\n    A --> C\n    B --> C',
  },
  {
    title: 'Class Diagram',
    description: 'Mermaid diagram — UML classes and inheritance',
    code: 'classDiagram\n    class Animal {\n        +String name\n        +makeSound()\n    }\n    class Dog {\n        +fetch()\n    }\n    Animal <|-- Dog',
  },
  {
    title: 'State Machine',
    description: 'Mermaid diagram — states and transitions',
    code: 'stateDiagram-v2\n    [*] --> Idle\n    Idle --> Running : start\n    Running --> Idle : stop\n    Running --> [*]',
  },
  {
    title: 'ER Diagram',
    description: 'Mermaid diagram — entities and relationships',
    code: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains',
  },
  // P14-2: the two structures a CS student draws constantly, and that
  // Mermaid's generic graph grammar makes fiddly to get right by hand —
  // correctly connected out of the box, editable as ordinary Mermaid text
  // afterward, same as every other template here.
  {
    title: 'Binary Tree',
    description: 'Mermaid diagram — a small correctly-connected tree',
    code: 'flowchart TD\n    A((5)) --> B((3))\n    A --> C((8))\n    B --> D((1))\n    B --> E((4))',
  },
  {
    title: 'Linked List',
    description: 'Mermaid diagram — nodes chained in sequence',
    code: 'flowchart LR\n    A[1] --> B[2] --> C[3] --> D[null]',
  },
]

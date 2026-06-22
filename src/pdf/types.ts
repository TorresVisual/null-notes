export interface TextBox {
  text: string
  x: number
  y: number
  w: number
  h: number
  isEquation: boolean
  latex: string | null
}

export interface Exercise {
  index: number
  title: string
  contentBlocks: TextBox[]
}

export interface PipelineProgress {
  stage: string
  page: number
  totalPages: number
}

export interface ImportResult {
  title: string
  exercises: Exercise[]
}

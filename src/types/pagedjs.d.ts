declare module 'pagedjs' {
  export interface PagedFlow {
    total: number
  }

  export class Previewer {
    preview(content: Node, stylesheets: string[], renderTo: Element): Promise<PagedFlow>
  }
}

declare module 'pagedjs' {
  export interface PagedFlow {
    total: number
  }

  /** Paged.js accepts a stylesheet either as a URL to fetch or as an
   *  `{ [baseHref]: cssText }` map of already-loaded CSS. */
  export type PagedStylesheet = string | Record<string, string>

  export class Previewer {
    chunker: { stop(): void; removePages(fromIndex?: number): void }
    polisher: { destroy(): void }
    preview(content: Node, stylesheets: PagedStylesheet[], renderTo: Element): Promise<PagedFlow>
  }
}

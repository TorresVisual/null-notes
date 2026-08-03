export interface PdfPage {
  index: number
  path: string
  width: number
  height: number
}

export interface PdfImportProgress {
  page: number
  totalPages: number
}

// A page image extracted during Markdown-mode import, not yet written to
// disk — the caller writes it via api.assets.write once the note's path is
// known, then substitutes the real path for `placeholder` in the returned
// markdown. `data` is a plain byte array, the same shape api.assets.write
// already accepts.
export interface PendingImage {
  placeholder: string
  mime: string
  data: number[]
}

export interface PdfMarkdownImport {
  markdown: string
  images: PendingImage[]
}

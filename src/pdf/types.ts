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

import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

export interface PageDimensions {
  width: number
  height: number
  scale: number
}

let pdfDoc: PDFDocumentProxy | null = null
let currentPage: PDFPageProxy | null = null

export async function loadPdf(data: ArrayBuffer): Promise<number> {
  pdfDoc = await pdfjsLib.getDocument({ data }).promise
  return pdfDoc.numPages
}

export async function renderPage(
  canvas: HTMLCanvasElement,
  pageIndex: number,
  targetWidth: number,
): Promise<PageDimensions> {
  if (!pdfDoc) throw new Error('No PDF loaded')

  if (currentPage) {
    currentPage.cleanup()
  }

  const page = await pdfDoc.getPage(pageIndex + 1)
  currentPage = page

  const viewport = page.getViewport({ scale: 1 })
  const scale = targetWidth / viewport.width
  const scaledViewport = page.getViewport({ scale: scale * devicePixelRatio })

  canvas.width = scaledViewport.width
  canvas.height = scaledViewport.height
  canvas.style.width = `${scaledViewport.width / devicePixelRatio}px`
  canvas.style.height = `${scaledViewport.height / devicePixelRatio}px`

  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise

  return {
    width: scaledViewport.width / devicePixelRatio,
    height: scaledViewport.height / devicePixelRatio,
    scale,
  }
}

export function getPdfDoc(): PDFDocumentProxy | null {
  return pdfDoc
}

import { PDFDocument } from 'pdf-lib'
import type { Annotation } from './types'
import { renderAnnotations } from './annotation-renderer'

const EXPORT_DPI = 250

export async function exportPng(
  pdfCanvas: HTMLCanvasElement,
  annotations: Annotation[],
  w: number,
  h: number,
): Promise<void> {
  const scale = EXPORT_DPI / 96
  const offCanvas = document.createElement('canvas')
  offCanvas.width = w * scale
  offCanvas.height = h * scale
  const ctx = offCanvas.getContext('2d')!

  // Draw PDF background
  ctx.drawImage(pdfCanvas, 0, 0, offCanvas.width, offCanvas.height)

  // Draw annotations at high resolution
  const annCanvas = document.createElement('canvas')
  renderAnnotations(annCanvas, annotations, [], w * scale, h * scale, 1)
  ctx.drawImage(annCanvas, 0, 0)

  const blob = await new Promise<Blob>((resolve, reject) => {
    offCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/png',
    )
  })

  downloadBlob(blob, 'pa-sheet.png')
}

export async function exportPdf(
  pdfBytes: ArrayBuffer,
  annotations: Annotation[],
  pageIndex: number,
  w: number,
  h: number,
  pdfCanvas: HTMLCanvasElement,
): Promise<void> {
  const scale = EXPORT_DPI / 96

  // Render annotations to image
  const annCanvas = document.createElement('canvas')
  renderAnnotations(annCanvas, annotations, [], w * scale, h * scale, 1)
  const annPngBytes = dataUrlToUint8Array(annCanvas.toDataURL('image/png'))

  // Load existing PDF and embed annotation image
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const pages = pdfDoc.getPages()
  const page = pages[pageIndex]
  const { width: pw, height: ph } = page.getSize()

  const pngImage = await pdfDoc.embedPng(annPngBytes)
  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: pw,
    height: ph,
    opacity: 1,
  })

  const outBytes = await pdfDoc.save()
  downloadBlob(
    new Blob([outBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    'pa-sheet.pdf',
  )
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

import './style.css'
import { loadPdf, renderPage } from './pdf-renderer'
import { renderAnnotations, hitTest, getHandles, hitTestHandle, boundsMap } from './annotation-renderer'
import { exportPng, exportPdf } from './exporter'
import type {
  AppState,
  Annotation,
  TextAnnotation,
  ShapeAnnotation,
  LineAnnotation,
  Tool,
  Handle,
} from './types'

// ── State ────────────────────────────────────────────────
const state: AppState = {
  tool: 'select',
  selectedIds: [],
  clipboard: null,
  annotations: [],
  history: [[]],
  historyIndex: 0,
  lineColor: '#000000',
  lineWidth: 2,
  textSize: 14,
  textColor: '#000000',
  arrowEnabled: false,
}

let pdfBytes: ArrayBuffer | null = null
let canvasW = 0
let canvasH = 0
let pageIndex = 0

// ── Interaction state ─────────────────────────────────────
type DragMode = 'none' | 'move' | 'draw' | 'resize' | 'rotate'
let dragMode: DragMode = 'none'
let dragStart = { x: 0, y: 0 }

// move
let moveStartSnapshot: Annotation[] = []

// resize
let resizingHandle: Handle | null = null
let resizingOriginal: Annotation | null = null
let resizingStartBounds: { x: number; y: number; w: number; h: number } | null = null

// rotate
let rotatingOriginal: ShapeAnnotation | null = null
let rotatingCenter = { x: 0, y: 0 }
let rotatingStartAngle = 0

// draw preview
let previewAnnotation: Annotation | null = null

// ── DOM ───────────────────────────────────────────────────
const app = document.getElementById('app')!
app.innerHTML = `
  <div id="toolbar">
    <button id="btn-import">PDF読込</button>
    <input type="file" id="file-input" accept=".pdf" style="display:none" />
    <div class="sep"></div>
    <button id="tool-select" class="active" title="選択 (V)">選択</button>
    <button id="tool-text" title="テキスト (T)">テキスト</button>
    <button id="tool-box" title="矩形 (R)">矩形</button>
    <button id="tool-circle" title="円 (C)">円</button>
    <button id="tool-mic" title="マイク (M)">マイク</button>
    <button id="tool-arrow" title="矢印図形 (W)">矢印</button>
    <button id="tool-line" title="線 (L)">線</button>
    <div class="sep"></div>
    <label>色</label>
    <input type="color" id="color-pick" value="#000000" />
    <label>線幅</label>
    <input type="number" id="line-width" value="2" min="1" max="20" style="width:44px" />
    <label>文字</label>
    <input type="number" id="text-size" value="14" min="6" max="72" style="width:44px" />
    <div class="sep"></div>
    <button id="btn-line-arrow">線矢印: OFF</button>
    <div class="sep"></div>
    <button id="btn-undo" title="Ctrl+Z">元に戻す</button>
    <button id="btn-redo" title="Ctrl+Y / Ctrl+Shift+Z">やり直し</button>
    <button id="btn-delete" title="Delete">削除</button>
    <div class="sep"></div>
    <button id="btn-export-png">PNG書出</button>
    <button id="btn-export-pdf">PDF書出</button>
  </div>
  <div id="workspace">
    <div id="import-prompt">
      <p>PAシートのPDFを読み込んでください</p>
      <button id="prompt-import-btn">PDFを選択 / ここにドロップ</button>
    </div>
    <div id="canvas-container" style="display:none">
      <canvas id="pdf-canvas"></canvas>
      <canvas id="annotation-canvas"></canvas>
    </div>
  </div>
  <div id="drop-overlay">PDFをドロップ</div>
`

const fileInput = document.getElementById('file-input') as HTMLInputElement
const pdfCanvas = document.getElementById('pdf-canvas') as HTMLCanvasElement
const annCanvas = document.getElementById('annotation-canvas') as HTMLCanvasElement
const canvasContainer = document.getElementById('canvas-container')!
const importPrompt = document.getElementById('import-prompt')!
const dropOverlay = document.getElementById('drop-overlay')!

// ── Toolbar ───────────────────────────────────────────────
const toolButtons: Record<string, Tool> = {
  'tool-select': 'select', 'tool-text': 'text', 'tool-box': 'box',
  'tool-circle': 'circle', 'tool-mic': 'mic', 'tool-arrow': 'arrow', 'tool-line': 'line',
}

for (const [id, tool] of Object.entries(toolButtons)) {
  document.getElementById(id)!.addEventListener('click', () => setTool(tool))
}

function setTool(tool: Tool) {
  state.tool = tool
  for (const id of Object.keys(toolButtons)) {
    document.getElementById(id)!.classList.toggle('active', toolButtons[id] === tool)
  }
  annCanvas.style.cursor = 'crosshair'
}

const colorPick = document.getElementById('color-pick') as HTMLInputElement
colorPick.addEventListener('input', () => { state.lineColor = colorPick.value; state.textColor = colorPick.value })

const lineWidthInput = document.getElementById('line-width') as HTMLInputElement
lineWidthInput.addEventListener('input', () => { state.lineWidth = parseInt(lineWidthInput.value) || 2 })

const textSizeInput = document.getElementById('text-size') as HTMLInputElement
textSizeInput.addEventListener('input', () => { state.textSize = parseInt(textSizeInput.value) || 14 })

const btnLineArrow = document.getElementById('btn-line-arrow')!
btnLineArrow.addEventListener('click', () => {
  state.arrowEnabled = !state.arrowEnabled
  btnLineArrow.textContent = `線矢印: ${state.arrowEnabled ? 'ON' : 'OFF'}`
  btnLineArrow.classList.toggle('active', state.arrowEnabled)
})

document.getElementById('btn-undo')!.addEventListener('click', undo)
document.getElementById('btn-redo')!.addEventListener('click', redo)
document.getElementById('btn-delete')!.addEventListener('click', deleteSelected)
document.getElementById('btn-import')!.addEventListener('click', () => fileInput.click())
document.getElementById('prompt-import-btn')!.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) loadFile(fileInput.files[0]) })

document.getElementById('btn-export-png')!.addEventListener('click', async () => {
  if (!pdfBytes) return
  await exportPng(pdfCanvas, state.annotations, canvasW, canvasH)
})
document.getElementById('btn-export-pdf')!.addEventListener('click', async () => {
  if (!pdfBytes) return
  await exportPdf(pdfBytes, state.annotations, pageIndex, canvasW, canvasH, pdfCanvas)
})

// ── PDF drag & drop ───────────────────────────────────────
document.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('visible') })
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropOverlay.classList.remove('visible') })
document.addEventListener('drop', (e) => {
  e.preventDefault()
  dropOverlay.classList.remove('visible')
  const file = e.dataTransfer?.files[0]
  if (file?.type === 'application/pdf') loadFile(file)
})

// ── PDF loading ───────────────────────────────────────────
async function loadFile(file: File) {
  pdfBytes = await file.arrayBuffer()
  await loadPdf(pdfBytes.slice(0))
  importPrompt.style.display = 'none'
  canvasContainer.style.display = 'inline-block'
  await renderCurrentPage()
  redraw()
}

async function renderCurrentPage() {
  const workspace = document.getElementById('workspace')!
  const targetW = Math.min(workspace.clientWidth - 40, 1000)
  const dims = await renderPage(pdfCanvas, pageIndex, targetW)
  canvasW = dims.width
  canvasH = dims.height
}

// ── Mouse events ──────────────────────────────────────────
annCanvas.addEventListener('mousedown', onMouseDown)
annCanvas.addEventListener('mousemove', onMouseMove)
annCanvas.addEventListener('mouseup', onMouseUp)
annCanvas.addEventListener('mouseleave', onMouseUp)

function canvasXY(e: MouseEvent) {
  const r = annCanvas.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function onMouseDown(e: MouseEvent) {
  if (!pdfBytes) return
  const { x, y } = canvasXY(e)
  dragStart = { x, y }

  // ── Step 1: handles (resize / rotate) — single selection only ──
  if (state.selectedIds.length === 1) {
    const selAnn = state.annotations.find((a) => a.id === state.selectedIds[0])
    if (selAnn) {
      const handles = getHandles(selAnn, canvasW, canvasH)
      const hit = hitTestHandle(handles, x, y)
      if (hit) {
        if (hit.position === 'rot' && selAnn.type === 'shape') {
          // ── Rotate ──
          dragMode = 'rotate'
          rotatingOriginal = structuredClone(selAnn)
          const cx = (selAnn.x + selAnn.w / 2) * canvasW
          const cy = (selAnn.y + selAnn.h / 2) * canvasH
          rotatingCenter = { x: cx, y: cy }
          rotatingStartAngle = Math.atan2(y - cy, x - cx) * 180 / Math.PI
        } else {
          // ── Resize ──
          dragMode = 'resize'
          resizingHandle = hit
          resizingOriginal = structuredClone(selAnn)
          resizingStartBounds = boundsMap.get(selAnn.id)
            ? { ...boundsMap.get(selAnn.id)! }
            : null
        }
        return
      }
    }
  }

  // ── Step 2: annotation body hit (all tools) ───────────────
  let hitId: string | null = null
  for (let i = state.annotations.length - 1; i >= 0; i--) {
    if (hitTest(state.annotations[i], x, y, canvasW, canvasH)) {
      hitId = state.annotations[i].id; break
    }
  }

  if (hitId) {
    if (e.ctrlKey || e.metaKey) {
      state.selectedIds = state.selectedIds.includes(hitId)
        ? state.selectedIds.filter((id) => id !== hitId)
        : [...state.selectedIds, hitId]
    } else {
      if (!state.selectedIds.includes(hitId)) state.selectedIds = [hitId]
      dragMode = 'move'
      moveStartSnapshot = structuredClone(
        state.annotations.filter((a) => state.selectedIds.includes(a.id)),
      )
    }
    redraw()
    return
  }

  // ── Step 3: empty space → current tool ───────────────────
  state.selectedIds = []
  if (state.tool === 'select') { redraw(); return }
  if (state.tool === 'text') { openTextEditor(x, y); return }
  dragMode = 'draw'
  previewAnnotation = null
  redraw()
}

function onMouseMove(e: MouseEvent) {
  if (!pdfBytes) return
  const { x, y } = canvasXY(e)

  // ── Cursor update when idle (all tools) ──────────────────
  if (dragMode === 'none') {
    if (state.selectedIds.length === 1) {
      const selAnn = state.annotations.find((a) => a.id === state.selectedIds[0])
      if (selAnn) {
        const hh = hitTestHandle(getHandles(selAnn, canvasW, canvasH), x, y)
        if (hh) { annCanvas.style.cursor = hh.cursor; return }
      }
    }
    for (let i = state.annotations.length - 1; i >= 0; i--) {
      if (hitTest(state.annotations[i], x, y, canvasW, canvasH)) {
        annCanvas.style.cursor = 'move'; return
      }
    }
    annCanvas.style.cursor = state.tool === 'select' ? 'default' : 'crosshair'
    return
  }

  if (dragMode === 'move') {
    const dxN = (x - dragStart.x) / canvasW
    const dyN = (y - dragStart.y) / canvasH
    for (const orig of moveStartSnapshot) {
      const ann = state.annotations.find((a) => a.id === orig.id)
      if (ann) applyMoveFromSnapshot(ann, orig, dxN, dyN)
    }
    redraw(); return
  }

  if (dragMode === 'resize' && resizingHandle && resizingOriginal) {
    const dx = x - dragStart.x
    const dy = y - dragStart.y
    const updated = applyResize(resizingOriginal, resizingHandle, dx, dy, e.shiftKey)
    const idx = state.annotations.findIndex((a) => a.id === updated.id)
    if (idx >= 0) state.annotations[idx] = updated
    redraw(); return
  }

  if (dragMode === 'rotate' && rotatingOriginal) {
    const selAnn = state.annotations.find((a) => a.id === rotatingOriginal!.id)
    if (selAnn && selAnn.type === 'shape') {
      const currentAngle = Math.atan2(y - rotatingCenter.y, x - rotatingCenter.x) * 180 / Math.PI
      let newRot = rotatingOriginal.rotation + (currentAngle - rotatingStartAngle)
      if (e.shiftKey) newRot = Math.round(newRot / 45) * 45
      selAnn.rotation = newRot
      redraw()
    }
    return
  }

  if (dragMode === 'draw') {
    previewAnnotation = buildPreview(x, y)
    redraw(previewAnnotation ? [previewAnnotation] : [])
    return
  }
}

function onMouseUp(e: MouseEvent) {
  if (dragMode === 'none') return
  const { x, y } = canvasXY(e)
  const mode = dragMode
  dragMode = 'none'

  if (mode === 'move') {
    // Only record history if something actually moved
    if (annotationsMoved(moveStartSnapshot)) pushHistory()
    return
  }

  if (mode === 'resize') {
    resizingHandle = null; resizingOriginal = null; resizingStartBounds = null
    pushHistory(); return
  }

  if (mode === 'rotate') {
    rotatingOriginal = null
    pushHistory(); return
  }

  if (mode === 'draw') {
    commitDraw(x, y)
    previewAnnotation = null
    redraw()
  }
}

function annotationsMoved(snapshot: Annotation[]): boolean {
  return snapshot.some((orig) => {
    const curr = state.annotations.find((a) => a.id === orig.id)
    if (!curr || curr.type !== orig.type) return true
    if (curr.type === 'text' && orig.type === 'text')
      return curr.x !== orig.x || curr.y !== orig.y
    if (curr.type === 'shape' && orig.type === 'shape')
      return curr.x !== orig.x || curr.y !== orig.y
    if (curr.type === 'line' && orig.type === 'line')
      return curr.x1 !== orig.x1 || curr.y1 !== orig.y1
    return false
  })
}

// ── Drawing ───────────────────────────────────────────────

function buildPreview(x: number, y: number): Annotation | null {
  const nx1 = dragStart.x / canvasW, ny1 = dragStart.y / canvasH
  const nx2 = x / canvasW,           ny2 = y / canvasH
  const x0 = Math.min(nx1, nx2),     y0 = Math.min(ny1, ny2)
  const dw = Math.abs(nx2 - nx1),    dh = Math.abs(ny2 - ny1)

  if (state.tool === 'line') {
    let ex = x, ey = y
    if (Math.abs(ey - dragStart.y) < 8) ey = dragStart.y
    if (Math.abs(ex - dragStart.x) < 8) ex = dragStart.x
    return { id: '__preview__', type: 'line', x1: nx1, y1: ny1, x2: ex / canvasW, y2: ey / canvasH, width: state.lineWidth, arrow: state.arrowEnabled, color: state.lineColor }
  }
  if (state.tool === 'box')
    return { id: '__preview__', type: 'shape', kind: 'box', x: x0, y: y0, w: dw, h: dh, rotation: 0, label: '', color: state.lineColor }
  if (state.tool === 'circle')
    return { id: '__preview__', type: 'shape', kind: 'circle', x: x0, y: y0, w: dw, h: dh, rotation: 0, label: '', color: state.lineColor }
  if (state.tool === 'mic') {
    const s = Math.max(dw, dh)
    return { id: '__preview__', type: 'shape', kind: 'mic', x: Math.min(nx1, nx2), y: Math.min(ny1, ny2), w: s, h: s * 1.4, rotation: 0, label: '', color: state.lineColor }
  }
  if (state.tool === 'arrow') {
    const s = Math.max(dw, dh)
    return { id: '__preview__', type: 'shape', kind: 'arrow', x: Math.min(nx1, nx2), y: Math.min(ny1, ny2), w: s * 0.7, h: s, rotation: 0, label: '', color: state.lineColor }
  }
  return null
}

function commitDraw(x: number, y: number) {
  const dx = x - dragStart.x
  const dy = y - dragStart.y
  const nx1 = Math.min(dragStart.x, x) / canvasW
  const ny1 = Math.min(dragStart.y, y) / canvasH

  if (state.tool === 'line') {
    let ex = x, ey = y
    if (Math.abs(ey - dragStart.y) < 8) ey = dragStart.y
    if (Math.abs(ex - dragStart.x) < 8) ex = dragStart.x
    if (Math.hypot(ex - dragStart.x, ey - dragStart.y) < 4) return
    addAnnotation({ id: uid(), type: 'line', x1: dragStart.x / canvasW, y1: dragStart.y / canvasH, x2: ex / canvasW, y2: ey / canvasH, width: state.lineWidth, arrow: state.arrowEnabled, color: state.lineColor })
    return
  }
  if (state.tool === 'box') {
    if (Math.abs(dx) < 5 || Math.abs(dy) < 5) return
    const id = uid()
    // Skip history here; label commit will push the final state
    addAnnotation({ id, type: 'shape', kind: 'box', x: nx1, y: ny1, w: Math.abs(dx) / canvasW, h: Math.abs(dy) / canvasH, rotation: 0, label: '', color: state.lineColor }, true)
    openLabelEditor(id)
    return
  }
  if (state.tool === 'circle') {
    if (Math.abs(dx) < 5 || Math.abs(dy) < 5) return
    const id = uid()
    addAnnotation({ id, type: 'shape', kind: 'circle', x: nx1, y: ny1, w: Math.abs(dx) / canvasW, h: Math.abs(dy) / canvasH, rotation: 0, label: '', color: state.lineColor }, true)
    openLabelEditor(id)
    return
  }
  if (state.tool === 'mic' || state.tool === 'arrow') {
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    const id = uid()
    if (state.tool === 'mic') {
      addAnnotation({ id, type: 'shape', kind: 'mic', x: nx1, y: ny1, w: s / canvasW, h: (s * 1.4) / canvasH, rotation: 0, label: '', color: state.lineColor }, true)
    } else {
      addAnnotation({ id, type: 'shape', kind: 'arrow', x: nx1, y: ny1, w: (s * 0.7) / canvasW, h: s / canvasH, rotation: 0, label: '', color: state.lineColor }, true)
    }
    openLabelEditor(id)
    return
  }
}

// ── Resize math ───────────────────────────────────────────

function applyResize(orig: Annotation, handle: Handle, dx: number, dy: number, shiftKey: boolean): Annotation {
  const dxN = dx / canvasW
  const dyN = dy / canvasH
  if (orig.type === 'shape') return applyShapeResize(orig, handle, dxN, dyN, shiftKey)
  if (orig.type === 'text')  return applyTextResize(orig, handle, dx, dy)
  if (orig.type === 'line')  return applyLineEndpointMove(orig, handle, dxN, dyN)
  return orig
}

function applyShapeResize(orig: ShapeAnnotation, handle: Handle, dxN: number, dyN: number, shiftKey: boolean): ShapeAnnotation {
  let { x, y, w, h } = orig
  const p = handle.position

  if      (p === 'tl') { x += dxN; y += dyN; w -= dxN; h -= dyN }
  else if (p === 'tc') { y += dyN; h -= dyN }
  else if (p === 'tr') { w += dxN; y += dyN; h -= dyN }
  else if (p === 'ml') { x += dxN; w -= dxN }
  else if (p === 'mr') { w += dxN }
  else if (p === 'bl') { x += dxN; w -= dxN; h += dyN }
  else if (p === 'bc') { h += dyN }
  else if (p === 'br') { w += dxN; h += dyN }

  const minN = 10 / Math.min(canvasW, canvasH)
  w = Math.max(w, minN)
  h = Math.max(h, minN)

  if (shiftKey && (p === 'tl' || p === 'tr' || p === 'bl' || p === 'br')) {
    // Lock aspect ratio using original ratio
    const ratio = orig.w / orig.h
    if (p === 'tl' || p === 'br') h = w / ratio
    else { w = h * ratio }
  }

  return { ...orig, x, y, w, h }
}

function applyTextResize(orig: TextAnnotation, handle: Handle, dx: number, dy: number): TextAnnotation {
  const b = resizingStartBounds
  if (!b) return orig

  // Original bounding box in screen pixels
  const startH = b.h * canvasH
  const startW = b.w * canvasW
  const p = handle.position

  let scale = 1
  if      (p === 'tc')             scale = Math.max(0.1, (startH - dy) / startH)
  else if (p === 'bc')             scale = Math.max(0.1, (startH + dy) / startH)
  else if (p === 'tl' || p === 'tr') scale = Math.max(0.1, (startH - dy) / startH)
  else if (p === 'bl' || p === 'br') scale = Math.max(0.1, (startH + dy) / startH)
  else if (p === 'ml')             scale = Math.max(0.1, (startW - dx) / startW)
  else if (p === 'mr')             scale = Math.max(0.1, (startW + dx) / startW)

  return { ...orig, size: Math.max(6, Math.round(orig.size * scale)) }
}

function applyLineEndpointMove(orig: LineAnnotation, handle: Handle, dxN: number, dyN: number): LineAnnotation {
  if (handle.position === 'p1') return { ...orig, x1: orig.x1 + dxN, y1: orig.y1 + dyN }
  if (handle.position === 'p2') return { ...orig, x2: orig.x2 + dxN, y2: orig.y2 + dyN }
  return orig
}

function applyMoveFromSnapshot(ann: Annotation, orig: Annotation, dxN: number, dyN: number) {
  if (ann.type === 'text'  && orig.type === 'text')  { ann.x  = orig.x  + dxN; ann.y  = orig.y  + dyN }
  if (ann.type === 'shape' && orig.type === 'shape') { ann.x  = orig.x  + dxN; ann.y  = orig.y  + dyN }
  if (ann.type === 'line'  && orig.type === 'line')  { ann.x1 = orig.x1 + dxN; ann.y1 = orig.y1 + dyN; ann.x2 = orig.x2 + dxN; ann.y2 = orig.y2 + dyN }
}

// ── Text editor ───────────────────────────────────────────
let activeEditor: HTMLTextAreaElement | null = null
let editingId: string | null = null

function openTextEditor(x: number, y: number, existingId?: string, initialText = '') {
  closeTextEditor()
  editingId = existingId ?? null
  const size = existingId
    ? (state.annotations.find((a) => a.id === existingId) as TextAnnotation | undefined)?.size ?? state.textSize
    : state.textSize

  const ta = document.createElement('textarea')
  ta.className = 'text-editor'
  ta.style.left = `${x}px`
  ta.style.top = `${y - size}px`
  ta.style.fontSize = `${size}px`
  ta.style.color = state.textColor
  ta.value = initialText
  ta.rows = 1

  function resize() {
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'
    ta.style.width  = 'auto'; ta.style.width  = Math.max(40, ta.scrollWidth) + 'px'
  }
  ta.addEventListener('input', resize)

  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { closeTextEditor(); return }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      const text = ta.value.trim()
      if (text) {
        if (editingId) {
          const ann = state.annotations.find((a) => a.id === editingId) as TextAnnotation | undefined
          if (ann) { ann.text = text; pushHistory() }
        } else {
          addAnnotation({ id: uid(), type: 'text', x: x / canvasW, y: y / canvasH, text, size, color: state.textColor })
        }
      }
      state.selectedIds = []
      closeTextEditor()
      redraw()
    }
    // All other keys pass through to the textarea naturally
  })

  canvasContainer.appendChild(ta)
  activeEditor = ta
  ta.focus()
  if (initialText) { ta.select() }
  resize()
}

function openLabelEditor(id: string) {
  const ann = state.annotations.find((a) => a.id === id) as ShapeAnnotation | undefined
  if (!ann) return
  const cx = (ann.x + ann.w / 2) * canvasW
  const cy = (ann.y + ann.h / 2) * canvasH

  const inp = document.createElement('input')
  inp.type = 'text'
  inp.style.cssText = `position:absolute;left:${cx-50}px;top:${cy-10}px;width:100px;font-size:13px;border:2px solid #0078d4;border-radius:3px;background:#fff;color:#000;text-align:center;z-index:20;outline:none;`
  inp.placeholder = 'ラベル (Enterで確定)'

  let committed = false
  function commit() {
    if (committed) return  // guard: Enter keydown removes inp → triggers blur
    committed = true
    ann!.label = inp.value
    inp.remove()
    pushHistory()  // single history entry for the whole shape+label creation
    redraw()
  }
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') commit() })
  inp.addEventListener('blur', commit)
  canvasContainer.appendChild(inp)
  inp.focus()
}

function closeTextEditor() {
  if (activeEditor) { activeEditor.remove(); activeEditor = null; editingId = null }
}

// Edit (or add) a label on an already-placed shape via double-click
function openShapeLabelEditor(id: string) {
  const ann = state.annotations.find((a) => a.id === id) as ShapeAnnotation | undefined
  if (!ann) return
  const cx = (ann.x + ann.w / 2) * canvasW
  const cy = (ann.y + ann.h / 2) * canvasH
  const originalLabel = ann.label

  const inp = document.createElement('input')
  inp.type = 'text'
  inp.value = ann.label
  inp.style.cssText = `position:absolute;left:${cx - 50}px;top:${cy - 10}px;width:100px;font-size:13px;border:2px solid #0078d4;border-radius:3px;background:#fff;color:#000;text-align:center;z-index:20;outline:none;`
  inp.placeholder = 'ラベル (Enterで確定)'

  let committed = false
  function commit(save: boolean) {
    if (committed) return
    committed = true
    if (save && inp.value !== originalLabel) {
      ann!.label = inp.value
      pushHistory()
    }
    inp.remove()
    redraw()
  }

  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter')  { ev.preventDefault(); commit(true) }
    if (ev.key === 'Escape') { ev.preventDefault(); commit(false) }
  })
  inp.addEventListener('blur', () => commit(true))
  canvasContainer.appendChild(inp)
  inp.focus()
  if (ann.label) inp.select()
}

// ── CRUD helpers ──────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10) }

// skipHistory = true when the caller will push history separately (e.g., after label edit)
function addAnnotation(ann: Annotation, skipHistory = false) {
  state.annotations.push(ann)
  state.selectedIds = [ann.id]
  if (!skipHistory) pushHistory()
  redraw()
}

function deleteSelected() {
  if (state.selectedIds.length === 0) return
  state.annotations = state.annotations.filter((a) => !state.selectedIds.includes(a.id))
  state.selectedIds = []
  pushHistory()
  redraw()
}

function copySelected() {
  if (state.selectedIds.length !== 1) return
  const ann = state.annotations.find((a) => a.id === state.selectedIds[0])
  if (ann) state.clipboard = structuredClone(ann)
}

function pasteClipboard() {
  if (!state.clipboard) return
  const ann = structuredClone(state.clipboard)
  ann.id = uid()
  offsetAnnotation(ann, 0.02, 0.02)
  addAnnotation(ann)
}

function cutSelected() { copySelected(); deleteSelected() }

function duplicateSelected() {
  if (state.selectedIds.length !== 1) return
  const ann = state.annotations.find((a) => a.id === state.selectedIds[0])
  if (!ann) return
  const copy = structuredClone(ann); copy.id = uid()
  offsetAnnotation(copy, 0.02, 0.02)
  addAnnotation(copy)
}

function selectAll() { state.selectedIds = state.annotations.map((a) => a.id); redraw() }

function offsetAnnotation(ann: Annotation, dxN: number, dyN: number) {
  if (ann.type === 'text')  { ann.x  += dxN; ann.y  += dyN }
  if (ann.type === 'shape') { ann.x  += dxN; ann.y  += dyN }
  if (ann.type === 'line')  { ann.x1 += dxN; ann.y1 += dyN; ann.x2 += dxN; ann.y2 += dyN }
}

function moveSelectedByKey(dpx: number, dpy: number) {
  if (state.selectedIds.length === 0 || !canvasW) return
  const dxN = dpx / canvasW, dyN = dpy / canvasH
  for (const id of state.selectedIds) {
    const ann = state.annotations.find((a) => a.id === id)
    if (ann) offsetAnnotation(ann, dxN, dyN)
  }
  pushHistory(); redraw()
}

// ── History ───────────────────────────────────────────────
const MAX_HISTORY = 50

function pushHistory() {
  // Discard all redo states beyond current position
  state.history = state.history.slice(0, state.historyIndex + 1)
  state.history.push(structuredClone(state.annotations))
  // Trim oldest entries if over limit
  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(state.history.length - MAX_HISTORY)
  }
  // Index always points to the last (current) entry — simple and unambiguous
  state.historyIndex = state.history.length - 1
  console.debug(`[history] push  idx=${state.historyIndex} len=${state.history.length}`)
}

function undo() {
  if (state.historyIndex <= 0) {
    console.debug(`[history] undo BLOCKED idx=${state.historyIndex} len=${state.history.length}`)
    return
  }
  state.historyIndex--
  state.annotations = structuredClone(state.history[state.historyIndex])
  state.selectedIds = []
  console.debug(`[history] undo  idx=${state.historyIndex} len=${state.history.length}`)
  redraw()
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) {
    console.debug(`[history] redo BLOCKED idx=${state.historyIndex} len=${state.history.length}`)
    return
  }
  state.historyIndex++
  state.annotations = structuredClone(state.history[state.historyIndex])
  state.selectedIds = []
  console.debug(`[history] redo  idx=${state.historyIndex} len=${state.history.length}`)
  redraw()
}

// ── Render ────────────────────────────────────────────────
function redraw(extra: Annotation[] = []) {
  if (!canvasW || !canvasH) return
  renderAnnotations(annCanvas, [...state.annotations, ...extra], state.selectedIds, canvasW, canvasH)
}

// ── Keyboard ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (activeEditor) {
    if (e.key === 'Escape') { closeTextEditor(); e.preventDefault() }
    // Ctrl+Z while text editor is open: abandon the edit and undo the last action
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); closeTextEditor(); undo()
    }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault(); closeTextEditor(); redo()
    }
    else return
    return
  }

  const ctrl = e.ctrlKey || e.metaKey

  if (ctrl) {
    switch (e.key.toLowerCase()) {
      case 'z': e.preventDefault(); e.shiftKey ? redo() : undo(); break
      case 'y': e.preventDefault(); redo(); break
      case 'c': e.preventDefault(); copySelected(); break
      case 'v': e.preventDefault(); pasteClipboard(); break
      case 'x': e.preventDefault(); cutSelected(); break
      case 'd': e.preventDefault(); duplicateSelected(); break
      case 'a': e.preventDefault(); selectAll(); break
    }
    return
  }

  switch (e.key) {
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break
    case 'Escape': state.selectedIds = []; redraw(); break
    case 'ArrowLeft':  e.preventDefault(); moveSelectedByKey(e.shiftKey ? -10 : -1, 0); break
    case 'ArrowRight': e.preventDefault(); moveSelectedByKey(e.shiftKey ?  10 :  1, 0); break
    case 'ArrowUp':    e.preventDefault(); moveSelectedByKey(0, e.shiftKey ? -10 : -1); break
    case 'ArrowDown':  e.preventDefault(); moveSelectedByKey(0, e.shiftKey ?  10 :  1); break
    default: {
      const shortcuts: Partial<Record<string, Tool>> = {
        v: 'select', t: 'text', r: 'box', c: 'circle', m: 'mic', w: 'arrow', l: 'line',
      }
      const tool = shortcuts[e.key.toLowerCase()]
      if (tool) setTool(tool)
    }
  }
})

// Double-click: edit text content, or edit shape label
annCanvas.addEventListener('dblclick', (e) => {
  if (!pdfBytes) return
  const { x, y } = canvasXY(e)
  for (let i = state.annotations.length - 1; i >= 0; i--) {
    const ann = state.annotations[i]
    if (!hitTest(ann, x, y, canvasW, canvasH)) continue
    if (ann.type === 'text') {
      openTextEditor(ann.x * canvasW, ann.y * canvasH, ann.id, ann.text)
    } else if (ann.type === 'shape') {
      openShapeLabelEditor(ann.id)
    }
    return
  }
})

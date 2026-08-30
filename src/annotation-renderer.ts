import type {
  Annotation,
  TextAnnotation,
  ShapeAnnotation,
  LineAnnotation,
  Handle,
  HandlePosition,
} from './types'

export const HANDLE_SIZE = 8

// Bounding boxes in normalized (0-1) coords, populated during render.
// Used by main.ts for hit-testing handles and resize math.
export const boundsMap = new Map<string, { x: number; y: number; w: number; h: number }>()

export function renderAnnotations(
  canvas: HTMLCanvasElement,
  annotations: Annotation[],
  selectedIds: string[],
  w: number,
  h: number,
  dpr = devicePixelRatio,
) {
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`

  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(dpr, dpr)

  for (const ann of annotations) {
    const sel = selectedIds.includes(ann.id)
    if (ann.type === 'text') drawText(ctx, ann, w, h, sel)
    else if (ann.type === 'shape') drawShape(ctx, ann, w, h, sel)
    else if (ann.type === 'line') drawLine(ctx, ann, w, h, sel)
  }

  // Resize handles only when exactly one real annotation is selected
  if (selectedIds.length === 1 && selectedIds[0] !== '__preview__') {
    const ann = annotations.find((a) => a.id === selectedIds[0])
    if (ann) drawHandles(ctx, getHandles(ann, w, h))
  }
}

// ── Individual drawers ────────────────────────────────────

function drawText(
  ctx: CanvasRenderingContext2D,
  ann: TextAnnotation,
  w: number,
  h: number,
  selected: boolean,
) {
  const x = ann.x * w
  const y = ann.y * h
  ctx.font = `${ann.size}px sans-serif`
  ctx.fillStyle = ann.color
  ctx.fillText(ann.text, x, y)

  const mw = ctx.measureText(ann.text).width
  boundsMap.set(ann.id, {
    x: ann.x,
    y: ann.y - ann.size / h,
    w: mw / w,
    h: (ann.size * 1.4) / h,
  })

  if (selected) {
    ctx.strokeStyle = '#0078d4'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 2])
    ctx.strokeRect(x - 2, y - ann.size, mw + 4, ann.size * 1.4)
    ctx.setLineDash([])
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  ann: ShapeAnnotation,
  w: number,
  h: number,
  selected: boolean,
) {
  const cx = ann.x * w + (ann.w * w) / 2
  const cy = ann.y * h + (ann.h * h) / 2
  const sw = ann.w * w
  const sh = ann.h * h

  boundsMap.set(ann.id, { x: ann.x, y: ann.y, w: ann.w, h: ann.h })

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((ann.rotation * Math.PI) / 180)
  ctx.strokeStyle = ann.color
  ctx.fillStyle = ann.color
  ctx.lineWidth = 1.5

  if (ann.kind === 'box') drawBox(ctx, sw, sh, ann.label)
  else if (ann.kind === 'circle') drawCircle(ctx, sw, sh, ann.label)
  else if (ann.kind === 'mic') drawMicSymbol(ctx, sw, sh, ann.color, ann.label)
  else if (ann.kind === 'arrow') drawArrowSymbol(ctx, sw, sh, ann.color, ann.label)

  if (selected) {
    ctx.strokeStyle = '#0078d4'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(-sw / 2 - 4, -sh / 2 - 4, sw + 8, sh + 8)
    ctx.setLineDash([])
  }

  ctx.restore()
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  sw: number,
  sh: number,
  label: string,
) {
  ctx.strokeRect(-sw / 2, -sh / 2, sw, sh)
  if (label) {
    ctx.font = `${Math.min(sh * 0.6, 14)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 0, 0)
  }
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  sw: number,
  sh: number,
  label: string,
) {
  ctx.beginPath()
  ctx.ellipse(0, 0, sw / 2, sh / 2, 0, 0, Math.PI * 2)
  ctx.stroke()
  if (label) {
    ctx.font = `${Math.min(sh * 0.45, 13)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 0, 0)
  }
}

// Mic symbol: φ shape — vertical line through circle center, arrowhead at top.
// Circle is stroked only so the shaft is visible inside it.
// Entire symbol is one indivisible object; rotation changes direction.
function drawMicSymbol(
  ctx: CanvasRenderingContext2D,
  sw: number,
  sh: number,
  color: string,
  label: string,
) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5

  // Circle: radius sized so diameter ≈ 40% of height, centered slightly below midpoint
  const r = Math.min(sw * 0.36, sh * 0.20)
  const circleY = sh * 0.07

  // Arrowhead: narrow and pointed (width ≈ circle radius)
  const tipY = -sh * 0.46
  const hw = Math.min(r * 0.85, sw * 0.15)  // half-width ≈ circle radius
  const hl = hw * 2.4                         // tall → narrow appearance

  // Shaft: runs from below arrowhead base through circle to bottom
  const lineTopY = tipY + hl
  const lineBotY = sh * 0.38

  // Draw shaft first so circle outline overlaps it (cleaner at intersection)
  ctx.beginPath()
  ctx.moveTo(0, lineTopY)
  ctx.lineTo(0, lineBotY)
  ctx.stroke()

  // Circle (stroke only — shaft is visible through it)
  ctx.beginPath()
  ctx.arc(0, circleY, r, 0, Math.PI * 2)
  ctx.stroke()

  // Filled arrowhead at tip
  ctx.beginPath()
  ctx.moveTo(0, tipY)
  ctx.lineTo(-hw, tipY + hl)
  ctx.lineTo(hw, tipY + hl)
  ctx.closePath()
  ctx.fill()

  if (label) {
    ctx.font = `${Math.min(sh * 0.15, 11)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(label, 0, lineBotY + 2)
  }
}

// Standalone arrow symbol (no circle). Useful for indicating directions.
function drawArrowSymbol(
  ctx: CanvasRenderingContext2D,
  sw: number,
  sh: number,
  color: string,
  label: string,
) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5

  const hw = Math.min(sw * 0.28, sh * 0.16)
  const hl = hw * 1.5
  const tip = -sh * 0.42
  const base = sh * 0.38

  // shaft
  ctx.beginPath()
  ctx.moveTo(0, base)
  ctx.lineTo(0, tip + hl)
  ctx.stroke()

  // arrowhead
  ctx.beginPath()
  ctx.moveTo(0, tip)
  ctx.lineTo(-hw, tip + hl)
  ctx.lineTo(hw, tip + hl)
  ctx.closePath()
  ctx.fill()

  if (label) {
    ctx.font = `${Math.min(sh * 0.17, 11)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(label, 0, base + 2)
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  ann: LineAnnotation,
  w: number,
  h: number,
  selected: boolean,
) {
  const x1 = ann.x1 * w
  const y1 = ann.y1 * h
  const x2 = ann.x2 * w
  const y2 = ann.y2 * h

  boundsMap.set(ann.id, {
    x: Math.min(ann.x1, ann.x2),
    y: Math.min(ann.y1, ann.y2),
    w: Math.abs(ann.x2 - ann.x1) || 0.001,
    h: Math.abs(ann.y2 - ann.y1) || 0.001,
  })

  ctx.strokeStyle = ann.color
  ctx.lineWidth = ann.width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()

  if (ann.arrow) drawArrowHead(ctx, x1, y1, x2, y2, ann.color, ann.width)

  if (selected) {
    ctx.strokeStyle = '#0078d4'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = Math.max(8, lineWidth * 4)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

// ── Handle system ─────────────────────────────────────────

const HANDLE_CURSORS: Record<HandlePosition, string> = {
  tl: 'nw-resize', tc: 'n-resize', tr: 'ne-resize',
  ml: 'w-resize',                  mr: 'e-resize',
  bl: 'sw-resize', bc: 's-resize', br: 'se-resize',
  p1: 'crosshair', p2: 'crosshair',
  rot: 'grab',
}

const ROT_OFFSET = 28 // px above bounding box top

export function getHandles(ann: Annotation, w: number, h: number): Handle[] {
  if (ann.type === 'line') {
    return [
      { position: 'p1', x: ann.x1 * w, y: ann.y1 * h, cursor: HANDLE_CURSORS.p1 },
      { position: 'p2', x: ann.x2 * w, y: ann.y2 * h, cursor: HANDLE_CURSORS.p2 },
    ]
  }

  const b = boundsMap.get(ann.id)
  if (!b) return []

  const bx = b.x * w
  const by = b.y * h
  const bw = b.w * w
  const bh = b.h * h
  const mx = bx + bw / 2
  const my = by + bh / 2

  const resizePos: [HandlePosition, number, number][] = [
    ['tl', bx,      by     ],
    ['tc', mx,      by     ],
    ['tr', bx + bw, by     ],
    ['ml', bx,      my     ],
    ['mr', bx + bw, my     ],
    ['bl', bx,      by + bh],
    ['bc', mx,      by + bh],
    ['br', bx + bw, by + bh],
  ]

  const handles: Handle[] = resizePos.map(([position, x, y]) => ({
    position, x, y, cursor: HANDLE_CURSORS[position],
  }))

  // Rotation handle only for shapes (not text, not line)
  if (ann.type === 'shape') {
    handles.push({ position: 'rot', x: mx, y: by - ROT_OFFSET, cursor: 'grab' })
  }

  return handles
}

export function hitTestHandle(handles: Handle[], px: number, py: number): Handle | null {
  const half = HANDLE_SIZE / 2 + 3
  for (const h of handles) {
    if (Math.abs(px - h.x) <= half && Math.abs(py - h.y) <= half) return h
  }
  return null
}

function drawHandles(ctx: CanvasRenderingContext2D, handles: Handle[]) {
  const tc  = handles.find((h) => h.position === 'tc')
  const rot = handles.find((h) => h.position === 'rot')

  // Connecting line from tc to rotation handle
  if (tc && rot) {
    ctx.save()
    ctx.strokeStyle = '#0078d4'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 2])
    ctx.beginPath()
    ctx.moveTo(tc.x, tc.y)
    ctx.lineTo(rot.x, rot.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  for (const h of handles) {
    ctx.lineWidth = 1.5
    if (h.position === 'rot') {
      // Rotation handle: filled blue circle
      ctx.fillStyle = '#0078d4'
      ctx.strokeStyle = '#fff'
      ctx.beginPath()
      ctx.arc(h.x, h.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else if (h.position === 'p1' || h.position === 'p2') {
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#0078d4'
      ctx.beginPath()
      ctx.arc(h.x, h.y, HANDLE_SIZE / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else {
      const hs = HANDLE_SIZE
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#0078d4'
      ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
      ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
    }
  }
}

// ── Hit testing ───────────────────────────────────────────

export function hitTest(
  ann: Annotation,
  px: number,
  py: number,
  w: number,
  h: number,
): boolean {
  if (ann.type === 'text') {
    const b = boundsMap.get(ann.id)
    if (b) {
      return (
        px >= b.x * w - 2 &&
        px <= (b.x + b.w) * w + 2 &&
        py >= b.y * h - 2 &&
        py <= (b.y + b.h) * h + 2
      )
    }
    // fallback before first render
    return (
      px >= ann.x * w - 2 &&
      px <= ann.x * w + 200 &&
      py >= ann.y * h - ann.size &&
      py <= ann.y * h + 4
    )
  }
  if (ann.type === 'shape') {
    const cx = ann.x * w + (ann.w * w) / 2
    const cy = ann.y * h + (ann.h * h) / 2
    const sw = ann.w * w + 10
    const sh = ann.h * h + 10
    const cos = Math.cos((-ann.rotation * Math.PI) / 180)
    const sin = Math.sin((-ann.rotation * Math.PI) / 180)
    const dx = px - cx
    const dy = py - cy
    const rx = dx * cos - dy * sin
    const ry = dx * sin + dy * cos
    return Math.abs(rx) <= sw / 2 && Math.abs(ry) <= sh / 2
  }
  if (ann.type === 'line') {
    const x1 = ann.x1 * w
    const y1 = ann.y1 * h
    const x2 = ann.x2 * w
    const y2 = ann.y2 * h
    const len = Math.hypot(x2 - x1, y2 - y1)
    if (len < 1) return false
    const dist = Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / len
    const t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (len * len)
    return dist < 6 && t >= -0.05 && t <= 1.05
  }
  return false
}

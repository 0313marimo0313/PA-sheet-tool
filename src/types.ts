export type AnnotationType = 'text' | 'shape' | 'line'
export type ShapeKind = 'box' | 'circle' | 'mic' | 'arrow'
export type HandlePosition = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br' | 'p1' | 'p2' | 'rot'

export interface Handle {
  position: HandlePosition
  x: number // screen px (display coords)
  y: number
  cursor: string
}

export interface TextAnnotation {
  id: string
  type: 'text'
  x: number
  y: number
  text: string
  size: number
  color: string
}

export interface ShapeAnnotation {
  id: string
  type: 'shape'
  kind: ShapeKind
  x: number
  y: number
  w: number
  h: number
  rotation: number
  label: string
  color: string
}

export interface LineAnnotation {
  id: string
  type: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  arrow: boolean
  color: string
}

export type Annotation = TextAnnotation | ShapeAnnotation | LineAnnotation

export type Tool = 'select' | 'text' | 'box' | 'circle' | 'mic' | 'arrow' | 'line'

export interface AppState {
  tool: Tool
  selectedIds: string[]
  clipboard: Annotation | null
  annotations: Annotation[]
  history: Annotation[][]
  historyIndex: number
  lineColor: string
  lineWidth: number
  textSize: number
  textColor: string
  arrowEnabled: boolean
}

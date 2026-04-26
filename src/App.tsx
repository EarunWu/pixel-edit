import {
  Download,
  Eraser,
  FilePlus2,
  Grid3X3,
  ImagePlus,
  Pencil,
  Pipette,
  Redo2,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { ChangeEvent, PointerEvent, ReactNode } from 'react'
import { useEffect, useMemo, useReducer, useRef } from 'react'
import './App.css'
import {
  MAX_HISTORY,
  clearDocument,
  cloneDocument,
  createDocument,
  documentToImageData,
  drawLine,
  erasePixel,
  exportPng,
  getPixel,
  importImageFile,
  parseHexColor,
  rgbaToHex,
  setPixel,
} from './pixels'
import type { HistoryState, PixelDocument, PixelPoint, Tool } from './pixels'

const CANVAS_SIZES = [16, 32, 64] as const
const ZOOM_LEVELS = [8, 12, 16, 20, 24] as const
const EXPORT_SCALES = [1, 4, 8, 16] as const
const PALETTE = [
  '#1f2937',
  '#ffffff',
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

type ImportMode = 'fit' | 'original'

type EditorState = {
  history: HistoryState
  tool: Tool
  color: string
  zoom: (typeof ZOOM_LEVELS)[number]
  showGrid: boolean
  exportScale: (typeof EXPORT_SCALES)[number]
  importMode: ImportMode
  importError: string | null
}

type EditorAction =
  | { type: 'set-tool'; tool: Tool }
  | { type: 'set-color'; color: string }
  | { type: 'set-zoom'; zoom: (typeof ZOOM_LEVELS)[number] }
  | { type: 'set-export-scale'; exportScale: (typeof EXPORT_SCALES)[number] }
  | { type: 'set-import-mode'; importMode: ImportMode }
  | { type: 'set-import-error'; importError: string | null }
  | { type: 'toggle-grid' }
  | { type: 'new-document'; size: (typeof CANVAS_SIZES)[number] }
  | { type: 'replace-present'; document: PixelDocument }
  | { type: 'import-document'; document: PixelDocument }
  | {
      type: 'commit-stroke'
      before: PixelDocument
      document: PixelDocument
    }
  | { type: 'clear-document' }
  | { type: 'undo' }
  | { type: 'redo' }

type StrokeState = {
  pointerId: number
  base: PixelDocument
  draft: PixelDocument
  lastPoint: PixelPoint
  tool: Exclude<Tool, 'eyedropper'>
  color: string
}

function createInitialState(): EditorState {
  const present = createDocument(32, 32)

  return {
    history: {
      past: [],
      present,
      future: [],
    },
    tool: 'pencil',
    color: '#ef4444',
    zoom: 16,
    showGrid: true,
    exportScale: 8,
    importMode: 'fit',
    importError: null,
  }
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'set-tool':
      return { ...state, tool: action.tool }
    case 'set-color':
      return { ...state, color: action.color }
    case 'set-zoom':
      return { ...state, zoom: action.zoom }
    case 'set-export-scale':
      return { ...state, exportScale: action.exportScale }
    case 'set-import-mode':
      return { ...state, importMode: action.importMode, importError: null }
    case 'set-import-error':
      return { ...state, importError: action.importError }
    case 'toggle-grid':
      return { ...state, showGrid: !state.showGrid }
    case 'new-document': {
      const present = createDocument(action.size, action.size)

      return {
        ...state,
        history: {
          past: [],
          present,
          future: [],
        },
      }
    }
    case 'import-document':
      if (documentsEqual(state.history.present, action.document)) {
        return { ...state, importError: null }
      }

      return {
        ...state,
        importError: null,
        history: {
          past: limitHistory([...state.history.past, state.history.present]),
          present: action.document,
          future: [],
        },
      }
    case 'replace-present':
      return {
        ...state,
        history: {
          ...state.history,
          present: action.document,
        },
      }
    case 'commit-stroke':
      if (documentsEqual(action.before, action.document)) {
        return {
          ...state,
          history: {
            ...state.history,
            present: action.before,
          },
        }
      }

      return {
        ...state,
        history: {
          past: limitHistory([...state.history.past, action.before]),
          present: action.document,
          future: [],
        },
      }
    case 'clear-document': {
      const cleared = clearDocument(state.history.present)

      if (documentsEqual(state.history.present, cleared)) {
        return state
      }

      return {
        ...state,
        history: {
          past: limitHistory([...state.history.past, state.history.present]),
          present: cleared,
          future: [],
        },
      }
    }
    case 'undo': {
      const previous = state.history.past.at(-1)

      if (!previous) {
        return state
      }

      return {
        ...state,
        history: {
          past: state.history.past.slice(0, -1),
          present: previous,
          future: [state.history.present, ...state.history.future],
        },
      }
    }
    case 'redo': {
      const next = state.history.future[0]

      if (!next) {
        return state
      }

      return {
        ...state,
        history: {
          past: limitHistory([...state.history.past, state.history.present]),
          present: next,
          future: state.history.future.slice(1),
        },
      }
    }
    default:
      return state
  }
}

function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialState)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stateRef = useRef(state)
  const strokeRef = useRef<StrokeState | null>(null)

  const document = state.history.present
  const canvasWidth = document.width * state.zoom
  const canvasHeight = document.height * state.zoom
  const canUndo = state.history.past.length > 0
  const canRedo = state.history.future.length > 0
  const activeSize = CANVAS_SIZES.includes(
    document.width as (typeof CANVAS_SIZES)[number],
  )
    ? document.width
    : null

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)

    const source = window.document.createElement('canvas')
    source.width = document.width
    source.height = document.height
    source.getContext('2d')?.putImageData(documentToImageData(document), 0, 0)

    context.drawImage(source, 0, 0, canvas.width, canvas.height)

    if (state.showGrid) {
      drawGrid(context, document.width, document.height, state.zoom)
    }
  }, [document, state.showGrid, state.zoom])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isCommand = event.ctrlKey || event.metaKey

      if (!isCommand) {
        return
      }

      if (key === 'z') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      }

      if (key === 'y') {
        event.preventDefault()
        dispatch({ type: 'redo' })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const currentColorPreview = useMemo(
    () => ({
      backgroundColor: state.color,
    }),
    [state.color],
  )

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return
    }

    const point = getCanvasPoint(event, stateRef.current.history.present)

    if (!point) {
      return
    }

    const currentState = stateRef.current

    if (currentState.tool === 'eyedropper') {
      const color = getPixel(currentState.history.present, point.x, point.y)

      if (color && color.a > 0) {
        dispatch({ type: 'set-color', color: rgbaToHex(color) })
      }

      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)

    const base = cloneDocument(currentState.history.present)
    const draft = cloneDocument(base)
    paintPixel(draft, point, currentState.tool, currentState.color)
    strokeRef.current = {
      pointerId: event.pointerId,
      base,
      draft,
      lastPoint: point,
      tool: currentState.tool,
      color: currentState.color,
    }

    dispatch({ type: 'replace-present', document: cloneDocument(draft) })
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current

    if (!stroke || stroke.pointerId !== event.pointerId) {
      return
    }

    const point = getCanvasPoint(event, stroke.draft)

    if (!point) {
      return
    }

    drawLine(stroke.draft, stroke.lastPoint, point, (x, y) => {
      paintPixel(stroke.draft, { x, y }, stroke.tool, stroke.color)
    })
    stroke.lastPoint = point

    dispatch({ type: 'replace-present', document: cloneDocument(stroke.draft) })
  }

  const finishStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current

    if (!stroke || stroke.pointerId !== event.pointerId) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    dispatch({
      type: 'commit-stroke',
      before: stroke.base,
      document: cloneDocument(stroke.draft),
    })
    strokeRef.current = null
  }

  const downloadPng = () => {
    const dataUrl = exportPng(state.history.present, state.exportScale)

    if (!dataUrl) {
      return
    }

    const link = window.document.createElement('a')
    link.href = dataUrl
    link.download = `pixel-${document.width}x${document.height}-${state.exportScale}x.png`
    link.click()
  }

  const handleImportImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      dispatch({ type: 'set-import-error', importError: '请选择图片文件' })
      return
    }

    const currentState = stateRef.current
    const targetSize =
      currentState.importMode === 'fit'
        ? {
            width: currentState.history.present.width,
            height: currentState.history.present.height,
          }
        : undefined

    try {
      const importedDocument = await importImageFile(file, targetSize)
      dispatch({ type: 'import-document', document: importedDocument })
    } catch {
      dispatch({ type: 'set-import-error', importError: '图片导入失败' })
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Pixel Edit">
          <span className="brand-mark">PX</span>
          <span className="brand-name">Pixel Edit</span>
        </div>

        <div className="toolbar" aria-label="工具栏">
          <div className="toolbar-group" role="group" aria-label="绘图工具">
            <IconButton
              active={state.tool === 'pencil'}
              label="画笔"
              onClick={() => dispatch({ type: 'set-tool', tool: 'pencil' })}
            >
              <Pencil size={18} />
            </IconButton>
            <IconButton
              active={state.tool === 'eraser'}
              label="橡皮"
              onClick={() => dispatch({ type: 'set-tool', tool: 'eraser' })}
            >
              <Eraser size={18} />
            </IconButton>
            <IconButton
              active={state.tool === 'eyedropper'}
              label="取色"
              onClick={() => dispatch({ type: 'set-tool', tool: 'eyedropper' })}
            >
              <Pipette size={18} />
            </IconButton>
          </div>

          <div className="toolbar-group" role="group" aria-label="历史">
            <IconButton
              disabled={!canUndo}
              label="撤销"
              onClick={() => dispatch({ type: 'undo' })}
            >
              <Undo2 size={18} />
            </IconButton>
            <IconButton
              disabled={!canRedo}
              label="重做"
              onClick={() => dispatch({ type: 'redo' })}
            >
              <Redo2 size={18} />
            </IconButton>
          </div>

          <div className="toolbar-group" role="group" aria-label="显示">
            <IconButton
              active={state.showGrid}
              label="网格"
              onClick={() => dispatch({ type: 'toggle-grid' })}
            >
              <Grid3X3 size={18} />
            </IconButton>
            <IconButton
              disabled={state.zoom === ZOOM_LEVELS[0]}
              label="缩小"
              onClick={() =>
                dispatch({ type: 'set-zoom', zoom: stepZoom(state.zoom, -1) })
              }
            >
              <ZoomOut size={18} />
            </IconButton>
            <IconButton
              disabled={state.zoom === ZOOM_LEVELS.at(-1)}
              label="放大"
              onClick={() =>
                dispatch({ type: 'set-zoom', zoom: stepZoom(state.zoom, 1) })
              }
            >
              <ZoomIn size={18} />
            </IconButton>
          </div>
        </div>

        <button className="export-button" type="button" onClick={downloadPng}>
          <Download size={18} />
          PNG
        </button>
      </header>

      <main className="workspace">
        <section className="canvas-stage" aria-label="像素画布">
          <div className="canvas-scroll">
            <div
              className="canvas-frame"
              style={{ width: canvasWidth, height: canvasHeight }}
            >
              <canvas
                ref={canvasRef}
                width={canvasWidth}
                height={canvasHeight}
                className={`pixel-canvas pixel-canvas-${state.tool}`}
                onPointerCancel={finishStroke}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishStroke}
              />
            </div>
          </div>
        </section>

        <aside className="side-panel">
          <section className="control-section">
            <div className="section-heading">颜色</div>
            <div className="color-control">
              <input
                aria-label="当前颜色"
                className="color-input"
                type="color"
                value={state.color}
                onChange={(event) =>
                  dispatch({ type: 'set-color', color: event.target.value })
                }
              />
              <div className="color-readout">
                <span className="color-preview" style={currentColorPreview} />
                <span>{state.color.toUpperCase()}</span>
              </div>
            </div>
            <div className="swatch-grid" aria-label="调色板">
              {PALETTE.map((color) => (
                <button
                  aria-label={color}
                  className={`swatch ${state.color === color ? 'active' : ''}`}
                  key={color}
                  style={{ backgroundColor: color }}
                  title={color}
                  type="button"
                  onClick={() => dispatch({ type: 'set-color', color })}
                />
              ))}
            </div>
          </section>

          <section className="control-section">
            <div className="section-heading">画布</div>
            <SegmentedControl
              ariaLabel="新建画布尺寸"
              options={CANVAS_SIZES.map((size) => ({
                label: `${size}`,
                active: activeSize === size,
                onClick: () => dispatch({ type: 'new-document', size }),
              }))}
            />
            <div className="inline-actions">
              <button
                className="utility-button"
                type="button"
                onClick={() => dispatch({ type: 'new-document', size: 32 })}
              >
                <FilePlus2 size={17} />
                32x32
              </button>
              <button
                className="utility-button"
                type="button"
                onClick={() => dispatch({ type: 'clear-document' })}
              >
                <Trash2 size={17} />
                清空
              </button>
            </div>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleImportImage}
            />
            <SegmentedControl
              ariaLabel="导入图片方式"
              options={[
                {
                  label: '适配当前',
                  active: state.importMode === 'fit',
                  onClick: () =>
                    dispatch({ type: 'set-import-mode', importMode: 'fit' }),
                },
                {
                  label: '原图上限256',
                  active: state.importMode === 'original',
                  onClick: () =>
                    dispatch({
                      type: 'set-import-mode',
                      importMode: 'original',
                    }),
                },
              ]}
            />
            <button
              className="wide-action secondary-action"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={18} />
              导入图片
            </button>
            {state.importError ? (
              <div className="import-error" role="alert">
                {state.importError}
              </div>
            ) : null}
          </section>

          <section className="control-section">
            <div className="section-heading">缩放</div>
            <SegmentedControl
              ariaLabel="画布缩放"
              options={ZOOM_LEVELS.map((zoom) => ({
                label: `${zoom}x`,
                active: state.zoom === zoom,
                onClick: () => dispatch({ type: 'set-zoom', zoom }),
              }))}
            />
          </section>

          <section className="control-section">
            <div className="section-heading">导出</div>
            <SegmentedControl
              ariaLabel="导出倍率"
              options={EXPORT_SCALES.map((exportScale) => ({
                label: `${exportScale}x`,
                active: state.exportScale === exportScale,
                onClick: () =>
                  dispatch({ type: 'set-export-scale', exportScale }),
              }))}
            />
            <button className="wide-action" type="button" onClick={downloadPng}>
              <Download size={18} />
              导出 PNG
            </button>
          </section>

          <section className="control-section stats-section">
            <div>
              <span className="stat-label">尺寸</span>
              <strong>
                {document.width} x {document.height}
              </strong>
            </div>
            <div>
              <span className="stat-label">历史</span>
              <strong>{state.history.past.length}</strong>
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

type IconButtonProps = {
  active?: boolean
  disabled?: boolean
  label: string
  children: ReactNode
  onClick: () => void
}

function IconButton({
  active = false,
  disabled = false,
  label,
  children,
  onClick,
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`icon-button ${active ? 'active' : ''}`}
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

type SegmentedOption = {
  label: string
  active: boolean
  onClick: () => void
}

function SegmentedControl({
  ariaLabel,
  options,
}: {
  ariaLabel: string
  options: SegmentedOption[]
}) {
  return (
    <div className="segmented-control" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          className={option.active ? 'active' : ''}
          key={option.label}
          type="button"
          onClick={option.onClick}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function paintPixel(
  document: PixelDocument,
  point: PixelPoint,
  tool: Exclude<Tool, 'eyedropper'>,
  color: string,
) {
  if (tool === 'eraser') {
    erasePixel(document, point.x, point.y)
    return
  }

  setPixel(document, point.x, point.y, parseHexColor(color))
}

function getCanvasPoint(
  event: PointerEvent<HTMLCanvasElement>,
  document: PixelDocument,
): PixelPoint | null {
  const rect = event.currentTarget.getBoundingClientRect()
  const xRatio = (event.clientX - rect.left) / rect.width
  const yRatio = (event.clientY - rect.top) / rect.height

  if (xRatio < 0 || yRatio < 0 || xRatio > 1 || yRatio > 1) {
    return null
  }

  return {
    x: Math.min(document.width - 1, Math.floor(xRatio * document.width)),
    y: Math.min(document.height - 1, Math.floor(yRatio * document.height)),
  }
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  zoom: number,
) {
  context.save()
  context.strokeStyle = 'rgba(17, 24, 39, 0.22)'
  context.lineWidth = 1

  for (let x = 0; x <= width; x += 1) {
    const offset = x * zoom + 0.5
    context.beginPath()
    context.moveTo(offset, 0)
    context.lineTo(offset, height * zoom)
    context.stroke()
  }

  for (let y = 0; y <= height; y += 1) {
    const offset = y * zoom + 0.5
    context.beginPath()
    context.moveTo(0, offset)
    context.lineTo(width * zoom, offset)
    context.stroke()
  }

  context.restore()
}

function stepZoom(
  currentZoom: (typeof ZOOM_LEVELS)[number],
  direction: -1 | 1,
): (typeof ZOOM_LEVELS)[number] {
  const index = ZOOM_LEVELS.indexOf(currentZoom)
  const nextIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction))

  return ZOOM_LEVELS[nextIndex]
}

function limitHistory(history: PixelDocument[]) {
  return history.slice(-MAX_HISTORY)
}

function documentsEqual(first: PixelDocument, second: PixelDocument) {
  if (first.width !== second.width || first.height !== second.height) {
    return false
  }

  if (first.pixels.length !== second.pixels.length) {
    return false
  }

  return first.pixels.every((value, index) => value === second.pixels[index])
}

export default App

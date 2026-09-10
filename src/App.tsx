import {
  Download,
  Eraser,
  FilePlus2,
  Grid3X3,
  ImageOff,
  ImagePlus,
  Move,
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
import { CANVAS_SIZES, ZOOM_LEVELS, EXPORT_SCALES, createInitialState, editorReducer } from './editor'
import {
  cloneDocument,
  documentToImageData,
  drawLine,
  erasePixel,
  exportPng,
  getFrameSize,
  getVisibleColor,
  importImageFile,
  parseHexColor,
  rgbaToHex,
  setPixel,
} from './pixels'
import type { PixelDocument, PixelOffset, PixelPoint, Tool } from './pixels'

const PRIMARY_POINTER_BUTTON = 0
const SECONDARY_POINTER_BUTTON = 2
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

type StrokeState = {
  pointerId: number
  base: PixelDocument
  draft: PixelDocument
  lastPoint: PixelPoint
  tool: PaintTool
  color: string
}

type PaintTool = 'pencil' | 'eraser'

type MoveState = {
  pointerId: number
  startClientX: number
  startClientY: number
  startOffset: PixelOffset
}

function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialState)
  const editorCanvasRef = useRef<HTMLCanvasElement>(null)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backgroundFileInputRef = useRef<HTMLInputElement>(null)
  const stateRef = useRef(state)
  const strokeRef = useRef<StrokeState | null>(null)
  const moveRef = useRef<MoveState | null>(null)

  const document = state.history.present
  const background = state.background
  const frameSize = getFrameSize(document, background)
  const frameWidth = frameSize.width * state.zoom
  const frameHeight = frameSize.height * state.zoom
  const backgroundWidth = (background?.width ?? 0) * state.zoom
  const backgroundHeight = (background?.height ?? 0) * state.zoom
  const canvasWidth = document.width * state.zoom
  const canvasHeight = document.height * state.zoom
  const editorLeft = background ? state.editorOffset.x * state.zoom : 0
  const editorTop = background ? state.editorOffset.y * state.zoom : 0
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
    const canvas = editorCanvasRef.current

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
    const canvas = backgroundCanvasRef.current

    if (!canvas || !background) {
      return
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, canvas.width, canvas.height)

    const source = window.document.createElement('canvas')
    source.width = background.width
    source.height = background.height
    source.getContext('2d')?.putImageData(documentToImageData(background), 0, 0)

    context.drawImage(source, 0, 0, canvas.width, canvas.height)
  }, [background, backgroundHeight, backgroundWidth])

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
    const isPrimaryButton = event.button === PRIMARY_POINTER_BUTTON
    const isSecondaryButton = event.button === SECONDARY_POINTER_BUTTON

    if (!isPrimaryButton && !isSecondaryButton) {
      return
    }

    event.preventDefault()

    const point = getCanvasPoint(event, stateRef.current.history.present)

    if (!point) {
      return
    }

    const currentState = stateRef.current

    if (
      isPrimaryButton &&
      currentState.tool === 'move' &&
      currentState.background
    ) {
      event.currentTarget.setPointerCapture(event.pointerId)
      moveRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffset: currentState.editorOffset,
      }
      return
    }

    if (isPrimaryButton && currentState.tool === 'eyedropper') {
      const color = getVisibleColor(
        currentState.history.present,
        currentState.background,
        currentState.editorOffset,
        point,
      )

      if (color && color.a > 0) {
        dispatch({ type: 'set-color', color: rgbaToHex(color) })
      }

      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)

    const base = cloneDocument(currentState.history.present)
    const draft = cloneDocument(base)
    const strokeTool: PaintTool =
      isSecondaryButton ||
      currentState.tool === 'eyedropper' ||
      currentState.tool === 'move'
        ? 'eraser'
        : currentState.tool

    paintPixel(draft, point, strokeTool, currentState.color)
    strokeRef.current = {
      pointerId: event.pointerId,
      base,
      draft,
      lastPoint: point,
      tool: strokeTool,
      color: currentState.color,
    }

    dispatch({ type: 'replace-present', document: cloneDocument(draft) })
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const move = moveRef.current

    if (move && move.pointerId === event.pointerId) {
      const currentState = stateRef.current

      dispatch({
        type: 'set-editor-offset',
        editorOffset: {
          x:
            move.startOffset.x +
            Math.round((event.clientX - move.startClientX) / currentState.zoom),
          y:
            move.startOffset.y +
            Math.round((event.clientY - move.startClientY) / currentState.zoom),
        },
      })
      return
    }

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

  const finishMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const move = moveRef.current

    if (!move || move.pointerId !== event.pointerId) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    moveRef.current = null
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

  const finishPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    finishMove(event)
    finishStroke(event)
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

  const handleImportBackground = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      dispatch({ type: 'set-background-error', backgroundError: '请选择图片文件' })
      return
    }

    try {
      const importedBackground = await importImageFile(file)
      dispatch({ type: 'set-background', background: importedBackground })
    } catch {
      dispatch({ type: 'set-background-error', backgroundError: '背景导入失败' })
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
            <IconButton
              active={state.tool === 'move'}
              disabled={!background}
              label="移动"
              onClick={() => dispatch({ type: 'set-tool', tool: 'move' })}
            >
              <Move size={18} />
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
              className={`canvas-frame ${
                background ? 'canvas-frame-with-background' : 'canvas-frame-empty'
              }`}
              style={{ width: frameWidth, height: frameHeight }}
            >
              {background ? (
                <canvas
                  ref={backgroundCanvasRef}
                  width={backgroundWidth}
                  height={backgroundHeight}
                  className="background-canvas"
                  style={{ width: backgroundWidth, height: backgroundHeight }}
                  aria-hidden="true"
                />
              ) : null}
              <canvas
                ref={editorCanvasRef}
                width={canvasWidth}
                height={canvasHeight}
                className={`pixel-canvas pixel-canvas-${state.tool} ${
                  background ? 'pixel-canvas-floating' : ''
                }`}
                style={{
                  left: editorLeft,
                  top: editorTop,
                  width: canvasWidth,
                  height: canvasHeight,
                }}
                onContextMenu={(event) => event.preventDefault()}
                onPointerCancel={finishPointer}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointer}
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
            <div className="section-heading">背景</div>
            <input
              ref={backgroundFileInputRef}
              className="file-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleImportBackground}
            />
            <div className="inline-actions">
              <button
                className="utility-button"
                type="button"
                onClick={() => backgroundFileInputRef.current?.click()}
              >
                <ImagePlus size={17} />
                上传背景
              </button>
              <button
                className="utility-button"
                disabled={!background}
                type="button"
                onClick={() => dispatch({ type: 'clear-background' })}
              >
                <ImageOff size={17} />
                移除背景
              </button>
            </div>
            <div className="background-stats">
              <div>
                <span className="stat-label">背景</span>
                <strong>
                  {background ? `${background.width} x ${background.height}` : '无'}
                </strong>
              </div>
              <div>
                <span className="stat-label">位置</span>
                <strong>
                  {background ? `${state.editorOffset.x}, ${state.editorOffset.y}` : '0, 0'}
                </strong>
              </div>
            </div>
            {state.backgroundError ? (
              <div className="import-error" role="alert">
                {state.backgroundError}
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

export default App

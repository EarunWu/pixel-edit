import { useEffect, useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import { MAX_IMPORT_SIDE, clampCropRect, documentToImageData, isValidCropRect } from './pixels'
import type { PixelDocument, PixelRect } from './pixels'

export type CropSource =
  | { kind: 'import'; image: HTMLImageElement }
  | { kind: 'canvas'; document: PixelDocument }

type CropDialogProps = {
  source: CropSource
  initialSize: { width: number; height: number }
  onApply: (rect: PixelRect) => void
  onCancel: () => void
}

type CropDraft = Record<keyof PixelRect, string>

export default function CropDialog({ source, initialSize, onApply, onCancel }: CropDialogProps) {
  const sourceWidth = source.kind === 'import' ? source.image.naturalWidth : source.document.width
  const sourceHeight = source.kind === 'import' ? source.image.naturalHeight : source.document.height
  const maxWidth = Math.min(sourceWidth, MAX_IMPORT_SIDE)
  const maxHeight = Math.min(sourceHeight, MAX_IMPORT_SIDE)
  const [draft, setDraft] = useState<CropDraft>(() => {
    const width = Math.min(initialSize.width, maxWidth)
    const height = Math.min(initialSize.height, maxHeight)
    return {
      width: String(width),
      height: String(height),
      x: String(Math.floor((sourceWidth - width) / 2)),
      y: String(Math.floor((sourceHeight - height) / 2)),
    }
  })
  const [viewport, setViewport] = useState({ width: 480, height: 360 })
  const [applyError, setApplyError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    scaleX: number
    scaleY: number
    rect: PixelRect
  } | null>(null)
  const rect: PixelRect = {
    x: Number(draft.x), y: Number(draft.y),
    width: Number(draft.width), height: Number(draft.height),
  }
  const hasIntegers = Object.values(draft).every(value => value.trim() !== '' && Number.isInteger(Number(value)))
  const error = !hasIntegers
    ? '请输入整数像素值。'
    : rect.width < 1 || rect.width > maxWidth || rect.height < 1 || rect.height > maxHeight
      ? `宽度须为 1–${maxWidth}，高度须为 1–${maxHeight} 像素。`
      : !isValidCropRect(rect, { width: sourceWidth, height: sourceHeight })
        ? '裁剪区域不能超出图片边缘，请调整左侧或顶部位置。'
        : null
  const scale = Math.min(viewport.width / sourceWidth, viewport.height / sourceHeight, 12)
  const previewWidth = Math.max(1, Math.floor(sourceWidth * scale))
  const previewHeight = Math.max(1, Math.floor(sourceHeight * scale))

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setViewport({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    let image: CanvasImageSource
    if (source.kind === 'import') {
      image = source.image
    } else {
      const buffer = window.document.createElement('canvas')
      buffer.width = source.document.width
      buffer.height = source.document.height
      buffer.getContext('2d')?.putImageData(documentToImageData(source.document), 0, 0)
      image = buffer
    }
    context.imageSmoothingEnabled = false
    context.clearRect(0, 0, previewWidth, previewHeight)
    context.drawImage(image, 0, 0, previewWidth, previewHeight)
  }, [source, previewWidth, previewHeight])

  const updateField = (field: keyof PixelRect, value: string) => {
    setApplyError(null)
    setDraft(previous => {
      const next = { ...previous, [field]: value }
      const size = Number(value)
      if (field === 'width' && Number.isInteger(size) && size >= 1 && size <= maxWidth) {
        next.x = String(Math.max(0, Math.min(Number(previous.x), sourceWidth - size)))
      }
      if (field === 'height' && Number.isInteger(size) && size >= 1 && size <= maxHeight) {
        next.y = String(Math.max(0, Math.min(Number(previous.y), sourceHeight - size)))
      }
      return next
    })
  }

  const updatePosition = (next: PixelRect) => {
    setApplyError(null)
    setDraft(previous => ({ ...previous, x: String(next.x), y: String(next.y) }))
  }

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || error || dragRef.current) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const scaleX = bounds.width / sourceWidth
    const scaleY = bounds.height / sourceHeight
    const x = (event.clientX - bounds.left) / scaleX
    const y = (event.clientY - bounds.top) / scaleY
    const inside = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
    const next = inside ? rect : clampCropRect({
      ...rect, x: x - rect.width / 2, y: y - rect.height / 2,
    }, { width: sourceWidth, height: sourceHeight })
    updatePosition(next)
    dragRef.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      scaleX, scaleY, rect: next,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    updatePosition(clampCropRect({
      ...drag.rect,
      x: drag.rect.x + (event.clientX - drag.clientX) / drag.scaleX,
      y: drag.rect.y + (event.clientY - drag.clientY) / drag.scaleY,
    }, { width: sourceWidth, height: sourceHeight }))
  }

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const applyCrop = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (error) return
    try {
      onApply(rect)
    } catch {
      setApplyError('裁剪失败，请重试。')
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="crop-dialog"
      aria-labelledby="crop-title"
      aria-describedby="crop-description"
      onCancel={event => { event.preventDefault(); onCancel() }}
    >
      <form onSubmit={applyCrop} noValidate>
        <header className="crop-header">
          <h2 id="crop-title">{source.kind === 'import' ? '裁剪并导入' : '裁剪画布'}</h2>
          <p id="crop-description">输入目标宽高，拖动选区调整位置。原图 {sourceWidth} × {sourceHeight} px。</p>
        </header>
        <div className="crop-body">
          <div className="crop-preview-viewport" ref={viewportRef}>
            <div
              className="crop-preview-image"
              style={{ width: previewWidth, height: previewHeight }}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={finishDrag}
            >
              <canvas ref={canvasRef} width={previewWidth} height={previewHeight} aria-label="裁剪预览" />
              {!error && <div className="crop-selection" style={{
                left: rect.x / sourceWidth * previewWidth,
                top: rect.y / sourceHeight * previewHeight,
                width: rect.width / sourceWidth * previewWidth,
                height: rect.height / sourceHeight * previewHeight,
              }} />}
            </div>
          </div>
          <div className="crop-controls">
            <div className="section-heading">裁剪区域</div>
            <div className="crop-fields">
              {([
                { field: 'width', label: '宽度', min: 1, max: maxWidth },
                { field: 'height', label: '高度', min: 1, max: maxHeight },
                { field: 'x', label: '左侧', min: 0, max: Math.max(0, sourceWidth - rect.width) },
                { field: 'y', label: '顶部', min: 0, max: Math.max(0, sourceHeight - rect.height) },
              ] as const).map(({ field, label, min, max }) => (
                <label className="crop-field" key={field}>
                  {label} (px)
                  <input
                    type="number" inputMode="numeric" min={min} max={max} step={1}
                    value={draft[field]} required
                    onChange={event => updateField(field, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <p className="control-hint">保留选区内的原始像素和透明度。裁剪尺寸最大 {MAX_IMPORT_SIDE} × {MAX_IMPORT_SIDE} px。</p>
            {!error && <div className="crop-size" aria-live="polite">{rect.width} × {rect.height} px</div>}
            {(error || applyError) && <div className="import-error" role="alert">{error || applyError}</div>}
          </div>
        </div>
        <footer className="crop-footer">
          <button className="utility-button" type="button" onClick={onCancel}>取消</button>
          <button className="wide-action" type="submit" disabled={Boolean(error)}>
            {source.kind === 'import' ? '裁剪并导入' : '应用裁剪'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}

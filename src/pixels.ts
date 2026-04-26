export type Tool = 'pencil' | 'eraser' | 'eyedropper'

export type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

export type PixelDocument = {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

export type HistoryState = {
  past: PixelDocument[]
  present: PixelDocument
  future: PixelDocument[]
}

export type PixelPoint = {
  x: number
  y: number
}

export const MAX_HISTORY = 50
export const MAX_IMPORT_SIDE = 256

export function createDocument(width: number, height: number): PixelDocument {
  return {
    width,
    height,
    pixels: new Uint8ClampedArray(width * height * 4),
  }
}

export function cloneDocument(document: PixelDocument): PixelDocument {
  return {
    width: document.width,
    height: document.height,
    pixels: new Uint8ClampedArray(document.pixels),
  }
}

export function clearDocument(document: PixelDocument): PixelDocument {
  return createDocument(document.width, document.height)
}

export function parseHexColor(hex: string): RgbaColor {
  const value = hex.replace('#', '')
  const normalized =
    value.length === 3
      ? value
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : value.padEnd(6, '0').slice(0, 6)

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    a: 255,
  }
}

export function rgbaToHex(color: RgbaColor): string {
  const channelToHex = (channel: number) =>
    Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')

  return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(
    color.b,
  )}`
}

export function getPixel(
  document: PixelDocument,
  x: number,
  y: number,
): RgbaColor | null {
  if (!isInsideDocument(document, x, y)) {
    return null
  }

  const index = pixelIndex(document, x, y)
  return {
    r: document.pixels[index],
    g: document.pixels[index + 1],
    b: document.pixels[index + 2],
    a: document.pixels[index + 3],
  }
}

export function setPixel(
  document: PixelDocument,
  x: number,
  y: number,
  color: RgbaColor,
): void {
  if (!isInsideDocument(document, x, y)) {
    return
  }

  const index = pixelIndex(document, x, y)
  document.pixels[index] = color.r
  document.pixels[index + 1] = color.g
  document.pixels[index + 2] = color.b
  document.pixels[index + 3] = color.a
}

export function erasePixel(
  document: PixelDocument,
  x: number,
  y: number,
): void {
  setPixel(document, x, y, { r: 0, g: 0, b: 0, a: 0 })
}

export function drawLine(
  document: PixelDocument,
  from: PixelPoint,
  to: PixelPoint,
  paint: (x: number, y: number) => void,
): void {
  let x0 = from.x
  let y0 = from.y
  const x1 = to.x
  const y1 = to.y
  const dx = Math.abs(x1 - x0)
  const sx = x0 < x1 ? 1 : -1
  const dy = -Math.abs(y1 - y0)
  const sy = y0 < y1 ? 1 : -1
  let error = dx + dy

  while (true) {
    if (isInsideDocument(document, x0, y0)) {
      paint(x0, y0)
    }

    if (x0 === x1 && y0 === y1) {
      break
    }

    const doubledError = error * 2
    if (doubledError >= dy) {
      error += dy
      x0 += sx
    }
    if (doubledError <= dx) {
      error += dx
      y0 += sy
    }
  }
}

export function documentToImageData(document: PixelDocument): ImageData {
  return new ImageData(
    new Uint8ClampedArray(document.pixels),
    document.width,
    document.height,
  )
}

export function exportPng(
  document: PixelDocument,
  scale: number,
): string {
  const source = window.document.createElement('canvas')
  source.width = document.width
  source.height = document.height
  source.getContext('2d')?.putImageData(documentToImageData(document), 0, 0)

  const output = window.document.createElement('canvas')
  output.width = document.width * scale
  output.height = document.height * scale
  const context = output.getContext('2d')

  if (!context) {
    return ''
  }

  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, output.width, output.height)
  context.drawImage(source, 0, 0, output.width, output.height)

  return output.toDataURL('image/png')
}

export function imageDataToDocument(imageData: ImageData): PixelDocument {
  return {
    width: imageData.width,
    height: imageData.height,
    pixels: new Uint8ClampedArray(imageData.data),
  }
}

export async function importImageFile(
  file: File,
  targetSize?: { width: number; height: number },
): Promise<PixelDocument> {
  const image = await loadImage(file)
  const size = targetSize ?? fitWithinMaxSide(image.naturalWidth, image.naturalHeight)
  const canvas = window.document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height

  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    throw new Error('无法读取图片像素')
  }

  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, size.width, size.height)
  context.drawImage(image, 0, 0, size.width, size.height)

  return imageDataToDocument(context.getImageData(0, 0, size.width, size.height))
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    image.src = url
  })
}

function fitWithinMaxSide(width: number, height: number) {
  if (width <= MAX_IMPORT_SIDE && height <= MAX_IMPORT_SIDE) {
    return { width, height }
  }

  const ratio = Math.min(MAX_IMPORT_SIDE / width, MAX_IMPORT_SIDE / height)

  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

function pixelIndex(document: PixelDocument, x: number, y: number): number {
  return (y * document.width + x) * 4
}

function isInsideDocument(
  document: PixelDocument,
  x: number,
  y: number,
): boolean {
  return x >= 0 && x < document.width && y >= 0 && y < document.height
}

import { describe, expect, test } from 'vitest'
import {
  centerOffset,
  clampOffset,
  clampCropRect,
  cloneDocument,
  createDocument,
  cropDocument,
  getFrameSize,
  getPixel,
  getVisibleColor,
  isValidCropRect,
  setPixel,
} from './pixels'

describe('background alignment helpers', () => {
  test.each([
    { editor: [32, 32], background: null, expected: { width: 32, height: 32 } },
    { editor: [32, 32], background: [16, 16], expected: { width: 32, height: 32 } },
    { editor: [32, 32], background: [64, 64], expected: { width: 64, height: 64 } },
    { editor: [32, 48], background: [64, 16], expected: { width: 64, height: 48 } },
    { editor: [64, 16], background: [32, 48], expected: { width: 64, height: 48 } },
  ])('keeps both layers inside the frame: $editor / $background', ({ editor, background, expected }) => {
    expect(getFrameSize(
      createDocument(editor[0], editor[1]),
      background ? createDocument(background[0], background[1]) : null,
    )).toEqual(expected)
  })

  test('centers an editor document inside a larger background on integer pixels', () => {
    const document = createDocument(32, 32)
    const background = createDocument(64, 48)

    expect(centerOffset(document, background)).toEqual({ x: 16, y: 8 })
  })

  test('clamps editor offset inside the background and fixes oversized axes at zero', () => {
    const document = createDocument(32, 48)
    const background = createDocument(48, 32)

    expect(clampOffset({ x: -8, y: 10 }, document, background)).toEqual({
      x: 0,
      y: 0,
    })
    expect(clampOffset({ x: 99, y: 10 }, document, background)).toEqual({
      x: 16,
      y: 0,
    })
  })

  test('reads visible color from the editor first, then from aligned background', () => {
    const document = createDocument(2, 2)
    const background = createDocument(4, 4)

    setPixel(background, 2, 1, { r: 10, g: 20, b: 30, a: 255 })
    expect(getVisibleColor(document, background, { x: 1, y: 1 }, { x: 1, y: 0 })).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 255,
    })

    setPixel(document, 1, 0, { r: 200, g: 100, b: 50, a: 255 })
    expect(getVisibleColor(document, background, { x: 1, y: 1 }, { x: 1, y: 0 })).toEqual({
      r: 200,
      g: 100,
      b: 50,
      a: 255,
    })
  })
})

describe('pixel cropping', () => {
  test('copies the exact selected rows, including transparency, without changing the source', () => {
    const source = createDocument(5, 4)
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        setPixel(source, x, y, { r: x * 10, g: y * 20, b: x + y, a: (x + y) % 2 ? 128 : 0 })
      }
    }
    const before = cloneDocument(source)
    const cropped = cropDocument(source, { x: 2, y: 1, width: 3, height: 2 })
    expect([cropped.width, cropped.height]).toEqual([3, 2])
    for (let y = 0; y < cropped.height; y += 1) {
      for (let x = 0; x < cropped.width; x += 1) {
        expect(getPixel(cropped, x, y)).toEqual(getPixel(before, x + 2, y + 1))
      }
    }
    cropped.pixels.fill(255)
    expect(source).toEqual(before)
  })

  test('can select a single pixel at the bottom-right edge', () => {
    const source = createDocument(3, 4)
    setPixel(source, 2, 3, { r: 20, g: 40, b: 60, a: 255 })
    const cropped = cropDocument(source, { x: 2, y: 3, width: 1, height: 1 })
    expect([cropped.width, cropped.height]).toEqual([1, 1])
    expect(getPixel(cropped, 0, 0)).toEqual({ r: 20, g: 40, b: 60, a: 255 })
  })

  test.each([
    { x: -1, y: 0, width: 2, height: 2 },
    { x: 0, y: 0, width: 0, height: 2 },
    { x: 0, y: 0, width: 2, height: -1 },
    { x: 3, y: 0, width: 2, height: 2 },
    { x: 0, y: 3, width: 2, height: 2 },
    { x: 0.5, y: 0, width: 2, height: 2 },
    { x: 0, y: 0, width: 1.5, height: 2 },
    { x: 0, y: 0, width: Number.NaN, height: 2 },
  ])('rejects invalid crop regions: %j', (rect) => {
    const source = createDocument(4, 4)
    expect(isValidCropRect(rect, source)).toBe(false)
    expect(() => cropDocument(source, rect)).toThrow()
  })

  test('keeps a dragged selection on integer pixels inside the image', () => {
    const source = { width: 64, height: 48 }
    expect(clampCropRect({ x: -10, y: 80, width: 20, height: 10 }, source))
      .toEqual({ x: 0, y: 38, width: 20, height: 10 })
    expect(clampCropRect({ x: 3.6, y: 5.2, width: 20, height: 10 }, source))
      .toEqual({ x: 4, y: 5, width: 20, height: 10 })
  })
})

import { describe, expect, test } from 'vitest'
import {
  centerOffset,
  clampOffset,
  createDocument,
  getFrameSize,
  getVisibleColor,
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

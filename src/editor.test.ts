import { describe, expect, test } from 'vitest'
import { createInitialState, editorReducer } from './editor'
import { cloneDocument, createDocument, getPixel, setPixel } from './pixels'

function createEditorWithBackground() {
  return editorReducer(createInitialState(), {
    type: 'set-background',
    background: createDocument(64, 64),
  })
}

describe('background alignment history', () => {
  test.each([{ x: 16, y: 16 }, { x: 3, y: 23 }])(
    'restores the document and offset after undoing and redoing an import: %j',
    (originalOffset) => {
      let state = editorReducer(createEditorWithBackground(), {
        type: 'set-editor-offset',
        editorOffset: originalOffset,
      })
      const original = state.history.present
      const imported = createDocument(48, 48)

      state = editorReducer(state, { type: 'import-document', document: imported })
      expect(state.editorOffset).toEqual({ x: 8, y: 8 })

      state = editorReducer(state, { type: 'undo' })
      expect(state.history.present).toEqual(original)
      expect(state.editorOffset).toEqual(originalOffset)

      state = editorReducer(state, { type: 'redo' })
      expect(state.history.present).toEqual(imported)
      expect(state.editorOffset).toEqual({ x: 8, y: 8 })

      state = editorReducer(state, { type: 'undo' })
      expect(state.editorOffset).toEqual(originalOffset)
    },
  )

  test('restores a custom offset when an import keeps the same dimensions', () => {
    let state = editorReducer(createEditorWithBackground(), {
      type: 'set-editor-offset',
      editorOffset: { x: 3, y: 5 },
    })
    const imported = createDocument(32, 32)
    setPixel(imported, 0, 0, { r: 255, g: 0, b: 0, a: 255 })

    state = editorReducer(state, { type: 'import-document', document: imported })
    expect(state.editorOffset).toEqual({ x: 16, y: 16 })
    state = editorReducer(state, { type: 'undo' })
    expect(state.editorOffset).toEqual({ x: 3, y: 5 })
    state = editorReducer(state, { type: 'redo' })
    expect(state.editorOffset).toEqual({ x: 16, y: 16 })
  })

  test.each(['paint', 'clear'])('preserves later moves when undoing a %s action', (action) => {
    let state = createEditorWithBackground()
    const painted = createDocument(32, 32)
    setPixel(painted, 0, 0, { r: 255, g: 0, b: 0, a: 255 })

    if (action === 'clear') {
      state = editorReducer(state, { type: 'import-document', document: painted })
    }

    const before = cloneDocument(state.history.present)
    state = action === 'paint'
      ? editorReducer(state, { type: 'commit-stroke', before, document: painted })
      : editorReducer(state, { type: 'clear-document' })
    const after = cloneDocument(state.history.present)
    state = editorReducer(state, {
      type: 'set-editor-offset',
      editorOffset: { x: 2, y: 3 },
    })

    state = editorReducer(state, { type: 'undo' })
    expect(state.history.present).toEqual(before)
    expect(state.editorOffset).toEqual({ x: 2, y: 3 })
    state = editorReducer(state, { type: 'redo' })
    expect(state.history.present).toEqual(after)
    expect(state.editorOffset).toEqual({ x: 2, y: 3 })
  })

  test('clamps restored positions to the current background after replacement', () => {
    let state = editorReducer(createEditorWithBackground(), {
      type: 'set-editor-offset',
      editorOffset: { x: 24, y: 20 },
    })
    state = editorReducer(state, { type: 'import-document', document: createDocument(48, 48) })
    state = editorReducer(state, { type: 'set-background', background: createDocument(40, 40) })

    state = editorReducer(state, { type: 'undo' })
    expect(state.history.present.width).toBe(32)
    expect(state.editorOffset).toEqual({ x: 8, y: 8 })
    state = editorReducer(state, { type: 'redo' })
    expect(state.history.present.width).toBe(48)
    expect(state.editorOffset).toEqual({ x: 0, y: 0 })
  })

  test('keeps the canvas at the origin after removing the background', () => {
    let state = createEditorWithBackground()
    state = editorReducer(state, { type: 'import-document', document: createDocument(48, 48) })
    state = editorReducer(state, { type: 'clear-background' })

    state = editorReducer(state, { type: 'undo' })
    expect(state.editorOffset).toEqual({ x: 0, y: 0 })
    state = editorReducer(state, { type: 'redo' })
    expect(state.editorOffset).toEqual({ x: 0, y: 0 })
  })
})

describe('crop history', () => {
  test('keeps the retained pixels aligned to the background through undo and redo', () => {
    let state = createEditorWithBackground()
    const original = createDocument(32, 32)
    setPixel(original, 7, 9, { r: 10, g: 20, b: 30, a: 128 })
    state = editorReducer(state, { type: 'import-document', document: original })
    state = editorReducer(state, { type: 'set-editor-offset', editorOffset: { x: 5, y: 6 } })
    const historyLength = state.history.past.length

    state = editorReducer(state, { type: 'crop-document', rect: { x: 7, y: 9, width: 20, height: 12 } })
    expect([state.history.present.width, state.history.present.height]).toEqual([20, 12])
    expect(getPixel(state.history.present, 0, 0)).toEqual({ r: 10, g: 20, b: 30, a: 128 })
    expect(state.editorOffset).toEqual({ x: 12, y: 15 })
    expect(state.history.past).toHaveLength(historyLength + 1)

    state = editorReducer(state, { type: 'undo' })
    expect(state.history.present).toEqual(original)
    expect(state.editorOffset).toEqual({ x: 5, y: 6 })
    state = editorReducer(state, { type: 'redo' })
    expect([state.history.present.width, state.history.present.height]).toEqual([20, 12])
    expect(state.editorOffset).toEqual({ x: 12, y: 15 })
  })

  test('starts a new history branch after cropping an undone document', () => {
    let state = editorReducer(createInitialState(), {
      type: 'import-document', document: createDocument(48, 48),
    })
    state = editorReducer(state, { type: 'undo' })
    state = editorReducer(state, { type: 'crop-document', rect: { x: 8, y: 4, width: 16, height: 24 } })
    expect(state.history.future).toHaveLength(0)
    expect(state.editorOffset).toEqual({ x: 0, y: 0 })
    expect([state.history.present.width, state.history.present.height]).toEqual([16, 24])
    state = editorReducer(state, { type: 'undo' })
    expect([state.history.present.width, state.history.present.height]).toEqual([32, 32])
  })

  test('does not add history for a full-canvas crop or an invalid rectangle', () => {
    const state = createInitialState()
    expect(editorReducer(state, { type: 'crop-document', rect: { x: 0, y: 0, width: 32, height: 32 } }))
      .toBe(state)
    expect(editorReducer(state, { type: 'crop-document', rect: { x: 20, y: 20, width: 32, height: 32 } }))
      .toBe(state)
  })
})

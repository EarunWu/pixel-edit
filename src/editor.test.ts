import { describe, expect, test } from 'vitest'
import { createInitialState, editorReducer } from './editor'
import { cloneDocument, createDocument, setPixel } from './pixels'

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

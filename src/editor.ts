import {
  MAX_HISTORY, centerOffset, clampOffset, clearDocument, createDocument,
  cropDocument, isValidCropRect,
} from './pixels'
import type { HistoryEntry, HistoryState, PixelDocument, PixelOffset, PixelRect, Tool } from './pixels'

export const CANVAS_SIZES = [16, 32, 64] as const
export const ZOOM_LEVELS = [8, 12, 16, 20, 24] as const
export const EXPORT_SCALES = [1, 2, 3, 4, 8, 16] as const

type ImportMode = 'fit' | 'original' | 'crop'

type EditorState = {
  history: HistoryState
  tool: Tool
  color: string
  zoom: (typeof ZOOM_LEVELS)[number]
  showGrid: boolean
  exportScale: (typeof EXPORT_SCALES)[number]
  importMode: ImportMode
  importError: string | null
  background: PixelDocument | null
  backgroundError: string | null
  editorOffset: PixelOffset
}

type EditorAction =
  | { type: 'set-tool'; tool: Tool }
  | { type: 'set-color'; color: string }
  | { type: 'set-zoom'; zoom: (typeof ZOOM_LEVELS)[number] }
  | { type: 'set-export-scale'; exportScale: (typeof EXPORT_SCALES)[number] }
  | { type: 'set-import-mode'; importMode: ImportMode }
  | { type: 'set-import-error'; importError: string | null }
  | { type: 'set-background-error'; backgroundError: string | null }
  | { type: 'set-background'; background: PixelDocument }
  | { type: 'clear-background' }
  | { type: 'set-editor-offset'; editorOffset: PixelOffset }
  | { type: 'toggle-grid' }
  | { type: 'new-document'; size: (typeof CANVAS_SIZES)[number] }
  | { type: 'replace-present'; document: PixelDocument }
  | { type: 'import-document'; document: PixelDocument }
  | { type: 'crop-document'; rect: PixelRect }
  | {
      type: 'commit-stroke'
      before: PixelDocument
      document: PixelDocument
    }
  | { type: 'clear-document' }
  | { type: 'undo' }
  | { type: 'redo' }

export function createInitialState(): EditorState {
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
    background: null,
    backgroundError: null,
    editorOffset: { x: 0, y: 0 },
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
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
    case 'set-background-error':
      return { ...state, backgroundError: action.backgroundError }
    case 'set-background':
      return {
        ...state,
        background: action.background,
        backgroundError: null,
        editorOffset: centerOffset(state.history.present, action.background),
      }
    case 'clear-background':
      return {
        ...state,
        tool: state.tool === 'move' ? 'pencil' : state.tool,
        background: null,
        backgroundError: null,
        editorOffset: { x: 0, y: 0 },
      }
    case 'set-editor-offset':
      return {
        ...state,
        editorOffset: clampOffset(
          action.editorOffset,
          state.history.present,
          state.background,
        ),
      }
    case 'toggle-grid':
      return { ...state, showGrid: !state.showGrid }
    case 'new-document': {
      const present = createDocument(action.size, action.size)

      return {
        ...state,
        editorOffset: centerOffset(present, state.background),
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
        editorOffset: centerOffset(action.document, state.background),
        history: {
          past: limitHistory([
            ...state.history.past,
            { document: state.history.present, editorOffset: state.editorOffset },
          ]),
          present: action.document,
          future: [],
        },
      }
    case 'crop-document': {
      if (!isValidCropRect(action.rect, state.history.present)) {
        return state
      }
      const cropped = cropDocument(state.history.present, action.rect)
      if (documentsEqual(state.history.present, cropped)) {
        return state
      }
      return {
        ...state,
        editorOffset: clampOffset({
          x: state.editorOffset.x + action.rect.x,
          y: state.editorOffset.y + action.rect.y,
        }, cropped, state.background),
        history: {
          past: limitHistory([
            ...state.history.past,
            { document: state.history.present, editorOffset: state.editorOffset },
          ]),
          present: cropped,
          future: [],
        },
      }
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
          past: limitHistory([...state.history.past, { document: action.before }]),
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
          past: limitHistory([...state.history.past, { document: state.history.present }]),
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
        editorOffset: clampOffset(
          previous.editorOffset ?? state.editorOffset,
          previous.document,
          state.background,
        ),
        history: {
          past: state.history.past.slice(0, -1),
          present: previous.document,
          future: [
            {
              document: state.history.present,
              editorOffset: previous.editorOffset ? state.editorOffset : undefined,
            },
            ...state.history.future,
          ],
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
        editorOffset: clampOffset(
          next.editorOffset ?? state.editorOffset,
          next.document,
          state.background,
        ),
        history: {
          past: limitHistory([
            ...state.history.past,
            {
              document: state.history.present,
              editorOffset: next.editorOffset ? state.editorOffset : undefined,
            },
          ]),
          present: next.document,
          future: state.history.future.slice(1),
        },
      }
    }
    default:
      return state
  }
}

function limitHistory(history: HistoryEntry[]) {
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

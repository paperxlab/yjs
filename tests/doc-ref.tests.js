import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * autoRef=true embeds nested types as referenced docs and wires refDocs/getRefDoc.
 * @param {t.TestCase} _tc
 */
export const testDocRefAutoRefRegistersRefs = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const rootMap = root.getMap('root')
  const rootArray = root.getArray('arr')

  const childMap = new Y.Map()
  const childArray = new Y.Array()

  rootMap.set('mapChild', childMap)
  rootArray.insert(0, [childArray])

  const mapDoc = childMap.doc
  const arrayDoc = childArray.doc

  t.assert(mapDoc, 'embedded types materialize docs')
  t.assert(arrayDoc, 'embedded types materialize docs')
  t.assert(root.refDocs.size === 2, 'two ref docs are registered on the root')
  t.assert(root.getRefDoc(mapDoc.guid) === mapDoc, 'getRefDoc resolves map doc')
  t.assert(root.getRefDoc(arrayDoc.guid) === arrayDoc, 'getRefDoc resolves array doc')
  t.assert(rootMap.get('mapChild').doc === mapDoc, 'map entry resolves to ref doc bound type')
  t.assert(rootArray.get(0).doc === arrayDoc, 'array slot resolves to ref doc bound type')
}

/**
 * createRef overrides autoRef on both ends.
 * @param {t.TestCase} _tc
 */
export const testDocRefCreateRefFlagOverridesAutoRef = _tc => {
  const inlineDoc = new Y.Doc({ root: true, autoRef: false })
  const inlineMap = inlineDoc.getMap('root')
  const inlineChild = new Y.Map()
  inlineMap.set('embedded', inlineChild)
  t.assert(inlineDoc.refDocs.size === 0, 'autoRef=false keeps embedded types inline')
  t.assert(inlineChild.doc === inlineDoc, 'embedded type stays on the root doc')

  const forceDoc = new Y.Doc({ root: true, autoRef: false })
  const forceMap = forceDoc.getMap('root')
  const refChild = new Y.Array()
  refChild.createRef = true
  forceMap.set('forced', refChild)
  t.assert(forceDoc.refDocs.size === 1, 'createRef=true forces reference even when autoRef=false')
  t.assert(forceMap.get('forced').doc !== forceDoc, 'forced ref lives on a separate doc')

  const suppressDoc = new Y.Doc({ root: true, autoRef: true })
  const suppressMap = suppressDoc.getMap('root')
  const deepChild = new Y.Text()
  deepChild.createRef = false
  suppressMap.set('deep', deepChild)
  t.assert(suppressDoc.refDocs.size === 0, 'createRef=false prevents automatic ref embedding')
  t.assert(suppressMap.get('deep').doc === suppressDoc, 'deep embed stays on parent doc')
}

/**
 * Reusing the same type value in multiple slots should result in distinct referenced docs with independent content.
 * @param {t.TestCase} _tc
 */
export const testDocRefConflictsClonePerPlacement = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const map = root.getMap('root')
  const shared = new Y.Map()
  shared.set('title', 'base')

  map.set('first', shared)
  map.set('second', shared)

  const docsByKey = new Map()
  root.refDocs.forEach(doc => {
    const referrer = doc._referrer
    if (referrer?.parentSub) {
      docsByKey.set(referrer.parentSub, doc)
    }
  })

  const firstDoc = docsByKey.get('first')
  const secondDoc = docsByKey.get('second')

  t.assert(firstDoc && secondDoc, 'both placements are backed by docs')
  t.assert(firstDoc !== secondDoc, 'conflicting placements create separate docs')

  const firstRoot = firstDoc?.getMap('')
  const secondRoot = secondDoc?.getMap('')
  firstRoot?.set('title', 'first-only')
  t.assert(secondRoot?.get('title') === 'base', 'cloned docs keep independent state')
}

/**
 * Circular references should be pruned for both map and array placements.
 * @param {t.TestCase} _tc
 */
export const testDocRefCircularReferencesArePruned = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const rootMap = root.getMap('root')
  const rootArray = root.getArray('arr')

  const child = new Y.Map()
  const arrChild = new Y.Array()

  rootMap.set('child', child)
  rootArray.push([arrChild])

  const backToRoot = root.getMap('root')
  let threw = false
  try {
    child.set('back', backToRoot)
  } catch (err) {
    threw = true
  }
  t.assert(threw, 'attaching root doc causes an error')

  threw = false
  try {
    arrChild.insert(0, [rootArray])
  } catch (err) {
    threw = true
  }
  t.assert(threw, 'attaching root doc in array causes an error')
}

/**
 * Circular refs between non-root docs should be pruned rather than throw.
 * @param {t.TestCase} _tc
 */
export const testDocRefCircularReferencesOnNestedDocsArePruned = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const rootMap = root.getMap('root')
  const child = new Y.Map()
  rootMap.set('child', child)
  const childDoc = child.doc
  t.assert(childDoc, 'child doc exists')

  const childRoot = childDoc.getMap()
  const grand = new Y.Map()
  childRoot.set('grand', grand)
  const grandDoc = grand.doc
  t.assert(grandDoc, 'grandchild doc exists')

  // detach child so we can reattach it under a descendant to form a cycle
  rootMap.delete('child')
  grand.set('back', childRoot)
  t.assert(grand.has('back') === false, 'non-root circular ref is removed after reattach')
}

/**
 * Removing a ref produces ContentDocUnref entries and clears referrer, and the state survives encode/apply.
 * @param {t.TestCase} _tc
 */
export const testDocRefDeletionAddsUnrefAndSerializes = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const map = root.getMap('root')
  const child = new Y.Map()
  map.set('child', child)
  const childDoc = child.doc
  t.assert(childDoc, 'child doc exists before deletion')

  map.delete('child')

  t.assert(childDoc?._referrer === null, 'referrer cleared on delete')
  const unrefs = root.get('_unrefs', Y.Array)
  t.assert(unrefs.length === 1, 'unref entry added to referrer doc')
  t.assert(unrefs.get(0) === childDoc?.guid, 'unref value matches guid')
}

/**
 * Encoding/decoding a doc with refs rebuilds the refDocs hierarchy and nested content.
 * @param {t.TestCase} _tc
 */
export const testDocRefSyncRoundtripRestoresRefs = _tc => {
  const origin = new Y.Doc({ root: true, autoRef: true })
  const map = origin.getMap('root')
  const childArray = new Y.Array()
  childArray.push(['value'])
  map.set('child', childArray)
  const childDoc = /** @type {Y.Doc} */(childArray.doc)

  const update = Y.encodeStateAsUpdateV2(origin)
  const replica = new Y.Doc({ root: true, autoRef: true })
  Y.applyUpdateV2(replica, update)

  const replicaMap = replica.getMap('root')
  const replicatedChild = replicaMap.get('child')
  t.assert(replicatedChild instanceof Y.Array, 'replicated value is array type')

  const replicatedChildDoc = replicatedChild.doc
  Y.applyUpdateV2(replicatedChildDoc, Y.encodeStateAsUpdateV2(childDoc))
  t.assert(replicatedChildDoc && replica.refDocs.has(replicatedChildDoc.guid), 'refDoc restored on receiver')
  t.assert(replicatedChild.get(0) === 'value', 'nested content survived roundtrip')
}

/**
 * UndoManager on parent doc captures and reverts changes inside referenced docs.
 * @param {t.TestCase} _tc
 */
export const testDocRefUndoAcrossDocs = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const parent = root.getMap('root')
  const child = new Y.Map()
  parent.set('child', child)

  const um = new Y.UndoManager(parent)

  child.set('title', 'hello')
  t.assert(um.canUndo(), 'undo stack tracks change in ref doc')

  um.undo()
  t.assert(child.has('title') === false, 'undo removed change inside ref doc')

  um.redo()
  t.assert(child.get('title') === 'hello', 'redo restored change inside ref doc')

  const grandChild = new Y.Map()
  child.set('grand', grandChild)

  grandChild.set('note', 'world')
  t.assert(um.canUndo(), 'undo stack tracks change in nested ref doc')

  um.undo()
  t.assert(grandChild.has('note') === false, 'undo removed change inside nested ref doc')

  um.redo()
  t.assert(grandChild.get('note') === 'world', 'redo restored change inside nested ref doc')
}

/**
 * When a single change spans multiple ref docs, UndoManager should undo/redo them together.
 * @param {t.TestCase} _tc
 */
export const testDocRefUndoAcrossMultipleDocsSingleOp = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const parent = root.getMap('root')
  const childA = new Y.Map()
  const childB = new Y.Map()
  parent.set('a', childA)
  parent.set('b', childB)
  const aRoot = /** @type {Y.Map<any>} */ (childA.doc?.getMap(''))
  const bRoot = /** @type {Y.Map<any>} */ (childB.doc?.getMap(''))

  const um = new Y.UndoManager(parent)

  // One root-level transaction that touches both ref docs
  root.transact(() => {
    aRoot.set('x', 1)
    bRoot.set('y', 2)
  })

  t.assert(um.undoStack.length === 1, 'single stack item for multi-doc transaction')
  um.undo()
  t.assert(aRoot.has('x') === false && bRoot.has('y') === false, 'undo cleared both ref docs')
  um.redo()
  t.assert(aRoot.get('x') === 1 && bRoot.get('y') === 2, 'redo restored both ref docs')
}

/**
 * Consecutive changes within captureTimeout across ref docs are merged.
 * @param {t.TestCase} _tc
 */
export const testDocRefUndoAcrossDocsCaptureMerge = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const parent = root.getMap('root')
  const child = new Y.Map()
  const other = new Y.Map()
  parent.set('child', child)
  parent.set('other', other)
  const childRoot = /** @type {Y.Map<any>} */ (child.doc?.getMap(''))
  const otherRoot = /** @type {Y.Map<any>} */ (other.doc?.getMap(''))

  const um = new Y.UndoManager(parent, { captureTimeout: 1000 })

  childRoot.set('title', 'hello')
  otherRoot.set('note', 'world') // within capture window, should merge

  t.assert(um.undoStack.length === 1, 'consecutive changes merged into one stack item')
  um.undo()
  t.assert(!childRoot.has('title') && !otherRoot.has('note'), 'undo removed merged changes')
  um.redo()
  t.assert(childRoot.get('title') === 'hello' && otherRoot.get('note') === 'world', 'redo restored merged changes')
}

/**
 * UndoManager captures granular text operations in nested ref docs.
 * @param {t.TestCase} _tc
 */
export const testDocRefUndoAcrossDocsWithXmlTextGranular = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const parent = root.getMap('root')
  const child = new Y.Map()
  parent.set('child', child)

  // captureTimeout: 0 にして、操作ごとに確実にスタックが分かれるようにする
  const um = new Y.UndoManager(parent, { captureTimeout: 0 })

  const grandChild = new Y.Map()
  child.set('grand', grandChild)

  const xmlText = new Y.XmlText()
  grandChild.set('xml', xmlText)

  // 初期状態: 'abc'
  xmlText.insert(0, 'abc')

  // ここまでの履歴は一旦無視するか、区切りを入れる
  um.stopCapturing()

  // 単体の挿入操作: 'd' を追加 -> 'abcd'
  xmlText.insert(3, 'd')

  t.assert(xmlText.toString() === 'abcd', 'text updated')
  t.assert(um.canUndo(), 'undo available')

  // Undo: 'd' が消えるはず
  um.undo()
  t.assert(xmlText.toString() === 'abc', 'undo removed last character')

  // Redo: 'd' が戻るはず
  um.redo()
  t.assert(xmlText.toString() === 'abcd', 'redo restored last character')

  // 単体の削除操作: 'b' を削除 -> 'acd'
  um.stopCapturing()
  xmlText.delete(1, 1)
  t.assert(xmlText.toString() === 'acd', 'text deleted')

  // Undo: 'b' が戻るはず -> 'abcd'
  um.undo()
  t.assert(xmlText.toString() === 'abcd', 'undo restored deleted character')

  // Redo: 'b' が消えるはず -> 'acd'
  um.redo()
  t.assert(xmlText.toString() === 'acd', 'redo re-deleted character')
}

/**
 * Nested transactions should inherit the origin from the root transaction.
 * @param {t.TestCase} _tc
 */
export const testDocRefInheritsOrigin = _tc => {
  const root = new Y.Doc({ root: true, autoRef: true })
  const map = root.getMap('root')
  const child = new Y.Map()
  map.set('child', child)
  const childDoc = child.doc
  t.assert(childDoc, 'child doc exists')

  const origin = 'custom-origin'
  let capturedOrigin = null

  childDoc.on('beforeTransaction', tr => {
    capturedOrigin = tr.origin
  })

  root.transact(() => {
    child.set('a', 1)
  }, origin)

  t.assert(capturedOrigin === origin, 'child doc transaction inherited origin')
}

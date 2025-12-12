
import * as Y from 'yjs'
import * as t from 'lib0/testing'

export const testPageInheritance = /** @param {t.TestCase} tc */ tc => {
  const root = new Y.Doc({ autoRef: true, root: true })
  const mapA = root.getMap('mapA')

  // Create a nested doc (mapB) inside mapA
  const mapB = new Y.Map()
  mapA.set('mapB', mapB)

  const docB = mapB.doc
  t.assert(docB !== null)
  if (docB === null) return
  t.assert(docB.page === null) // Inherited from root (null)

  // Set page on docB
  docB.setPage('page1')

  // Create a nested doc (mapC) inside mapB
  const mapC = new Y.Map()
  mapB.set('mapC', mapC)

  const docC = mapC.doc
  t.assert(docC !== null)
  if (docC === null) return

  // docC should inherit page from docB
  t.assert(docC.page === 'page1', 'docC should inherit page "page1" from docB')
}

export const testPageCloneOnMove = /** @param {t.TestCase} tc */ tc => {
  const root = new Y.Doc({ autoRef: true, root: true })

  // Setup: Page A and Page B containers
  const mapA = root.getMap('mapA')

  // Let's do it properly with autoRef
  const mapContainerA = new Y.Map()
  mapA.set('containerA', mapContainerA)
  const docRefA = mapContainerA.doc
  if (docRefA === null) {
    t.fail('docRefA is null')
    return
  }
  docRefA.setPage('pageA')

  const mapContainerB = new Y.Map()
  mapA.set('containerB', mapContainerB)
  const docRefB = mapContainerB.doc
  if (docRefB === null) {
    t.fail('docRefB is null')
    return
  }
  docRefB.setPage('pageB')

  // Create item in Page A
  const itemMap = new Y.Map()
  itemMap.set('val', 'original')
  mapContainerA.set('item', itemMap)

  const itemDoc = itemMap.doc
  if (itemDoc === null) {
    t.fail('itemDoc is null')
    return
  }
  t.assert(itemDoc.page === 'pageA', 'Item should start in Page A')
  const originalGuid = itemDoc.guid

  // Move item to Page B
  // We are moving 'itemMap' which is an AbstractType attached to itemDoc.
  // When we set it to mapContainerB, Yjs will try to integrate it.
  mapContainerB.set('item', itemMap)

  const movedItemMap = mapContainerB.get('item')
  const newItemDocRef = movedItemMap.doc

  if (newItemDocRef === null) {
    t.fail('newItemDocRef is null')
    return
  }

  t.assert(newItemDocRef.page === 'pageB', 'Item should be moved to Page B')
  t.assert(newItemDocRef.guid !== originalGuid, 'Item should be cloned (new GUID)')
  t.assert(movedItemMap.get('val') === 'original', 'Content should be preserved')

  // Check if original is still in A
  const originalItemMap = mapContainerA.get('item')
  if (originalItemMap.doc === null) {
    t.fail('originalItemMap.doc is null')
    return
  }
  t.assert(originalItemMap.doc.guid === originalGuid, 'Original should remain in Page A (since we only did set on B)')
}

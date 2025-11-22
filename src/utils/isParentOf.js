import { AbstractType, Item } from '../internals.js' // eslint-disable-line

/**
 * Check if `parent` is a parent of `child`.
 *
 * @param {AbstractType<any>} parent
 * @param {Item|null} child
 * @param {boolean} crossDoc When true, traverse across ref docs via doc._referrer
 * @return {Boolean} Whether `parent` is a parent of `child`.
 *
 * @private
 * @function
 */
export const isParentOf = (parent, child, crossDoc = false) => {
  /** @type {Set<string>} */
  const visitedGuids = crossDoc ? new Set() : /** @type {any} */ (null)
  while (child !== null) {
    if (child.parent === parent) {
      return true
    }
    const parentType = /** @type {AbstractType<any>} */ (child.parent)
    const nextChild = parentType._item
    if (nextChild !== null) {
      child = nextChild
      continue
    }
    if (!crossDoc) {
      break
    }
    const doc = parentType.doc
    if (!doc || !doc._referrer) {
      break
    }
    if (visitedGuids.has(doc.guid)) {
      // Circular ref chain detected
      break
    }
    visitedGuids.add(doc.guid)
    child = doc._referrer
  }
  return false
}

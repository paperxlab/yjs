import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * @param {t.TestCase} _tc
 */
export const testAfterTransactionRecursion = _tc => {
  const block = new Y.NanoBlock({ type: 'text' })
  const ytext = /** @type {Y.Text} */ (block.getType())
  /**
   * @type {Array<string>}
   */
  const origins = []
  block.on('afterTransaction', /** @param {Y.Transaction} tr */ (tr) => {
    origins.push(tr.origin)
    if (origins.length <= 1) {
      ytext.toDelta(Y.snapshot(block)) // adding a snapshot forces toDelta to create a cleanup transaction
      block.transact(() => {
        ytext.insert(0, 'a')
      }, 'nested')
    }
  })
  block.transact(() => {
    ytext.insert(0, '0')
  }, 'first')
  t.compareArrays(origins, ['first', 'cleanup', 'nested'])
}

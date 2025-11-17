
import {
  getState,
  writeStructsFromTransaction,
  writeDeleteSet,
  DeleteSet,
  sortAndMergeDeleteSet,
  getStateVector,
  findIndexSS,
  callEventHandlerListeners,
  Item,
  generateNewClientId,
  createID,
  cleanupYTextAfterTransaction,
  UpdateEncoderV1, UpdateEncoderV2, GC, StructStore, AbstractType, AbstractStruct, YEvent, NanoBlock, NanoStore, ContentBlockRef, ContentBlockUnref, YMap, YArray, addUnrefToBlock, updateBlockReferrer, resolveRefConflict, validateCircularRef, // eslint-disable-line
} from '../internals.js'

import * as map from 'lib0/map'
import * as math from 'lib0/math'
import * as set from 'lib0/set'
import * as logging from 'lib0/logging'
import { callAll } from 'lib0/function'

/**
 * StoreTransaction is a collection of (block) transactions.
 */
export class StoreTransaction {
  /**
   * @param {NanoStore} store
   * @param {any} origin
   * @param {boolean} local
   */
  constructor (store, origin, local) {
    this.store = store
    this.origin = origin
    this.local = local
    /**
     * @type {Map<NanoBlock, Transaction>}
     */
    this.blockTransactions = new Map()
    /**
     * @type {Map<NanoBlock, YEvent<any>[]>}
     */
    this.rootBlockEvents = new Map()

    /**
     * @type {Set<NanoBlock>}
     */
    this.blocksAdded = new Set()

    /**
     * @type {Set<ContentBlockRef>}
     */
    this.blockRefsAdded = new Set()

    /**
     * @type {Set<ContentBlockRef>}
     */
    this.blockRefsRemoved = new Set()

    /**
     * @type {Set<ContentBlockUnref>}
     */
    this.blockUnrefsAdded = new Set()
  }
}

/**
 * A transaction is created for every change on the Yjs model. It is possible
 * to bundle changes on the Yjs model in a single transaction to
 * minimize the number on messages sent and the number of observer calls.
 * If possible the user of this library should bundle as many changes as
 * possible. Here is an example to illustrate the advantages of bundling:
 *
 * @example
 * const map = y.define('map', YMap)
 * // Log content when change is triggered
 * map.observe(() => {
 *   console.log('change triggered')
 * })
 * // Each change on the map type triggers a log message:
 * map.set('a', 0) // => "change triggered"
 * map.set('b', 0) // => "change triggered"
 * // When put in a transaction, it will trigger the log after the transaction:
 * y.transact(() => {
 *   map.set('a', 1)
 *   map.set('b', 1)
 * }) // => "change triggered"
 *
 * @public
 */
export class Transaction {
  // TODO: Accept a storeTransaction as an argument
  /**
   * @param {NanoBlock} block
   * @param {any} origin
   * @param {boolean} local
   */
  constructor (block, origin, local) {
    /**
     * The Yjs instance.
     * @type {NanoBlock}
     */
    this.block = block
    /**
     * Describes the set of deleted items by ids
     * @type {DeleteSet}
     */
    this.deleteSet = new DeleteSet()
    /**
     * Holds the state before the transaction started.
     * @type {Map<Number,Number>}
     */
    this.beforeState = getStateVector(block.structStore)
    /**
     * Holds the state after the transaction.
     * @type {Map<Number,Number>}
     */
    this.afterState = new Map()
    /**
     * All types that were directly modified (property added or child
     * inserted/deleted). New types are not included in this Set.
     * Maps from type to parentSubs (`item.parentSub = null` for YArray)
     * @type {Map<AbstractType<YEvent<any>>,Set<String|null>>}
     */
    this.changed = new Map()
    /**
     * Stores the events for the types that observe also child elements.
     * It is mainly used by `observeDeep`.
     * @type {Map<AbstractType<YEvent<any>>,Array<YEvent<any>>>}
     */
    this.changedParentTypes = new Map()
    /**
     * @type {Array<AbstractStruct>}
     */
    this._mergeStructs = []
    /**
     * @type {any}
     */
    this.origin = origin
    /**
     * Stores meta information on the transaction
     * @type {Map<any,any>}
     */
    this.meta = new Map()
    /**
     * Whether this change originates from this doc.
     * @type {boolean}
     */
    this.local = local
    /**
     * @type {StoreTransaction | null}
     */
    this.storeTransaction = block.store ? block.store._transaction : null

    /**
     * @type {boolean}
     */
    this._needFormattingCleanup = false
  }
}

/**
 * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
 * @param {Transaction} transaction
 * @return {boolean} Whether data was written.
 */
export const writeUpdateMessageFromTransaction = (encoder, transaction) => {
  if (transaction.deleteSet.clients.size === 0 && !map.any(transaction.afterState, (clock, client) => transaction.beforeState.get(client) !== clock)) {
    return false
  }
  sortAndMergeDeleteSet(transaction.deleteSet)
  writeStructsFromTransaction(encoder, transaction)
  writeDeleteSet(encoder, transaction.deleteSet)
  return true
}

/**
 * @param {Transaction} transaction
 *
 * @private
 * @function
 */
export const nextID = transaction => {
  const block = transaction.block
  return createID(block.clientID, getState(block.structStore, block.clientID))
}

/**
 * If `type.parent` was added in current transaction, `type` technically
 * did not change, it was just added and we should not fire events for `type`.
 *
 * @param {Transaction} transaction
 * @param {AbstractType<YEvent<any>>} type
 * @param {string|null} parentSub
 */
export const addChangedTypeToTransaction = (transaction, type, parentSub) => {
  const item = type._item
  if (item === null || (item.id.clock < (transaction.beforeState.get(item.id.client) || 0) && !item.deleted)) {
    map.setIfUndefined(transaction.changed, type, set.create).add(parentSub)
  }
}

/**
 * @param {Array<AbstractStruct>} structs
 * @param {number} pos
 * @return {number} # of merged structs
 */
const tryToMergeWithLefts = (structs, pos) => {
  let right = structs[pos]
  let left = structs[pos - 1]
  let i = pos
  for (; i > 0; right = left, left = structs[--i - 1]) {
    if (left.deleted === right.deleted && left.constructor === right.constructor) {
      if (left.mergeWith(right)) {
        if (right instanceof Item && right.parentSub !== null && /** @type {AbstractType<any>} */ (right.parent)._map.get(right.parentSub) === right) {
          /** @type {AbstractType<any>} */ (right.parent)._map.set(right.parentSub, /** @type {Item} */ (left))
        }
        continue
      }
    }
    break
  }
  const merged = pos - i
  if (merged) {
    // remove all merged structs from the array
    structs.splice(pos + 1 - merged, merged)
  }
  return merged
}

/**
 * @param {DeleteSet} ds
 * @param {StructStore} store
 * @param {function(Item):boolean} gcFilter
 */
const tryGcDeleteSet = (ds, store, gcFilter) => {
  for (const [client, deleteItems] of ds.clients.entries()) {
    const structs = /** @type {Array<GC|Item>} */ (store.clients.get(client))
    for (let di = deleteItems.length - 1; di >= 0; di--) {
      const deleteItem = deleteItems[di]
      const endDeleteItemClock = deleteItem.clock + deleteItem.len
      for (
        let si = findIndexSS(structs, deleteItem.clock), struct = structs[si];
        si < structs.length && struct.id.clock < endDeleteItemClock;
        struct = structs[++si]
      ) {
        const struct = structs[si]
        if (deleteItem.clock + deleteItem.len <= struct.id.clock) {
          break
        }
        if (struct instanceof Item && struct.deleted && !struct.keep && gcFilter(struct)) {
          struct.gc(store, false)
        }
      }
    }
  }
}

/**
 * @param {DeleteSet} ds
 * @param {StructStore} store
 */
const tryMergeDeleteSet = (ds, store) => {
  // try to merge deleted / gc'd items
  // merge from right to left for better efficiecy and so we don't miss any merge targets
  ds.clients.forEach((deleteItems, client) => {
    const structs = /** @type {Array<GC|Item>} */ (store.clients.get(client))
    for (let di = deleteItems.length - 1; di >= 0; di--) {
      const deleteItem = deleteItems[di]
      // start with merging the item next to the last deleted item
      const mostRightIndexToCheck = math.min(structs.length - 1, 1 + findIndexSS(structs, deleteItem.clock + deleteItem.len - 1))
      for (
        let si = mostRightIndexToCheck, struct = structs[si];
        si > 0 && struct.id.clock >= deleteItem.clock;
        struct = structs[si]
      ) {
        si -= 1 + tryToMergeWithLefts(structs, si)
      }
    }
  })
}

/**
 * @param {DeleteSet} ds
 * @param {StructStore} store
 * @param {function(Item):boolean} gcFilter
 */
export const tryGc = (ds, store, gcFilter) => {
  tryGcDeleteSet(ds, store, gcFilter)
  tryMergeDeleteSet(ds, store)
}

// FIXME: This can be replaced with TransactionSet of NanoStore
/**
 * @param {Array<Transaction>} transactionCleanups
 * @param {number} i
 */
const cleanupTransactions = (transactionCleanups, i) => {
  if (i < transactionCleanups.length) {
    const transaction = transactionCleanups[i]
    const block = transaction.block
    const structStore = block.structStore
    const ds = transaction.deleteSet
    const mergeStructs = transaction._mergeStructs
    try {
      sortAndMergeDeleteSet(ds)
      transaction.afterState = getStateVector(transaction.block.structStore)
      block.emit('beforeObserverCalls', [transaction, block])
      /**
       * An array of event callbacks.
       *
       * Each callback is called even if the other ones throw errors.
       *
       * @type {Array<function():void>}
       */
      const fs = []
      // observe events on changed types
      transaction.changed.forEach((subs, itemtype) =>
        fs.push(() => {
          if (itemtype._item === null || !itemtype._item.deleted) {
            itemtype._callObserver(transaction, subs)
          }
        })
      )
      fs.push(() => {
        // deep observe events
        transaction.changedParentTypes.forEach((events, type) => {
          // We need to think about the possibility that the user transforms the
          // Y.Doc in the event.
          if (type._dEH.l.length > 0 && (type._item === null || !type._item.deleted)) {
            events = events
              .filter(event =>
                event.target._item === null || !event.target._item.deleted
              )
            events
              .forEach(event => {
                event.currentTarget = type
                // path is relative to the current target
                event._path = null
              })
            // sort events by path length so that top-level events are fired first.
            events
              .sort((event1, event2) => event1.path.length - event2.path.length)
            // We don't need to check for events.length
            // because we know it has at least one element
            callEventHandlerListeners(type._dEH, events, transaction)
          }
        })
      })
      fs.push(() => block.emit('afterTransaction', [transaction, block]))
      callAll(fs, [])
      if (transaction._needFormattingCleanup) {
        cleanupYTextAfterTransaction(transaction)
      }
    } finally {
      // Replace deleted items with ItemDeleted / GC.
      // This is where content is actually remove from the Yjs Doc.
      if (block.gc) {
        tryGcDeleteSet(ds, structStore, block.gcFilter)
      }
      tryMergeDeleteSet(ds, structStore)

      // on all affected store.clients props, try to merge
      transaction.afterState.forEach((clock, client) => {
        const beforeClock = transaction.beforeState.get(client) || 0
        if (beforeClock !== clock) {
          const structs = /** @type {Array<GC|Item>} */ (structStore.clients.get(client))
          // we iterate from right to left so we can safely remove entries
          const firstChangePos = math.max(findIndexSS(structs, beforeClock), 1)
          for (let i = structs.length - 1; i >= firstChangePos;) {
            i -= 1 + tryToMergeWithLefts(structs, i)
          }
        }
      })
      // try to merge mergeStructs
      // @todo: it makes more sense to transform mergeStructs to a DS, sort it, and merge from right to left
      //        but at the moment DS does not handle duplicates
      for (let i = mergeStructs.length - 1; i >= 0; i--) {
        const { client, clock } = mergeStructs[i].id
        const structs = /** @type {Array<GC|Item>} */ (structStore.clients.get(client))
        const replacedStructPos = findIndexSS(structs, clock)
        if (replacedStructPos + 1 < structs.length) {
          if (tryToMergeWithLefts(structs, replacedStructPos + 1) > 1) {
            continue // no need to perform next check, both are already merged
          }
        }
        if (replacedStructPos > 0) {
          tryToMergeWithLefts(structs, replacedStructPos)
        }
      }
      if (!transaction.local && transaction.afterState.get(block.clientID) !== transaction.beforeState.get(block.clientID)) {
        logging.print(logging.ORANGE, logging.BOLD, '[yjs] ', logging.UNBOLD, logging.RED, 'Changed the client-id because another client seems to be using it.')
        block.clientID = generateNewClientId()
      }
      // @todo Merge all the transactions into one and provide send the data as a single update message
      block.emit('afterTransactionCleanup', [transaction, block])
      if (block._observers.has('update')) {
        const encoder = new UpdateEncoderV1()
        const hasContent = writeUpdateMessageFromTransaction(encoder, transaction)
        if (hasContent) {
          block.emit('update', [encoder.toUint8Array(), transaction.origin, block, transaction])
        }
      }
      if (block._observers.has('updateV2')) {
        const encoder = new UpdateEncoderV2()
        const hasContent = writeUpdateMessageFromTransaction(encoder, transaction)
        if (hasContent) {
          block.emit('updateV2', [encoder.toUint8Array(), transaction.origin, block, transaction])
        }
      }
      // const { subdocsAdded, subdocsLoaded, subdocsRemoved } = transaction
      // if (subdocsAdded.size > 0 || subdocsRemoved.size > 0 || subdocsLoaded.size > 0) {
      //   subdocsAdded.forEach(subdoc => {
      //     subdoc.clientID = store.clientID
      //     if (subdoc.collectionid == null) {
      //       subdoc.collectionid = store.collectionid
      //     }
      //     store.subdocs.add(subdoc)
      //   })
      //   subdocsRemoved.forEach(subdoc => store.subdocs.delete(subdoc))
      //   store.emit('subdocs', [{ loaded: subdocsLoaded, added: subdocsAdded, removed: subdocsRemoved }, store, transaction])
      //   subdocsRemoved.forEach(subdoc => subdoc.destroy())
      // }

      if (transactionCleanups.length <= i + 1) {
        block._transactionCleanups = []
        block.emit('afterAllTransactions', [block, transactionCleanups])
      } else {
        cleanupTransactions(transactionCleanups, i + 1)
      }
    }
  }
}

/**
 * Implements the functionality of `y.transact(()=>{..})`
 *
 * @template T
 * @param {NanoBlock} block
 * @param {function(Transaction):T} f
 * @param {any} [origin=true]
 * @return {T}
 *
 * @function
 */
export const transact = (block, f, origin = null, local = true) => {
  if (block.store) {
    return transactInStore(block.store, (storeTr) => {
      if (block._transaction === null) {
        block._transaction = new Transaction(block, storeTr.origin, storeTr.local)
        storeTr.blockTransactions.set(block, block._transaction)
        block.emit('beforeTransaction', [block._transaction, block])
      }
      return f(block._transaction)
    }, origin, local)
  }

  const transactionCleanups = block._transactionCleanups
  let initialCall = false
  /**
   * @type {any}
   */
  let result = null
  if (block._transaction === null) {
    initialCall = true
    block._transaction = new Transaction(block, origin, local)
    transactionCleanups.push(block._transaction)
    if (transactionCleanups.length === 1) {
      block.emit('beforeAllTransactions', [block])
    }
    block.emit('beforeTransaction', [block._transaction, block])
  }
  try {
    result = f(block._transaction)
  } finally {
    if (initialCall) {
      const finishCleanup = block._transaction === transactionCleanups[0]
      block._transaction = null
      if (finishCleanup) {
        // The first transaction ended, now process observer calls.
        // Observer call may create new transactions for which we need to call the observers and do cleanup.
        // We don't want to nest these calls, so we execute these calls one after
        // another.
        // Also we need to ensure that all cleanups are called, even if the
        // observes throw errors.
        // This file is full of hacky try {} finally {} blocks to ensure that an
        // event can throw errors and also that the cleanup is called.
        cleanupTransactions(transactionCleanups, 0)
      }
    }
  }
  return result
}

/**
 * Implements the functionality of `store.transact(()=>{..})`
 *
 * @template T
 * @param {NanoStore} store
 * @param {function(StoreTransaction):T} f
 * @param {any} [origin=true]
 * @return {T}
 *
 * @function
 */
export const transactInStore = (store, f, origin = null, local = true) => {
  const transactionCleanups = store._transactionCleanups
  let initialCall = false

  if (store._transaction === null) {
    initialCall = true
    store._transaction = new StoreTransaction(store, origin, local)
    transactionCleanups.push(store._transaction)
    if (transactionCleanups.length === 1) {
      store.emit('beforeAllTransactions', [store])
    }
    store.emit('beforeTransaction', [store._transaction, store])
  }
  let result = null
  try {
    result = f(store._transaction)
  } finally {
    if (initialCall) {
      const finishCleanup = store._transaction === transactionCleanups[0]
      // これ以降に呼ばれた変更は、新しい transaction になる
      store._transaction.blockTransactions.forEach((tr) => {
        tr.block._transaction = null
      })
      store._transaction = null
      if (finishCleanup) {
        let i = 0
        while (i < transactionCleanups.length) {
          const transaction = transactionCleanups[i]

          transaction.blockTransactions.forEach((tr) => {
            const ds = tr.deleteSet
            sortAndMergeDeleteSet(ds)
            tr.afterState = getStateVector(tr.block.structStore)
          })

          // Resolve block refs
          resolveBlockRefs(transaction)
          // At first, call all transaction observers.
          callBlockTransactionsObservers(transaction)
          // Next, call root observers
          callRootObservers(transaction)
          // Then, Try GC And Merge
          cleanupConsumedTransaction(transaction)
          // Emit store transaction cleanup events
          emitStoreTransactionCleanupEvents(transaction)
          // Finally call next cleanups
          i++
        }
        store.emit('afterAllTransactions', [store, transactionCleanups])
        store._transactionCleanups = []
      }
    }
  }
  return result
}

/**
 * Resolve block refs
 * @param {StoreTransaction} storeTransaction
 */
const resolveBlockRefs = (storeTransaction) => {
  if (storeTransaction.blockRefsAdded.size === 0 && storeTransaction.blockRefsRemoved.size === 0) return

  const store = storeTransaction.store
  // FIXME: Transaction で囲った方が良さそう
  storeTransaction.blockRefsAdded.forEach(ref => {
    // ここで ref が conflict していないかをチェックする
    if (!ref._block) {
      // Never happedn
      console.error("ref doesn't have block", ref)
      return
    }
    if (ref._block._referrer && ref._item !== ref._block._referrer) {
      console.warn('Resolving conflict in transaction cleanup', ref)
      const rootBlock = ref._block.getRootBlock()
      if (rootBlock) {
        resolveRefConflict(rootBlock, ref._block._referrer.content)
      }
    }
    updateBlockReferrer(ref._block, ref)
    validateCircularRef(/** @type {Item & { content: ContentBlockRef }} */(ref._item))
  })
}

/**
 * Cleanup all transactions that are not currently in progress.
 *
 * @param {StoreTransaction} storeTransaction
 */
const callBlockTransactionsObservers = (storeTransaction) => {
  storeTransaction.blockTransactions.forEach((transaction) => {
    try {
      consumeBlockTransactionObservers(transaction)
    } catch (e) {
      console.trace(e)
    }
  })
}

/**
 * Consume block transaction observers
 * @param {Transaction} transaction
 */
const consumeBlockTransactionObservers = (transaction) => {
  const block = transaction.block

  block.emit('beforeObserverCalls', [transaction, block])
  /**
   * An array of event callbacks.
   *
   * Each callback is called even if the other ones throw errors.
   *
   * @type {Array<function():void>}
   */
  const fs = []
  // observe events on changed types
  transaction.changed.forEach((subs, itemtype) =>
    fs.push(() => {
      if (itemtype._item === null || !itemtype._item.deleted) {
        itemtype._callObserver(transaction, subs)
      }
    })
  )
  fs.push(() => {
    // deep observe events
    transaction.changedParentTypes.forEach((events, type) => {
      // We need to think about the possibility that the user transforms the
      // Y.Doc in the event.
      if (type._dEH.l.length > 0 && (type._item === null || !type._item.deleted)) {
        events = events
          .filter(event =>
            event.target._item === null || !event.target._item.deleted
          )
        events
          .forEach(event => {
            event.currentTarget = type
            // path is relative to the current target
            event._path = null
          })
        // sort events by path length so that top-level events are fired first.
        events
          .sort((event1, event2) => event1.path.length - event2.path.length)

        // We don't need to check for events.length
        // because we know it has at least one element
        callEventHandlerListeners(type._dEH, events, transaction)
      }
    })
  })
  fs.push(() => block.emit('afterTransaction', [transaction, block]))
  callAll(fs, [])
}

/**
 * Call root observers
 * @param {StoreTransaction} storeTransaction
 */
const callRootObservers = (storeTransaction) => {
  storeTransaction.blocksAdded.forEach((block) => {
    // Calc and cache root block
    block.getRootBlock()
  })
  // Gather changed root block types
  storeTransaction.rootBlockEvents.forEach((events, block) => {
    const rootType = block.getType()
    callEventHandlerListeners(rootType._rEH, events, storeTransaction)
  })
}

/**
 * Try GC and cleanup
 * @param {StoreTransaction} storeTransaction
 */
const cleanupConsumedTransaction = (storeTransaction) => {
  storeTransaction.blockTransactions.forEach((transaction) => {
    if (transaction._needFormattingCleanup) {
      cleanupYTextAfterTransaction(transaction)
    }

    const block = transaction.block
    const structStore = block.structStore
    const ds = transaction.deleteSet
    const mergeStructs = transaction._mergeStructs
    // Replace deleted items with ItemDeleted / GC.
    // This is where content is actually remove from the Yjs Doc.
    if (block.gc) {
      tryGcDeleteSet(ds, structStore, block.gcFilter)
    }
    tryMergeDeleteSet(ds, structStore)

    // on all affected store.clients props, try to merge
    transaction.afterState.forEach((clock, client) => {
      const beforeClock = transaction.beforeState.get(client) || 0
      if (beforeClock !== clock) {
        const structs = /** @type {Array<GC|Item>} */ (structStore.clients.get(client))
        // we iterate from right to left so we can safely remove entries
        const firstChangePos = math.max(findIndexSS(structs, beforeClock), 1)
        for (let i = structs.length - 1; i >= firstChangePos;) {
          i -= 1 + tryToMergeWithLefts(structs, i)
        }
      }
    })
    // try to merge mergeStructs
    // @todo: it makes more sense to transform mergeStructs to a DS, sort it, and merge from right to left
    //        but at the moment DS does not handle duplicates
    for (let i = mergeStructs.length - 1; i >= 0; i--) {
      const { client, clock } = mergeStructs[i].id
      const structs = /** @type {Array<GC|Item>} */ (structStore.clients.get(client))
      const replacedStructPos = findIndexSS(structs, clock)
      if (replacedStructPos + 1 < structs.length) {
        if (tryToMergeWithLefts(structs, replacedStructPos + 1) > 1) {
          continue // no need to perform next check, both are already merged
        }
      }
      if (replacedStructPos > 0) {
        tryToMergeWithLefts(structs, replacedStructPos)
      }
    }
    if (!transaction.local && transaction.afterState.get(block.clientID) !== transaction.beforeState.get(block.clientID)) {
      logging.print(logging.ORANGE, logging.BOLD, '[yjs] ', logging.UNBOLD, logging.RED, 'Changed the client-id because another client seems to be using it.')
      block.clientID = generateNewClientId()
    }
    // @todo Merge all the transactions into one and provide send the data as a single update message
    block.emit('afterTransactionCleanup', [transaction, block])
    // StoreTransaction の場合は、個別 block の update イベントは発火しない
    // if (block._observers.has('update')) {
    //   const encoder = new UpdateEncoderV1()
    //   const hasContent = writeUpdateMessageFromTransaction(encoder, transaction)
    //   if (hasContent) {
    //     block.emit('update', [encoder.toUint8Array(), transaction.origin, block, transaction])
    //   }
    // }
    // if (block._observers.has('updateV2')) {
    //   const encoder = new UpdateEncoderV2()
    //   const hasContent = writeUpdateMessageFromTransaction(encoder, transaction)
    //   if (hasContent) {
    //     block.emit('updateV2', [encoder.toUint8Array(), transaction.origin, block, transaction])
    //   }
    // }
    // const { subdocsAdded, subdocsLoaded, subdocsRemoved } = transaction
    // if (subdocsAdded.size > 0 || subdocsRemoved.size > 0 || subdocsLoaded.size > 0) {
    //   subdocsAdded.forEach(subdoc => {
    //     subdoc.clientID = store.clientID
    //     if (subdoc.collectionid == null) {
    //       subdoc.collectionid = store.collectionid
    //     }
    //     store.subdocs.add(subdoc)
    //   })
    //   subdocsRemoved.forEach(subdoc => store.subdocs.delete(subdoc))
    //   store.emit('subdocs', [{ loaded: subdocsLoaded, added: subdocsAdded, removed: subdocsRemoved }, store, transaction])
    //   subdocsRemoved.forEach(subdoc => subdoc.destroy())
    // }
  })
}

/**
 *
 * @param {StoreTransaction} storeTransaction
 */
function emitStoreTransactionCleanupEvents (storeTransaction) {
  storeTransaction.store.emit('afterTransactionCleanup', [storeTransaction, storeTransaction.store])
  if (storeTransaction.store._observers.has('updateV2')) {
    /** @type {Map<NanoBlock, Uint8Array>} */
    const updates = new Map()
    for (const transaction of storeTransaction.blockTransactions.values()) {
      const encoder = new UpdateEncoderV2()
      const hasContent = writeUpdateMessageFromTransaction(encoder, transaction)
      if (hasContent) {
        const block = transaction.block
        updates.set(block, encoder.toUint8Array())
      }
    }
    storeTransaction.store.emit('updateV2', [updates, storeTransaction.origin, storeTransaction.store, storeTransaction])
  }
}

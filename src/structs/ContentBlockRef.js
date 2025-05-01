import { NanoBlock, Item, Transaction, UpdateDecoderV1, UpdateDecoderV2, UpdateEncoderV1, UpdateEncoderV2, ID, StructStore, AbstractType, getBlockTypeFromInstance, updateBlockReferrer, NanoStore, YMap, YArray, addUnrefToBlock } from '../internals.js' // eslint-disable-line

import * as error from 'lib0/error'

/**
 * @typedef {Object} ContentBlockUnrefOpts
 * @property {string} blockId target block id
 * @property {number} client client id of the ref item
 * @property {number} clock clock of the ref item
 */

/**
 * @typedef {Object} ContentBlockRefOpts
 * @property {string} blockId
 * @property {import("../utils/NanoBlock.js").BlockType} blockType
 */

export class ContentBlockRef {
  /**
   * Initialized with either a NanoBlock or a AbstractType when manipulated by the user.
   * @param {AbstractType<any> | ContentBlockRefOpts} opt
   */
  constructor (opt) {
    /**
     * Block id to refer
     * @type {string}
     */
    this.blockId = ''

    /**
     * Block type
     * @type {import("../utils/NanoBlock.js").BlockType}
     */
    // @ts-ignore
    this.blockType = ''

    /**
     * @type {NanoBlock | null}
     */
    this._block = null

    /**
     * @type {AbstractType<any> | null}
     */
    this._type = null

    if (opt instanceof AbstractType) {
      const type = opt
      if (type.block && type.block.getType() !== type) {
        throw new Error('You can create a ref only for the root type of a block')
      }
      this._type = type
      this.blockType = getBlockTypeFromInstance(type)
      if (type.block) {
        this._block = type.block
        this.blockId = this._block.id
      }
    } else {
      this.blockId = opt.blockId
      this.blockType = opt.blockType
    }

    /**
     * @type {Item & { content: ContentBlockRef } | null}
     */
    this._item = null
  }

  /**
   *
   * @param {Transaction} transaction
   * @param {Item & { content: ContentBlockRef }} item
   */
  integrate (transaction, item) {
    this._item = item
    if (!transaction.storeTransaction) return
    const store = transaction.storeTransaction.store
    transaction.storeTransaction.blockRefsAdded.add(this)

    // ref の conflict や循環参照が見つかった場合
    // tr.local なら、この場で解決する.
    // tr.local でないなら、ここでは解決せずに、cleanup の中で解決する（つまり次の local な transaction).
    if (transaction.local) {
      if (this.blockId && this.blockType) {
        const block = store.getOrCreateBlock(this.blockId, this.blockType)
        // conflict
        if (block._referrer) {
          // この item は削除されて、clone された block に対して新しい ref が作成される
          console.warn('Resolving conflit in ContentBlockRef.integrate', this)
          resolveRefConflict(store, this)
        } else {
          this._block = block
          this._type = block.getType()
          // ここで循環参照が発生する可能性があるので解決する
          updateBlockReferrer(this._block, this)
          validateCircularRef(this._item)
        }
      } else if (this._type && !this._block) {
        // block を作成する
        this._block = store.createBlock(this.blockType, undefined, this._type)
        this.blockId = this._block.id
        updateBlockReferrer(this._block, this)
        validateCircularRef(this._item)
      }
    } else {
      // local でない場合は、必ず blockId と blockType が存在する
      // またここでは block.referrer の設定も行わない
      const block = store.getOrCreateBlock(this.blockId, this.blockType)
      this._block = block
      this._type = block.getType()
    }

    // integrate されたあとは、blockId and blockType は必ず存在する
    // _block と _type が存在しない場合は、conflict されて削除されている
  }

  /**
   * @param {Transaction} transaction
   */
  delete (transaction) {
    if (this._block && this._block._referrer && this._block._referrer === this._item) {
      updateBlockReferrer(this._block, null)
    }
    if (transaction.storeTransaction) {
      if (transaction.storeTransaction.blockRefsAdded.has(this)) {
        transaction.storeTransaction.blockRefsAdded.delete(this)
      } else {
        transaction.storeTransaction.blockRefsRemoved.add(this)
      }
    }
    if (transaction.local && this._item && this._item.block) {
      addUnrefToBlock(this._item.block, this)
    }
  }

  /**
   * @param {StructStore} store
   */
  gc (store) { }

  getLength () {
    return 1
  }

  getContent () {
    return [this._type]
  }

  isCountable () {
    return true
  }

  copy () {
    return new ContentBlockRef({
      blockId: this.blockId,
      blockType: this.blockType
    })
  }

  /**
   * @param {number} offset
   * @return {ContentBlockRef}
   */
  splice (offset) {
    throw error.methodUnimplemented()
  }

  mergeWith () {
    return false
  }

  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write (encoder, offset) {
    encoder.writeString(this.blockId)
    encoder.writeString(this.blockType)
    if (!this._item?.deleted) {
      encoder.addRef(this.blockId)
    }
  }

  getRef () {
    return 11
  }
}

export class ContentBlockUnref {
  /**
   * @param {ContentBlockUnrefOpts} opts
   */
  constructor (opts) {
    /**
     * Block id to refer
     * @type {string}
     */
    this.blockId = opts.blockId

    /**
     * Client id of the ref item
     * @type {number}
     */
    this.client = opts.client

    /**
     * Clock of the ref item
     * @type {number}
     */
    this.clock = opts.clock

    /**
     * @type {Item | null}
     */
    this._item = null
  }

  /**
   * @param {Transaction} transaction
   * @param {Item} item
   */
  integrate (transaction, item) {
    this._item = item
    // Unref が作成される時には対応する Ref が削除されるので、ここでの処理は不要
    // Unref が GC されるとバックエンドでの Ref の更新ができないので、GC しないように keep フラグを立てる
    item.keep = true
    if (transaction.storeTransaction) {
      transaction.storeTransaction.blockUnrefsAdded.add(this)
    }
  }

  /**
   * @param {Transaction} transaction
   */
  delete (transaction) {
  }

  copy () {
    return new ContentBlockUnref({
      blockId: this.blockId,
      client: this.client,
      clock: this.clock
    })
  }

  /**
   * @param {StructStore} store
   */
  gc (store) { }

  getLength () {
    return 1
  }

  getContent () {
    return [this.blockId]
  }

  isCountable () {
    return true
  }

  /**
   * @param {UpdateEncoderV1 | UpdateEncoderV2} encoder
   * @param {number} offset
   */
  write (encoder, offset) {
    encoder.writeAny({
      blockId: this.blockId,
      client: this.client,
      clock: this.clock
    })
  }

  /**
   * @param {number} offset
   * @return {ContentBlockUnref}
   */
  splice (offset) {
    throw error.methodUnimplemented()
  }

  mergeWith () {
    return false
  }

  getRef () {
    return 12
  }
}

/**
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentBlockRefOpts}
 */
function createContentBlockRefFromDecoder (decoder) {
  const blockId = decoder.readString()
  /** @type {import("../utils/NanoBlock.js").BlockType} */
  // @ts-ignore
  const blockType = decoder.readString()

  return {
    blockId,
    blockType
  }
}

/**
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentBlockUnrefOpts}
 */
function createContentBlockUnrefFromDecoder (decoder) {
  return decoder.readAny()
}

/**
 * @private
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentBlockRef}
 */
export const readContentBlockRef = decoder => new ContentBlockRef(createContentBlockRefFromDecoder(decoder))

/**
 * @private
 *
 * @param {UpdateDecoderV1 | UpdateDecoderV2} decoder
 * @return {ContentBlockUnref}
 */
export const readContentBlockUnRef = decoder => new ContentBlockUnref(createContentBlockUnrefFromDecoder(decoder))

/**
 * @param {NanoStore} store
 * @param {ContentBlockRef} ref The ref conflicted
 */
export function resolveRefConflict (store, ref) {
  if (ref._item?.deleted) return
  // Clone conflicted item
  // if the conflicted item is in map, delete it
  if (ref._item && ref._item.parentSub) {
    const key = ref._item.parentSub
    const map = /** @type {YMap<any>} */ (ref._item.parent)
    // 必ず元の item を削除してから clone することで、循環参照が作られないようにする
    map.delete(key)
    const cloned = cloneBlock(store, ref.blockId)
    map.set(key, cloned)
  } else if (ref._item && ref._item.parentSub == null) {
    // if the conflicted item is in array, delete it
    const array = /** @type {YArray<any>} */ (ref._item.parent)
    /** @type {Item | null} */
    let item = ref._item.left
    let index = 0
    while (item !== null) {
      if (!item.deleted && item.countable) {
        index++
      }
      item = item.left
    }
    // 必ず元の item を削除してから clone することで、循環参照が作られないようにする
    array.delete(index)
    const cloned = cloneBlock(store, ref.blockId)
    array.insert(index, [cloned])
  }
}

/**
 * @param {NanoStore} store
 * @param {string} blockId
 * @return {AbstractType<any>}
 */
function cloneBlock (store, blockId) {
  const block = store.getBlock(blockId)
  if (!block) throw new Error('Block not found')
  const type = block.getType()

  if (type instanceof YArray) {
    const newType = new YArray()
    newType.createRef = true
    let item = type._start
    while (item != null) {
      if (item.countable && !item.deleted) {
        if (item.content instanceof ContentBlockRef) {
          newType.push([cloneBlock(store, item.content.blockId)])
        } else {
          newType.push(item.content.getContent().map(c => {
            if (c instanceof AbstractType) {
              const cloned = c.clone()
              cloned.createRef = false
              return cloned
            }
            return c
          }))
        }
      }
      item = item.right
    }
    return newType
  } else if (type instanceof YMap) {
    const newType = new YMap()
    newType.createRef = true
    type._map.forEach((item, key) => {
      if (item.countable && !item.deleted) {
        if (item.content instanceof ContentBlockRef) {
          newType.set(key, cloneBlock(store, item.content.blockId))
        } else {
          const c = item.content.getContent()
          if (c[c.length - 1] instanceof AbstractType) {
            const cloned = c[c.length - 1].clone()
            cloned.createRef = false
            newType.set(key, cloned)
          } else {
            newType.set(key, c[c.length - 1])
          }
        }
      }
    })
    return newType
  } else {
    // TODO: XmlElement の attrs にも ref が設定されることがある
    const newType = type.clone()
    newType.createRef = true
    return newType
  }
}

/**
 * @private
 * @param {Item & { content: ContentBlockRef }} item
 */
export function validateCircularRef (item) {
  if (item?.deleted) return
  const blockId = item.content.blockId
  let found = false
  let n = /** @type {Item | null} */(item)
  while (n?.block) {
    if (n.block.id === blockId) {
      console.warn('Circular reference detected', item)
      found = true
      break
    }
    n = n.block._referrer
  }
  if (!found) return
  if (item && item.parentSub) {
    const key = item.parentSub
    const map = /** @type {YMap<any>} */ (item.parent)
    // 必ず元の item を削除してから clone することで、循環参照が作られないようにする
    map.delete(key)
  } else if (item && item.parentSub == null) {
    // if the conflicted item is in array, delete it
    const array = /** @type {YArray<any>} */ (item.parent)
    /** @type {Item | null} */
    let n = item.left
    let index = 0
    while (n !== null) {
      if (!n.deleted && n.countable) {
        index++
      }
      n = n.left
    }
    // 必ず元の item を削除してから clone することで、循環参照が作られないようにする
    array.delete(index)
  }
}

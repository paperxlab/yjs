import * as Y from '../src/index.js'
import * as t from 'lib0/testing'

/**
 * @param {t.TestCase} tc
 */
export const testRootBlockScoping = tc => {
  const store = new Y.NanoStore()
  
  // Create two root blocks
  const rootBlock1 = store.getRootBlockOrCreate('root1', 'map')
  const rootBlock2 = store.getRootBlockOrCreate('root2', 'map')
  
  t.assert(rootBlock1.isRoot === true, 'rootBlock1 should be a root block')
  t.assert(rootBlock2.isRoot === true, 'rootBlock2 should be a root block')
  
  // Create child blocks in different root blocks with same ID
  const childId = 'child-123'
  const child1 = rootBlock1.createBlock('array', childId)
  const child2 = rootBlock2.createBlock('map', childId)
  
  // Verify blocks are scoped to their root blocks
  t.assert(rootBlock1.getBlock(childId) === child1, 'child1 should be in rootBlock1')
  t.assert(rootBlock2.getBlock(childId) === child2, 'child2 should be in rootBlock2')
  t.assert(child1 !== child2, 'Same ID in different root blocks should create different blocks')
  
  // Verify block types
  t.assert(child1.blockType === 'array', 'child1 should be array type')
  t.assert(child2.blockType === 'map', 'child2 should be map type')
}

/**
 * @param {t.TestCase} tc
 */
export const testGetBlocks = tc => {
  const store = new Y.NanoStore()
  const rootBlock = store.getRootBlockOrCreate('root', 'map')
  
  // Initially no child blocks
  const initialBlocks = rootBlock.getBlocks()
  t.assert(initialBlocks !== null && initialBlocks.size === 0, 'Root block should have no children initially')
  
  // Create multiple child blocks
  const child1 = rootBlock.createBlock('array')
  const child2 = rootBlock.createBlock('map')
  const child3 = rootBlock.createBlock('text')
  
  const blocks = rootBlock.getBlocks()
  t.assert(blocks !== null && blocks.size === 3, 'Should have 3 child blocks')
  t.assert(blocks !== null && blocks.has(child1.id), 'Should contain child1')
  t.assert(blocks !== null && blocks.has(child2.id), 'Should contain child2')
  t.assert(blocks !== null && blocks.has(child3.id), 'Should contain child3')
}

/**
 * @param {t.TestCase} tc
 */
export const testGetOrCreateBlock = tc => {
  const store = new Y.NanoStore()
  const rootBlock = store.getRootBlockOrCreate('root', 'map')
  
  const id = 'test-block-id'
  
  // First call creates the block
  const block1 = rootBlock.getOrCreateBlock(id, 'array')
  t.assert(block1.id === id, 'Block should have the specified ID')
  t.assert(block1.blockType === 'array', 'Block should have array type')
  
  // Second call returns the same block
  const block2 = rootBlock.getOrCreateBlock(id, 'array')
  t.assert(block1 === block2, 'Should return the same block instance')
  
  // Verify it's registered in the root block
  t.assert(rootBlock.getBlock(id) === block1, 'Block should be registered in root block')
}

/**
 * @param {t.TestCase} tc
 */
export const testRootBlockReference = tc => {
  const store = new Y.NanoStore()
  const rootBlock = store.getRootBlockOrCreate('root', 'map')
  
  // Root block should reference itself
  t.assert(rootBlock.getRootBlock() === rootBlock, 'Root block should reference itself')
  
  // Child blocks should reference their root
  const child = rootBlock.createBlock('array')
  t.assert(child.getRootBlock() === rootBlock, 'Child should reference its root block')
  
  // Nested structure
  const rootType = /** @type {Y.Map<any>} */ (rootBlock.getType())
  const nestedArray = new Y.Array()
  rootType.set('nested', nestedArray)
  
  // Create a ref to another block
  const refBlock = rootBlock.createBlock('map')
  nestedArray.push([refBlock.getType()])
  
  t.assert(refBlock.getRootBlock() === rootBlock, 'Referenced block should have same root')
}

/**
 * @param {t.TestCase} tc
 */
export const testNonRootBlockMethods = tc => {
  const store = new Y.NanoStore()
  const rootBlock = store.getRootBlockOrCreate('root', 'map')
  const childBlock = rootBlock.createBlock('array')
  
  // These methods should throw on non-root blocks
  t.fails(() => {
    childBlock.getBlocks()
  })
  
  t.fails(() => {
    childBlock.getBlock('some-id')
  })
  
  t.fails(() => {
    childBlock.createBlock('map')
  })
  
  t.fails(() => {
    childBlock.getOrCreateBlock('some-id', 'map')
  })
}

/**
 * @param {t.TestCase} tc
 */
export const testRootBlockLookup = tc => {
  const store = new Y.NanoStore()
  
  // Create blocks in different root blocks
  const root1 = store.getRootBlockOrCreate('root1', 'map')
  const root2 = store.getRootBlockOrCreate('root2', 'map')
  
  const child1 = root1.createBlock('array')
  const child2 = root2.createBlock('map')
  
  // Each root block manages its own children
  t.assert(root1.getBlock(child1.id) === child1, 'root1 should find its child1')
  t.assert(root2.getBlock(child2.id) === child2, 'root2 should find its child2')
  
  // Cross-root block lookup should fail
  t.assert(root1.getBlock(child2.id) === undefined, 'root1 should not find child2')
  t.assert(root2.getBlock(child1.id) === undefined, 'root2 should not find child1')
}

/**
 * @param {t.TestCase} tc
 */
export const testBlockClone = tc => {
  const store = new Y.NanoStore()
  const rootBlock = store.getRootBlockOrCreate('root', 'map')
  
  // Create a block with some content
  const original = rootBlock.createBlock('array')
  const originalType = /** @type {Y.Array<any>} */ (original.getType())
  originalType.push(['item1', 'item2', 'item3'])
  
  // Clone the block
  const cloned = original.clone()
  const clonedType = /** @type {Y.Array<any>} */ (cloned.getType())
  
  // Verify clone has same content
  t.assert(clonedType.length === 3, 'Cloned array should have same length')
  t.assert(clonedType.get(0) === 'item1', 'Cloned array should have same content')
  
  // Verify clone is independent
  originalType.push(['item4'])
  t.assert(originalType.length === 4, 'Original should have 4 items')
  t.assert(clonedType.length === 3, 'Clone should still have 3 items')
  
  // Verify clone has same root block
  t.assert(cloned.getRootBlock() === rootBlock, 'Clone should have same root block')
}

/**
 * @param {t.TestCase} tc
 */
export const testContentBlockRef = tc => {
  const store = new Y.NanoStore()
  const rootBlock = store.getRootBlockOrCreate('root', 'map')
  const rootType = /** @type {Y.Map<any>} */ (rootBlock.getType())
  
  // Create a child block
  const childBlock = rootBlock.createBlock('array')
  const childType = /** @type {Y.Array<any>} */ (childBlock.getType())
  childType.push(['a', 'b', 'c'])
  
  // Create a reference to the child block
  rootType.set('ref', childType)
  
  // Verify the reference works
  const ref = /** @type {Y.Array<any>} */ (rootType.get('ref'))
  t.assert(ref === childType, 'Reference should point to child type')
  t.assert(ref.toArray().join(',') === 'a,b,c', 'Referenced array should have correct content')
  
  // Verify block relationship
  t.assert(childBlock.getRootBlock() === rootBlock, 'Child block should reference root block')
}

/**
 * @param {t.TestCase} tc
 */
export const testTransactionBlocksAdded = tc => {
  const store = new Y.NanoStore()
  const rootBlock = store.getRootBlockOrCreate('root', 'map')
  
  let blocksAdded = 0
  
  rootBlock.transact(() => {
    // Create multiple blocks in a transaction
    rootBlock.createBlock('array')
    rootBlock.createBlock('map')
    rootBlock.createBlock('text')
    
    if (store._transaction && store._transaction.blocksAdded) {
      blocksAdded = store._transaction.blocksAdded.size
    }
  })
  
  t.assert(blocksAdded === 3, 'Transaction should track 3 blocks added')
}
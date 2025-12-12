# @paperxlab/yjs

This fork adds document-reference features on top of upstream Yjs. Core CRDT behavior matches upstream; **only fork-specific APIs and behaviors are documented here**. For upstream docs, see https://github.com/yjs/yjs.

## Install

```bash
npm install @paperxlab/yjs
```

## Added/Changed Highlights

- Root Doc and referenced Doc bundle to split large documents and link by reference.
- `autoRef` / `createRef` flags to embed nested types as references.
- New content types `ContentDocRef` / `ContentDocUnref` to track reference lifecycle (included in encoding).
- Root Transaction events to observe changes across all docs under a root.

Details below.

### Root Doc and referenced Docs

- Create a root Doc with `new Y.Doc({ root: true, autoRef })`. A `root: true` Doc owns referenced docs via `rootDoc`.
- Docs born as references are registered in `rootDoc.refDocs` and can be resolved with `rootDoc.getRefDoc(guid)`.
- `refDocs` is separate from the subdoc mechanism and only manages docs behind `ContentDocRef`.
- A non-root Doc (`root: false`) behaves like upstream but doesn’t run reference logic or Root Transaction events. Use `root: true` when you need references.

### Treating nested types as references (`autoRef` / `createRef`)

- All Y types (`Y.Map`, `Y.Array`, `Y.Text`, `Y.Xml*`, …) now expose a `createRef` flag.
- With `autoRef: true` on the root Doc, nested types without `createRef` set are automatically stored as references instead of deep-embedded.
- `createRef` explicitly overrides the automatic rule.

```js
const root = new Y.Doc({ root: true, autoRef: true })
const page = root.getMap('page')

const section = new Y.Array()
page.set('section', section)      // Stored as ContentDocRef; section.doc is a separate Doc

const inline = new Y.Map()
inline.createRef = false
page.set('inline', inline)        // Deep-embedded (upstream behavior)
```

### ContentDocRef / ContentDocUnref behavior

- When stored as a reference, `ContentDocRef` is created and the target Doc is registered in `rootDoc.refDocs`. Reads still return a Y.Type, but its `doc` is the referenced Doc.
- Reusing the same type instance in multiple placements is treated as a conflict; the fork clones the Doc so each placement gets its own copy.
- Referencing a root Doc throws. Cycles between nested docs are pruned automatically by removing the offending reference.
- Deleting a reference: the target Doc’s `_unrefs` (`Y.Array`) receives a `ContentDocUnref`, and `doc._referrer` is cleared. This is useful for storage-side unref handling.
- `ContentDocRef` / `ContentDocUnref` are part of the update binary, so syncing works only between this fork’s peers (not binary-compatible with upstream Yjs).

### Page Property & Clone-on-Move

- `Doc` instances now have a `page` property (string | null).
- When a new reference is created, it inherits the `page` property from its parent document.
- **Clone-on-Move**: If a referenced document is moved (re-integrated) into a parent document with a different `page` value, the referenced document is automatically **cloned**.
  - A new `Doc` with a new GUID is created.
  - The content is deep-copied.
  - The reference in the new location points to this new clone.
  - This ensures that subdocuments belonging to a specific "page" stay isolated when moved to another context.

```js
const root = new Y.Doc({ root: true, autoRef: true })

// Create a page doc
const page1 = root.getMap('page1')
page1.doc.page = 'page-1'

// Create a subdoc inside page1
const subdoc = new Y.Map()
page1.set('sub', subdoc)
// subdoc.doc.page is automatically 'page-1'

// Move subdoc to another page
const page2 = root.getMap('page2')
page2.doc.page = 'page-2'

// This triggers a clone because of page mismatch ('page-1' vs 'page-2')
page2.set('sub-copy', subdoc)

const subdocCopy = page2.get('sub-copy')
// subdocCopy.doc.guid !== subdoc.doc.guid
// subdocCopy.doc.page === 'page-2'
```

### Root Transaction events

Root Docs expose events that bundle changes across all docs under the root:

- `beforeAllRootTransactions(rootDoc)`
- `beforeRootTransaction(rootTransaction, rootDoc)`
- `beforeRootObserverCalls(rootTransaction, rootDoc)`
- `afterAllObserverCalls(rootDoc, events, rootTransaction)` — aggregated counterpart of per-transaction afterTransaction
- `afterRootTransaction(rootTransaction, rootDoc)`
- `afterRootTransactionCleanup(rootTransaction, rootDoc)`
- `afterAllRootTransactions(rootDoc, Array<RootTransaction>)`
- `updateV2Root(updates: Map<Doc, Uint8Array>, origin, rootDoc, rootTransaction)` — V2 updates grouped per Doc under the root.

Use these if your provider needs root-level change detection or reference-aware syncing.

### Operational Notes

- Updates containing `ContentDocRef` cannot be decoded by upstream Yjs. Sync only between this fork’s peers.
- To keep legacy/upstream-compatible embedding, set `autoRef: false` and avoid `createRef`.
- Reference targets also need updates; ensure your storage/provider syncs docs listed in `rootDoc.refDocs`.

export type LocalDraft = {
    key: string
    title: string
    content: string
    updatedAt: number
}

const DB_NAME = 'online-notes'
const DB_VERSION = 1
const STORE_NAME = 'drafts'

function isBrowser(): boolean {
    return typeof window !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!isBrowser() || !('indexedDB' in window)) {
            reject(new Error('IndexedDB not available'))
            return
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' })
            }
        }

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    })
}

function runTx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    return openDb().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, mode)
                const store = tx.objectStore(STORE_NAME)

                let request: IDBRequest<T> | undefined
                try {
                    const maybeReq = fn(store)
                    if (maybeReq && 'onsuccess' in maybeReq) {
                        request = maybeReq as IDBRequest<T>
                    }
                } catch (e) {
                    reject(e)
                    return
                }

                tx.oncomplete = () => {
                    db.close()
                    if (!request) resolve(undefined)
                }
                tx.onerror = () => {
                    const err = tx.error ?? request?.error
                    db.close()
                    reject(err ?? new Error('IndexedDB transaction failed'))
                }

                if (request) {
                    request.onsuccess = () => resolve(request!.result)
                    request.onerror = () => reject(request!.error ?? new Error('IndexedDB request failed'))
                }
            }),
    )
}

export async function putDraft(draft: LocalDraft): Promise<void> {
    await runTx('readwrite', (store) => {
        store.put(draft)
    })
}

export async function getDraft(key: string): Promise<LocalDraft | null> {
    const res = await runTx<LocalDraft>('readonly', (store) => store.get(key))
    return res ?? null
}

export async function removeDraft(key: string): Promise<void> {
    await runTx('readwrite', (store) => {
        store.delete(key)
    })
}

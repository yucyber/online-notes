const fetchCache = new Map<string, Promise<any>>()

export function fetchResource(type: 'mindmap' | 'board', id: string) {
    const key = `${type}:${id}`
    if (fetchCache.has(key)) return fetchCache.get(key)!
    const p = fetch(`/api/${type}s/${id}`).then(res => {
        if (!res.ok) throw new Error('fetch failed')
        return res.json()
    }).finally(() => {
        fetchCache.delete(key)
    })
    fetchCache.set(key, p)
    return p
}

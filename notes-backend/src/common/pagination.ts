// 分页响应的标准结构，统一 notes / categories / tags 等列表端点的返回格式。
export interface PagedResponse<T> {
  items: T[]
  page: number
  size: number
  total: number
  nextCursor?: string
}

export function buildPagedResponse<T>(
  items: T[],
  total: number,
  page: number,
  size: number,
  getCursor?: (last: T) => string | undefined,
): PagedResponse<T> {
  const nextCursor = getCursor && items.length > 0 ? getCursor(items[items.length - 1]) : undefined
  return { items, page, size, total, ...(nextCursor ? { nextCursor } : {}) }
}

import { getAIMindMapData } from '@/lib/ai-client'

const mockFetch = jest.fn()

describe('getAIMindMapData', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: mockFetch })
  })

  it.each([
    ['已解包响应', { content: { nodeData: { id: 'root', topic: '前端' } } }],
    ['后端统一响应 envelope', { code: 0, data: { content: { nodeData: { id: 'root', topic: '前端' } } } }],
  ])('从%s读取思维导图内容', async (_label, responseBody) => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => responseBody } as Response)

    await expect(getAIMindMapData('前端')).resolves.toEqual({
      nodeData: { id: 'root', topic: '前端' },
    })
  })

  it('成功响应缺少 content 时拒绝伪造空图谱', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: {} }) } as Response)

    await expect(getAIMindMapData('前端')).rejects.toThrow('No AI response was returned')
  })
})


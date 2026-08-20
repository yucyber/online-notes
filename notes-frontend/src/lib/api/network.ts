import api from './client'

// 网络状态相关 API
export const networkAPI = {
  // 尝试 ping 健康检查端点，失败则回退到轻量请求
  ping: async (): Promise<{ ok: boolean; latency: number; status?: number }> => {
    const start = Date.now()
    try {
      await api.get('/health')
      const latency = Date.now() - start
      return { ok: true, latency, status: 200 }
    } catch {
      // 回退：请求最小数据以检测连通性
      try {
        const start2 = Date.now()
        await api.get('/notes', { params: new URLSearchParams({ size: '1' }) })
        const latency = Date.now() - start2
        return { ok: true, latency, status: 200 }
      } catch (err: any) {
        const latency = Date.now() - start
        const status = err?.response?.status
        return { ok: false, latency, status }
      }
    }
  },
}

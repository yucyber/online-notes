import { render, screen } from '@testing-library/react'
import { AiRunWaterfall } from '@/components/settings/AiRunWaterfall'

describe('AiRunWaterfall 阶段模型标注', () => {
  it('在模型调用阶段展示所用模型，并区分首次调用与降级', () => {
    render(
      <AiRunWaterfall
        stages={[
          { name: 'provider', durationMs: 127000, status: 'succeeded', attempt: 1, provider: 'siliconflow', model: 'Qwen/Qwen3-14B' },
          { name: 'provider', durationMs: 240000, status: 'failed', attempt: 2, provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4-Flash', fallbackType: 'quality' },
          { name: 'validation', durationMs: 3, status: 'succeeded' },
        ]}
      />,
    )

    expect(screen.getAllByText('模型调用').length).toBeGreaterThan(0)
    expect(screen.getByText('Qwen/Qwen3-14B')).toBeInTheDocument()
    expect(screen.getByText('deepseek-ai/DeepSeek-V4-Flash')).toBeInTheDocument()
    expect(screen.getByText('首次调用')).toBeInTheDocument()
    expect(screen.getByText('第 2 次 · 降级·质量')).toBeInTheDocument()
  })
})

import React from 'react'

export interface TagChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

// 胶囊态标签，用于分类/标签等可点选、带选中态的轻量条目。
// 选中态为灰蓝实心，与项目 accent token 对齐。
const TagChip = React.forwardRef<HTMLButtonElement, TagChipProps>(
  ({ className, active = false, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 h-[30px] px-[10px] rounded-full border text-[12px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
        active
          ? 'border-[var(--product-accent)] bg-[var(--product-accent)] text-white'
          : 'border-[var(--product-line)] bg-[var(--product-panel)] text-[var(--product-text-secondary)] hover:border-[var(--product-line-strong)] hover:bg-[var(--product-surface-hover)] hover:text-[var(--product-text)]'
      } ${className || ''}`}
      {...props}
    />
  ),
)
TagChip.displayName = 'TagChip'

export { TagChip }

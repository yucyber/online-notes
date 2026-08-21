import React from 'react'

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'ghost-danger' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'xs' | 'icon'
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild: _asChild, ...props }, ref) => {
    const variants = {
      default: 'border-transparent bg-[#263244] text-white hover:bg-[#344256]',
      destructive: 'border-transparent bg-[var(--product-danger)] text-white hover:opacity-90',
      outline: 'border-[var(--product-line)] bg-[var(--product-panel)] text-[var(--product-text-secondary)] hover:border-[var(--product-accent-line)] hover:bg-[var(--product-accent-soft)] hover:text-[var(--product-accent)]',
      secondary: 'border-[var(--product-line-soft)] bg-[var(--product-panel-soft)] text-[var(--product-text)] hover:bg-[var(--product-accent-soft)]',
      ghost: 'border-transparent bg-transparent text-[var(--product-text-secondary)] hover:bg-[var(--product-accent-soft)] hover:text-[var(--product-accent)]',
      'ghost-danger': 'border-transparent bg-transparent text-[var(--product-danger)] hover:bg-[var(--product-danger-soft)]',
      link: 'border-transparent bg-transparent text-[var(--product-accent)] underline-offset-4 hover:underline',
    }
    const sizes = {
      default: 'h-11 px-4 rounded-[10px]', sm: 'h-11 px-3 text-[13px] rounded-[10px]', lg: 'h-12 px-6 rounded-[10px]', xs: 'h-7 px-2 text-[12px] rounded-[8px]', icon: 'h-11 w-11 p-0 rounded-[10px]',
    }
    return <button ref={ref} className={`inline-flex items-center justify-center gap-2 rounded-[10px] border text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--product-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className || ''}`} {...props} />
  },
)
Button.displayName = 'Button'

export { Button }

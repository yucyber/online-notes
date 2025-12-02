import React from 'react'

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'default',
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      asChild,
      style: customStyle,
      onMouseEnter,
      onMouseLeave,
      ...props
    },
    ref
  ) => {
    const [isHovered, setIsHovered] = React.useState(false);
    
    // 基础样式
    const baseStyles: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '12px',
      fontSize: '14px',
      fontWeight: 500,
      position: 'relative',
      overflow: 'hidden',
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
    };
    
    // 尺寸样式（符合可触达区域 ≥44px 标准）
    const sizeStyles: Record<string, React.CSSProperties> = {
      default: { height: '44px', padding: '0 16px' },
      sm: { height: '44px', padding: '0 12px', fontSize: '13px' },
      lg: { height: '48px', padding: '0 32px' },
      icon: { height: '44px', width: '44px', padding: 0 },
    };
    
    // 变体样式
    const variantStyles: Record<string, React.CSSProperties> = {
      default: {
        background: isHovered 
          ? 'linear-gradient(to right, #1d4ed8, #1e40af)' 
          : 'linear-gradient(to right, #2563eb, #1d4ed8)',
        color: '#ffffff',
        boxShadow: isHovered 
          ? '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)'
          : '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        transform: isHovered ? 'translateY(-2px)' : 'none',
      },
      destructive: {
        background: isHovered 
          ? 'linear-gradient(to right, #dc2626, #b91c1c)' 
          : 'linear-gradient(to right, #ef4444, #dc2626)',
        color: '#ffffff',
        boxShadow: isHovered 
          ? '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)'
          : '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        transform: isHovered ? 'translateY(-2px)' : 'none',
      },
      outline: {
        background: isHovered ? '#f9fafb' : '#ffffff',
        color: isHovered ? '#2563eb' : '#374151',
        border: '2px solid',
        borderColor: isHovered ? '#2563eb' : '#e5e7eb',
        boxShadow: isHovered 
          ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)'
          : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        transform: isHovered ? 'translateY(-2px)' : 'none',
      },
      secondary: {
        background: isHovered ? '#e5e7eb' : '#f3f4f6',
        color: '#111827',
        boxShadow: isHovered 
          ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)'
          : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        transform: isHovered ? 'translateY(-2px)' : 'none',
      },
      ghost: {
        background: isHovered ? '#f3f4f6' : 'transparent',
        color: isHovered ? '#111827' : '#4b5563',
      },
      link: {
        background: 'transparent',
        color: '#2563eb',
        textDecoration: isHovered ? 'underline' : 'none',
        textUnderlineOffset: '4px',
      },
    };
    
    const combinedStyles: React.CSSProperties = {
      ...baseStyles,
      ...sizeStyles[size],
      ...variantStyles[variant],
      ...(customStyle || {}),
    };
    
    // 禁用状态
    if (props.disabled) {
      combinedStyles.opacity = 0.5;
      combinedStyles.cursor = 'not-allowed';
      combinedStyles.pointerEvents = 'none';
    }

    const handleMouseEnter = (event: React.MouseEvent<HTMLButtonElement>) => {
      setIsHovered(true);
      onMouseEnter?.(event);
    };

    const handleMouseLeave = (event: React.MouseEvent<HTMLButtonElement>) => {
      setIsHovered(false);
      onMouseLeave?.(event);
    };

    // 点击动画：轻微压缩与阴影增强，150ms 自动恢复
    const [isActive, setIsActive] = React.useState(false)
    const handleMouseDown = () => {
      setIsActive(true)
      setTimeout(() => setIsActive(false), 150)
    }

    if (isActive) {
      combinedStyles.transform = 'scale(0.98)'
      combinedStyles.boxShadow = '0 12px 18px -6px rgba(0,0,0,0.2), 0 8px 12px -8px rgba(0,0,0,0.15)'
    }

    // 焦点可见性
    const [isFocused, setIsFocused] = React.useState(false)
    if (isFocused) {
      combinedStyles.outline = '2px solid rgba(59,130,246,0.35)'
      combinedStyles.boxShadow = '0 0 0 2px rgba(59,130,246,0.25)'
    }

    return (
      <button
        ref={ref}
        className={className || ''}
        style={combinedStyles}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }

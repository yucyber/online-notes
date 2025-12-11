import React from 'react'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false);
    
    const baseStyles: React.CSSProperties = {
      display: 'flex',
      height: '44px',
      width: '100%',
      borderRadius: '12px',
      border: '1px solid',
      borderColor: isFocused ? 'var(--primary-600)' : 'var(--border)',
      backgroundColor: 'var(--surface-1)',
      padding: '0 16px',
      fontSize: '14px',
      outline: isFocused ? '2px solid var(--primary-600)' : 'none',
      transition: 'all 0.2s ease',
      boxShadow: isFocused 
        ? '0 0 0 2px rgba(0,0,0,0.05)'
        : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    };
    
    if (props.disabled) {
      baseStyles.opacity = 0.5;
      baseStyles.cursor = 'not-allowed';
    }
    
    return (
      <input
        type={type}
        ref={ref}
        className={className || ''}
        style={baseStyles}
        onFocus={(e) => {
          setIsFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          props.onBlur?.(e);
        }}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }

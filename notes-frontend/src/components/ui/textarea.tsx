import React from 'react'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false);
    
    const baseStyles: React.CSSProperties = {
      display: 'flex',
      minHeight: '100px',
      width: '100%',
      borderRadius: '12px',
      border: '1px solid',
      borderColor: isFocused ? 'var(--primary-600)' : 'var(--border)',
      backgroundColor: 'var(--surface-1)',
      padding: '12px 16px',
      fontSize: '14px',
      outline: 'none',
      transition: 'all 0.2s ease',
      boxShadow: isFocused 
        ? '0 0 0 2px rgba(36,104,242,0.25)'
        : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      WebkitBoxShadow: isFocused 
        ? '0 0 0 2px rgba(36,104,242,0.25)'
        : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      MozBoxShadow: isFocused 
        ? '0 0 0 2px rgba(36,104,242,0.25)'
        : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      resize: 'none',
    };
    
    if (props.disabled) {
      baseStyles.opacity = 0.5;
      baseStyles.cursor = 'not-allowed';
    }
    
    return (
      <textarea
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
Textarea.displayName = 'Textarea'

export { Textarea }

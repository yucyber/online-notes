import React from 'react'

export type CardProps = React.HTMLAttributes<HTMLDivElement>

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    const [isHovered, setIsHovered] = React.useState(false);
    
    return (
      <div
        ref={ref}
        style={{
          borderRadius: '12px',
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: isHovered ? 'rgba(59, 130, 246, 0.5)' : '#e5e7eb',
          backgroundColor: '#ffffff',
          color: '#111827',
          boxShadow: isHovered 
            ? '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
            : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          WebkitBoxShadow: isHovered 
            ? '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
            : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          MozBoxShadow: isHovered 
            ? '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
            : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          transform: isHovered ? 'translateY(-4px) scale(1.02)' : 'none',
          WebkitTransform: isHovered ? 'translateY(-4px) scale(1.02)' : 'none',
          MozTransform: isHovered ? 'translateY(-4px) scale(1.02)' : 'none',
          msTransform: isHovered ? 'translateY(-4px) scale(1.02)' : 'none',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          WebkitTransition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          MozTransition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          cursor: 'pointer',
        }}
        className={className || ''}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        {...props}
      />
    );
  }
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`flex flex-col space-y-1.5 p-6 ${className || ''}`}
    {...props}
  />
))
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={`text-2xl font-semibold leading-none tracking-tight ${className || ''}`}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={`text-sm text-gray-500 ${className || ''}`}
    {...props}
  />
))
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={`p-6 pt-0 ${className || ''}`} {...props} />
))
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`flex items-center p-6 pt-0 ${className || ''}`}
    {...props}
  />
))
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
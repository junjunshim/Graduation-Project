import {
  forwardRef,
  type ButtonHTMLAttributes,
  type MouseEventHandler,
} from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'icon'

type ButtonStyleProps = {
  className?: string
  variant?: ButtonVariant
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleProps

export type ButtonLinkProps = Omit<LinkProps, 'aria-disabled'> & ButtonStyleProps & {
  'aria-disabled'?: boolean
}

const variantClassNames: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  icon: styles.icon,
}

function getButtonClassName(variant: ButtonVariant, className?: string) {
  return [styles.button, variantClassNames[variant], className].filter(Boolean).join(' ')
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    type = 'button',
    variant = 'secondary',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={getButtonClassName(variant, className)}
      {...props}
    />
  )
})

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  {
    'aria-disabled': ariaDisabled = false,
    className,
    onClick,
    tabIndex,
    variant = 'secondary',
    ...props
  },
  ref,
) {
  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (ariaDisabled) {
      event.preventDefault()
      return
    }

    onClick?.(event)
  }

  return (
    <Link
      ref={ref}
      aria-disabled={ariaDisabled || undefined}
      className={getButtonClassName(variant, className)}
      onClick={handleClick}
      tabIndex={ariaDisabled ? -1 : tabIndex}
      {...props}
    />
  )
})

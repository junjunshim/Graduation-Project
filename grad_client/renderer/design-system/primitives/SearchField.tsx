import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
} from 'react'
import { Icon } from './Icon'
import styles from './SearchField.module.css'

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> & {
  className?: string
  containerClassName?: string
  label: string
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    className,
    containerClassName,
    id,
    label,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <label className={[styles.field, containerClassName].filter(Boolean).join(' ')} htmlFor={inputId}>
      <span className={styles.visuallyHidden}>{label}</span>
      <input
        ref={ref}
        id={inputId}
        type="search"
        className={[styles.input, className].filter(Boolean).join(' ')}
        {...props}
      />
      <Icon name="search" size={19} />
    </label>
  )
})

import { splitProps, type JSX } from 'solid-js'

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The three weights the page needs; the palette comes from the tokens. */
  readonly variant?: 'default' | 'primary'
}

/**
 * The button shadcn-solid ships, wearing this page's palette. A copy rather
 * than a package: the component is ours to change, which is the point of the
 * copy-in the port decided on.
 */
export const Button = (props: ButtonProps) => {
  const [local, rest] = splitProps(props, ['variant', 'class'])
  return (
    <button
      {...rest}
      class={[
        'inline-flex cursor-pointer items-center gap-2 rounded-[8px] border px-[14px] py-[7px] text-[13px] leading-none transition-colors',
        local.variant === 'primary'
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)] hover:border-[var(--accent)]'
          : 'border-[var(--line)] bg-[var(--panel-2)] text-[var(--text)] hover:border-[var(--dim)]',
        local.class ?? '',
      ].join(' ')}
    />
  )
}

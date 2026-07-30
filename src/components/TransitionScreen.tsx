export function TransitionScreen({
  message,
  overlay = false,
}: {
  message: string
  overlay?: boolean
}) {
  return (
    <div
      className={`transition-screen${overlay ? ' environment-transition' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="transition-brand" aria-hidden="true">AW</span>
      <strong>Agent Wallet</strong>
      <span className="transition-spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

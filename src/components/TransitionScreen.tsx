export function TransitionScreen({ message }: { message: string }) {
  return (
    <div className="transition-screen" role="status" aria-live="polite">
      <span className="transition-brand" aria-hidden="true">AW</span>
      <strong>Agent Wallet</strong>
      <span className="transition-spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

import { LoaderCircle, WalletCards } from 'lucide-react'

export function TransitionScreen({ message }: { message: string }) {
  return (
    <main className="transition-screen" role="status" aria-live="polite">
      <span className="transition-brand"><WalletCards size={22} /></span>
      <strong>Agent Wallet</strong>
      <LoaderCircle className="transition-spinner" size={22} />
      <span>{message}</span>
    </main>
  )
}

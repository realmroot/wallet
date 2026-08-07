import * as Dialog from '@radix-ui/react-dialog'
import { Trash2, X } from 'lucide-react'
import { useState } from 'react'

export function DeleteGrantDialog({
  agentLabel,
  busy,
  onConfirm,
}: {
  agentLabel: string
  busy: boolean
  onConfirm: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)

  async function confirmDeletion() {
    await onConfirm()
    setOpen(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !busy && setOpen(nextOpen)}>
      <Dialog.Trigger asChild>
        <button className="quiet-button destructive" disabled={busy}>
          <Trash2 size={15} /> Delete
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="backdrop" />
        <Dialog.Content className="dialog delete-dialog">
          <Dialog.Close className="dialog-close" disabled={busy} aria-label="Close delete confirmation">
            <X size={18} />
          </Dialog.Close>
          <div className="delete-dialog-icon" aria-hidden="true">
            <Trash2 size={20} />
          </div>
          <p className="eyebrow">Permanent removal</p>
          <Dialog.Title>Delete {agentLabel}’s budget?</Dialog.Title>
          <Dialog.Description>
            The budget will immediately disappear from Wallet and API responses. Its database record
            is retained for audit purposes, but this budget cannot be restored.
          </Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button className="secondary-button" disabled={busy}>Cancel</button>
            </Dialog.Close>
            <button
              className="danger-button danger-confirm"
              disabled={busy}
              onClick={() => void confirmDeletion()}
            >
              {busy ? 'Deleting…' : 'Delete Agent budget'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

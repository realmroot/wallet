import type { AgentGrant, UpdateGrantInput } from '../../../shared/contracts'
import { fromAtomic, toDateTimeLocal } from '../../lib/format'
import { PolicyFields, policyFormSchema, toPolicyInput, type PolicyFormValues } from './policy-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as Dialog from '@radix-ui/react-dialog'
import { useForm } from 'react-hook-form'
import { X } from 'lucide-react'

export function GrantDialog({
  grant,
  busy,
  onClose,
  onSave,
}: {
  grant: AgentGrant
  busy: boolean
  onClose: () => void
  onSave: (input: UpdateGrantInput) => Promise<void>
}) {
  const form = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: {
      totalLimit: fromAtomic(grant.totalLimit),
      perTransactionLimit: fromAtomic(grant.perTransactionLimit),
      periodKind: grant.periodKind,
      periodLimit: grant.periodLimit ? fromAtomic(grant.periodLimit) : '1',
      allowedOrigins: grant.allowedOrigins.join('\n'),
      allowedRecipients: grant.allowedRecipients.join('\n'),
      expiresAt: grant.expiresAt ? toDateTimeLocal(new Date(grant.expiresAt)) : '',
    },
  })

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="backdrop" />
        <Dialog.Content className="dialog">
          <Dialog.Close className="dialog-close" aria-label="Close spending rules">
            <X size={18} />
          </Dialog.Close>
          <p className="eyebrow">Agent budget</p>
          <Dialog.Title>Edit spending rules</Dialog.Title>
          <Dialog.Description className="muted">
            Changes apply to future payment authorizations.
          </Dialog.Description>
          <form onSubmit={form.handleSubmit(async (values) => onSave(toPolicyInput(values)))}>
            <PolicyFields register={form.register} errors={form.formState.errors} />
            <div className="approval-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" type="button">Cancel</button>
              </Dialog.Close>
              <button className="primary-button" disabled={busy || form.formState.isSubmitting} type="submit">
                {busy || form.formState.isSubmitting ? 'Saving…' : 'Save rules'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

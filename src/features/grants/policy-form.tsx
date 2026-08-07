import type { UpdateGrantInput } from '../../../shared/contracts'
import { toAtomic } from '../../lib/format'
import type { UseFormRegister, FieldErrors } from 'react-hook-form'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { toDateTimeLocal } from '../../lib/format'

const decimalAmount = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/, 'Enter a positive USDC amount with at most 6 decimals.')
  .refine((value) => BigInt(toAtomic(value)) > 0n, 'Amount must be greater than zero.')

export const policyFormSchema = z
  .object({
    totalLimit: decimalAmount,
    perTransactionLimit: decimalAmount,
    periodKind: z.enum(['none', 'daily', 'monthly']),
    periodLimit: z.string(),
    allowedOrigins: z.string(),
    allowedRecipients: z.string(),
    expiresAt: z.string(),
  })
  .superRefine((value, context) => {
    if (value.periodKind !== 'none') {
      const result = decimalAmount.safeParse(value.periodLimit)
      if (!result.success) {
        context.addIssue({
          code: 'custom',
          path: ['periodLimit'],
          message: result.error.issues[0]?.message ?? 'Period limit is invalid.',
        })
      }
    }
    for (const origin of splitLines(value.allowedOrigins)) {
      try {
        if (new URL(origin).origin !== origin) throw new Error()
      } catch {
        context.addIssue({ code: 'custom', path: ['allowedOrigins'], message: `Invalid origin: ${origin}` })
      }
    }
    for (const recipient of splitLines(value.allowedRecipients)) {
      if (
        !/^0x[0-9a-fA-F]{40}$/.test(recipient) &&
        !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['allowedRecipients'],
          message: `Invalid recipient address: ${recipient}`,
        })
      }
    }
    if (value.expiresAt && Number.isNaN(new Date(value.expiresAt).getTime())) {
      context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiration date is invalid.' })
    }
  })

export type PolicyFormValues = z.input<typeof policyFormSchema>

export function toPolicyInput(values: PolicyFormValues): UpdateGrantInput {
  return {
    totalLimit: toAtomic(values.totalLimit),
    perTransactionLimit: toAtomic(values.perTransactionLimit),
    periodKind: values.periodKind,
    periodLimit: values.periodKind === 'none' ? null : toAtomic(values.periodLimit),
    allowedOrigins: splitLines(values.allowedOrigins).map((entry) => new URL(entry).origin),
    allowedRecipients: splitLines(values.allowedRecipients).map((entry) => entry.toLowerCase()),
    expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
  }
}

export function PolicyFields({
  register,
  errors,
  minimumAmount = '0.000001',
  requireExpiration = false,
}: {
  register: UseFormRegister<PolicyFormValues>
  errors: FieldErrors<PolicyFormValues>
  minimumAmount?: string
  requireExpiration?: boolean
}) {
  return (
    <>
      <div className="field-grid">
        <Field label="Total USDC" error={errors.totalLimit?.message}>
          <input
            {...register('totalLimit')}
            type="number"
            min={minimumAmount}
            step="0.000001"
            aria-invalid={Boolean(errors.totalLimit)}
          />
        </Field>
        <Field label="Per payment" error={errors.perTransactionLimit?.message}>
          <input
            {...register('perTransactionLimit')}
            type="number"
            min={minimumAmount}
            step="0.000001"
            aria-invalid={Boolean(errors.perTransactionLimit)}
          />
        </Field>
      </div>
      <Field label="Allowed merchant origins" error={errors.allowedOrigins?.message}>
        <textarea
          {...register('allowedOrigins')}
          rows={3}
          placeholder={'https://api.example.com\nLeave empty to allow any merchant'}
          aria-invalid={Boolean(errors.allowedOrigins)}
        />
      </Field>
      <Field label="Allowed recipient addresses" error={errors.allowedRecipients?.message}>
        <textarea
          {...register('allowedRecipients')}
          rows={3}
          placeholder={'0x… or Solana address\nLeave empty to allow any recipient'}
          aria-invalid={Boolean(errors.allowedRecipients)}
        />
      </Field>
      <Field label="Authorization expires" error={errors.expiresAt?.message}>
        <input
          {...register('expiresAt')}
          type="datetime-local"
          min={toDateTimeLocal(new Date())}
          required={requireExpiration}
          aria-invalid={Boolean(errors.expiresAt)}
        />
      </Field>
      <div className="field-grid">
        <Field label="Reset period" error={errors.periodKind?.message}>
          <select {...register('periodKind')}>
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
            <option value="none">No periodic limit</option>
          </select>
        </Field>
        <Field label="Period limit (USDC)" error={errors.periodLimit?.message}>
          <input
            {...register('periodLimit')}
            type="number"
            min={minimumAmount}
            step="0.000001"
            aria-invalid={Boolean(errors.periodLimit)}
          />
        </Field>
      </div>
    </>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label>
      {label}
      {children}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  )
}

function splitLines(value: string) {
  return [...new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean))]
}

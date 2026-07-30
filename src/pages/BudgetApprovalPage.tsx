import { decideBudgetRequest, inspectBudgetRequest } from '../api'
import type { PublicConfig } from '../auth'
import { hasToken } from '../auth'
import { PolicyFields, policyFormSchema, toPolicyInput, type PolicyFormValues } from '../features/grants/policy-form'
import { toDateTimeLocal } from '../lib/format'
import { LoginPage } from './LoginPage'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation } from 'wouter'

export function BudgetApprovalPage({ config }: { config: PublicConfig }) {
  const [pathname] = useLocation()
  const params = new URLSearchParams(location.hash.slice(1))
  const requestId = params.get('request')
  const approvalToken = params.get('token')
  const validLink = Boolean(requestId && approvalToken)
  const authenticated = hasToken()
  const [result, setResult] = useState<'approved' | 'denied' | null>(null)
  const request = useQuery({
    queryKey: ['budget-request', requestId, approvalToken],
    queryFn: () => inspectBudgetRequest(config, requestId!, approvalToken!),
    enabled: validLink && authenticated,
    retry: false,
  })
  const decision = useMutation({
    mutationFn: (input: Parameters<typeof decideBudgetRequest>[2]) =>
      decideBudgetRequest(config, requestId!, input),
    onSuccess: (_, input) => setResult(input.decision === 'approve' ? 'approved' : 'denied'),
  })

  if (!validLink) {
    return <CenteredNotice error>This budget approval link is invalid.</CenteredNotice>
  }
  if (!authenticated) {
    return (
      <LoginPage
        config={config}
        returnTo={`${pathname}${location.hash}`}
        error={request.error?.message}
      />
    )
  }
  if (result) {
    return (
      <main className="center">
        <div className="approval-card">
          <p className="eyebrow">Request {result}</p>
          <h2>{result === 'approved' ? 'The Agent can now use its budget.' : 'No budget was granted.'}</h2>
          <p className="muted">You can close this page and return to the Agent.</p>
          <Link className="primary button-link" to="/">Open wallet</Link>
        </div>
      </main>
    )
  }
  if (request.error) return <CenteredNotice error>{request.error.message}</CenteredNotice>
  if (request.isPending || !request.data) return <main className="center">Loading request…</main>
  if (request.data.status !== 'pending') {
    return <CenteredNotice>This request is already {request.data.status}.</CenteredNotice>
  }

  return (
    <ApprovalForm
      requestedName={request.data.requestedName}
      agentSubject={request.data.agentSubject}
      busy={decision.isPending}
      error={decision.error?.message}
      onApprove={(values) =>
        decision.mutateAsync({
          decision: 'approve',
          approvalToken: approvalToken!,
          ...toPolicyInput(values),
        })
      }
      onDeny={() => decision.mutateAsync({ decision: 'deny', approvalToken: approvalToken! })}
    />
  )
}

function ApprovalForm({
  requestedName,
  agentSubject,
  busy,
  error,
  onApprove,
  onDeny,
}: {
  requestedName: string | null
  agentSubject: string
  busy: boolean
  error?: string
  onApprove: (values: PolicyFormValues) => Promise<unknown>
  onDeny: () => Promise<unknown>
}) {
  const form = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: {
      name: requestedName ?? 'Local Agent',
      totalLimit: '10',
      perTransactionLimit: '1',
      periodKind: 'daily',
      periodLimit: '3',
      allowedOrigins: '',
      allowedRecipients: '',
      expiresAt: toDateTimeLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    },
  })

  return (
    <main className="center approval-shell">
      <form className="approval-card" onSubmit={form.handleSubmit(onApprove)}>
        <p className="eyebrow">Agent budget request</p>
        <h2>Allow this Agent to spend?</h2>
        <div className="identity-card">
          <span>Agent identity</span>
          <code>{agentSubject}</code>
        </div>
        <PolicyFields
          register={form.register}
          errors={form.formState.errors}
          minimumAmount="0.001"
          requireExpiration
        />
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="approval-actions">
          <button className="ghost" disabled={busy} type="button" onClick={() => void onDeny()}>
            Deny
          </button>
          <button className="primary" disabled={busy || form.formState.isSubmitting} type="submit">
            {busy || form.formState.isSubmitting ? 'Authorizing…' : 'Authorize budget'}
          </button>
        </div>
      </form>
    </main>
  )
}

function CenteredNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <main className="center">
      <div className={`notice${error ? ' error' : ''}`}>{children}</div>
    </main>
  )
}

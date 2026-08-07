import { decideBudgetRequest, inspectBudgetRequest } from '../api'
import type { PublicConfig } from '../auth'
import { hasToken } from '../auth'
import { PolicyFields, policyFormSchema, toPolicyInput, type PolicyFormValues } from '../features/grants/policy-form'
import { toDateTimeLocal } from '../lib/format'
import { useAgentInfo } from '../agent-info'
import { LoginPage } from './LoginPage'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation } from 'wouter'
import { Bot, Check, CircleDollarSign, ShieldCheck, WalletCards, X } from 'lucide-react'

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
      <main className="center approval-result">
        <div className="result-card">
          <span className={`result-icon${result === 'denied' ? ' denied' : ''}`}>
            {result === 'approved' ? <Check size={28} /> : <X size={28} />}
          </span>
          <p className="eyebrow">Request {result}</p>
          <h2>{result === 'approved' ? 'The Agent can now use its budget.' : 'No budget was granted.'}</h2>
          <p className="muted">You can close this page and return to the Agent.</p>
          <Link className="primary-button button-link" to="/">Open wallet</Link>
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
      mode={request.data.mode}
      agentIssuer={request.data.agentIssuer}
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
  mode,
  agentIssuer,
  agentSubject,
  busy,
  error,
  onApprove,
  onDeny,
}: {
  mode: 'production' | 'sandbox'
  agentIssuer: string
  agentSubject: string
  busy: boolean
  error?: string
  onApprove: (values: PolicyFormValues) => Promise<unknown>
  onDeny: () => Promise<unknown>
}) {
  const agentInfo = useAgentInfo(agentIssuer, agentSubject).data
  const form = useForm<PolicyFormValues>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: {
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
    <main className="approval-page">
      <header className="approval-header">
        <a className="wordmark" href="/" aria-label="Agent Wallet home">
          <span className="brand-symbol"><WalletCards size={18} /></span>
          <span>Agent Wallet</span>
        </a>
        <span className="secure-label"><ShieldCheck size={15} /> Secure authorization</span>
      </header>
      <div className="approval-layout">
        <section className="approval-context">
          <p className="eyebrow">{mode === 'sandbox' ? 'Sandbox' : 'Production'} budget request</p>
          <h1>Set the boundary.<br />The Agent stays inside it.</h1>
          <p>
            This Agent is asking for permission to make x402 payments. Review its identity and define exactly
            how much it can spend.
          </p>
          <div className="identity-card">
            <span className="agent-avatar">
              {agentInfo?.picture ? <img src={agentInfo.picture} alt="" /> : <Bot size={20} />}
            </span>
            <div>
              <span>Verified Agent identity</span>
              {agentInfo ? <strong>{agentInfo.name}</strong> : null}
              <code>{agentSubject}</code>
            </div>
            <ShieldCheck size={18} />
          </div>
          <div className="approval-promise">
            <CircleDollarSign size={18} />
            <p><strong>No funds move now.</strong> You are creating a revocable payment policy.</p>
          </div>
        </section>
        <form className="approval-card" onSubmit={form.handleSubmit(onApprove)}>
          <div className="form-heading">
            <p className="eyebrow">{mode === 'sandbox' ? 'Sandbox' : 'Production'} spending policy</p>
            <h2>Allow this Agent to spend?</h2>
            <p>All limits are denominated in USDC.</p>
          </div>
          <PolicyFields
            register={form.register}
            errors={form.formState.errors}
            minimumAmount="0.001"
            requireExpiration
          />
          {error ? <p className="error" role="alert">{error}</p> : null}
          <div className="approval-actions">
            <button className="secondary-button" disabled={busy} type="button" onClick={() => void onDeny()}>
              Deny request
            </button>
            <button className="primary-button" disabled={busy || form.formState.isSubmitting} type="submit">
              {busy || form.formState.isSubmitting ? 'Authorizing…' : 'Authorize budget'}
            </button>
          </div>
        </form>
      </div>
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

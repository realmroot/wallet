export function toAtomic(value: string) {
  const [whole, fraction = ''] = value.split('.')
  return `${whole}${fraction.padEnd(6, '0')}`.replace(/^0+(?=\d)/, '')
}

export function formatUsdc(value: bigint) {
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `$${whole}${fraction ? `.${fraction}` : ''}`
}

export function formatToken(amount: string, decimals: number) {
  if (decimals === 0) return amount
  const normalized = amount.padStart(decimals + 1, '0')
  const whole = normalized.slice(0, -decimals) || '0'
  const fraction = normalized.slice(-decimals).replace(/0+$/, '').slice(0, 6)
  return `${whole}${fraction ? `.${fraction}` : ''}`
}

export function fromAtomic(value: string) {
  return formatToken(value, 6)
}

export function toDateTimeLocal(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function delegationNeedsRenewal(expiresAt: string | null) {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000
}

export function eventLabel(action: string) {
  return action
    .split('.')
    .join(' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

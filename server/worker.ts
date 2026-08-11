import { createApp } from './app'
import { walletBindings } from './runtime-config'
import { reconcileSignedPayments } from './reconciliation'
import { cleanupExpiredReservations } from './repository'

const app = createApp()

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, walletBindings(env), ctx)
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        cleanupExpiredReservations(env.DB),
        reconcileSignedPayments(walletBindings(env)),
      ]).then(([cleaned, reconciliation]) => {
        if (cleaned === 0 && reconciliation.claimed === 0) return
        console.log(
          JSON.stringify({
            message: 'payment maintenance completed',
            cleanedReservations: cleaned,
            reconciliation,
          }),
        )
      }).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            message: 'payment maintenance failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        throw error
      }),
    )
  },
} satisfies ExportedHandler<Cloudflare.Env>

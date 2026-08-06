import { createApp } from './app'
import { walletBindings } from './runtime-config'
import { reconcileExpiredAuthorizations } from './reconciliation'
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
        reconcileExpiredAuthorizations(walletBindings(env)),
      ]).then(([cleaned, reconciled]) => {
        if (cleaned === 0 && reconciled === 0) return
        console.log(
          JSON.stringify({
            message: 'payment maintenance completed',
            cleanedReservations: cleaned,
            reconciledAuthorizations: reconciled,
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

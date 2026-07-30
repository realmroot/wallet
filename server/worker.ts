import { createApp } from './app'
import { reconcileExpiredAuthorizations } from './reconciliation'
import { cleanupExpiredReservations } from './repository'

const app = createApp()

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        cleanupExpiredReservations(env.DB),
        reconcileExpiredAuthorizations(env),
      ]).then(([cleaned, reconciled]) => {
        if (cleaned > 0 || reconciled > 0) {
          console.log(
            JSON.stringify({
              message: 'payment maintenance completed',
              cleanedReservations: cleaned,
              reconciledAuthorizations: reconciled,
            }),
          )
        }
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
} satisfies ExportedHandler<Env>

import { createApp } from './app'
import { resolveWalletRequest, walletEnvironments } from './environment'
import { reconcileExpiredAuthorizations } from './reconciliation'
import { cleanupExpiredReservations } from './repository'

const app = createApp()

export default {
  fetch(request, env, ctx) {
    const resolved = resolveWalletRequest(request, env)
    return app.fetch(resolved.request, resolved.env, ctx)
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      Promise.all(
        walletEnvironments(env).map(async (walletEnv) => ({
          environment: walletEnv.WALLET_ENVIRONMENT,
          cleaned: await cleanupExpiredReservations(walletEnv.DB),
          reconciled: await reconcileExpiredAuthorizations(walletEnv),
        })),
      ).then((results) => {
        for (const { environment, cleaned, reconciled } of results) {
          if (cleaned === 0 && reconciled === 0) continue
          console.log(
            JSON.stringify({
              message: 'payment maintenance completed',
              environment,
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

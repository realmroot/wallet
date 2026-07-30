import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { beforeEach } from 'vitest'

beforeEach(async () => {
  await reset()
  await Promise.all([
    applyD1Migrations(env.DB, env.TEST_MIGRATIONS),
    applyD1Migrations(env.SANDBOX_DB, env.TEST_MIGRATIONS),
  ])
})

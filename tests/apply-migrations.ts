import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { beforeEach } from 'vitest'

beforeEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

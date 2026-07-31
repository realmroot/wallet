import { CdpClient } from '@coinbase/cdp-sdk'
import { activeDelegationOrNull } from '../server/cdp'
import { describe, expect, it } from 'vitest'

const projectId = '11111111-1111-4111-8111-111111111111'
const apiKeySecret =
  'nWGxne/9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2DXWpgBgrEKt9VL/tPJZAc6DuFy89qmIyWvAhpo9wdRGg=='
const walletSecret =
  'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgGisXdi7FbCRHDc09izR4eQWlcm/aAcW/xIm0dfzdriKhRANCAARK/U4JigocQatDwGK9Bq/mXcYeCc9VrsBn0LUrrH/gQniElv3dbd1rJpsYawFJLkP5E3ObpoXmmpVlblqKeaun'

describe('CDP SDK custom-auth boundary', () => {
  it('sends the project ID for delegation lookup and typed-data signing', async () => {
    const cdp = createTestCdpClient()

    await expect(
      cdp.endUser.getDelegationForEndUser({
        userId: 'custom-auth-user',
        projectId,
      }),
    ).resolves.toEqual({
      expiresAt: '2099-01-01T00:00:00.000Z',
    })

    await expect(
      cdp.endUser.signEvmTypedData({
        userId: 'custom-auth-user',
        projectId,
        address: '0x1111111111111111111111111111111111111111',
        idempotencyKey: 'payment-request-12345678',
        typedData: {
          domain: {},
          types: {
            EIP712Domain: [],
            Payment: [{ name: 'amount', type: 'uint256' }],
          },
          primaryType: 'Payment',
          message: { amount: '25000' },
        },
      }),
    ).resolves.toEqual({
      signature: `0x${'ab'.repeat(65)}`,
    })
  })

  it('only converts a confirmed missing delegation to null', async () => {
    const cdp = createTestCdpClient()

    await expect(
      activeDelegationOrNull(() =>
        cdp.endUser.getDelegationForEndUser({
          userId: 'revoked-user',
          projectId,
        }),
      ),
    ).resolves.toBeNull()

    await expect(
      activeDelegationOrNull(() =>
        cdp.endUser.getDelegationForEndUser({
          userId: 'unavailable-user',
          projectId,
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      errorType: 'service_unavailable',
    })
  })
})

function createTestCdpClient() {
  return new CdpClient({
    apiKeyId: '11111111-1111-4111-8111-111111111111',
    apiKeySecret,
    walletSecret,
    basePath: 'https://cdp.test/platform',
  })
}

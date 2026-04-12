import type { SNSEvent } from 'aws-lambda'
import { getFylo, Collections } from '../shared/fylo'
import type { SuppressedAddress } from '../shared/types'

export async function handler(event: SNSEvent): Promise<void> {
  const fylo = await getFylo()

  for (const record of event.Records) {
    const message = JSON.parse(record.Sns.Message)
    const notificationType: string = message.notificationType

    if (notificationType === 'Bounce') {
      const recipients: string[] = message.bounce?.bouncedRecipients?.map((r: { emailAddress: string }) => r.emailAddress) ?? []
      for (const address of recipients) {
        await suppressAddress(fylo, address, 'bounce')
      }
    }

    if (notificationType === 'Complaint') {
      const recipients: string[] = message.complaint?.complainedRecipients?.map((r: { emailAddress: string }) => r.emailAddress) ?? []
      for (const address of recipients) {
        await suppressAddress(fylo, address, 'complaint')
      }
    }
  }
}

async function suppressAddress(
  fylo: Awaited<ReturnType<typeof getFylo>>,
  address: string,
  reason: SuppressedAddress['reason']
): Promise<void> {
  const existing: Record<string, SuppressedAddress> = {}
  for await (const doc of fylo.findDocs(Collections.SUPPRESSED, {
    $ops: [{ address: { $eq: address } }],
  }).collect()) {
    Object.assign(existing, doc)
  }

  if (Object.keys(existing).length > 0) return

  await fylo.putData(Collections.SUPPRESSED, {
    address,
    reason,
    suppressedAt: new Date().toISOString(),
  } satisfies SuppressedAddress)
}

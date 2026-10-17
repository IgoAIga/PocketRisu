import { forageStorage } from 'src/ts/globalApi.svelte'

export async function outputRecoveryCheckpoint(identity: { chaId: string; chatId: string; generationId: string }, extra: { liveStart?: boolean; checkLive?: boolean; claimStage?: number } = {}): Promise<{ attempted?: boolean }> {
    const response = await fetch('/api/output-recovery-checkpoint', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'risu-auth': await forageStorage.createAuth(),
            'x-session-id': await forageStorage.getSessionId(),
        },
        body: JSON.stringify({ ...identity, ...extra }),
    })
    if (!response.ok) throw new Error(`Output checkpoint rejected (${response.status})`)
    return response.json()
}

<script lang="ts">
    import { getCurrentCharacter, getCurrentChat, normalizeChat, type MessageGenerationInfo } from 'src/ts/storage/database.svelte'
    import { generationStates } from 'src/ts/process/generationState'
    import { forageStorage } from 'src/ts/globalApi.svelte'
    import { alertConfirm, notifyError } from 'src/ts/alert'
    let { info }: { info: MessageGenerationInfo | null } = $props()
    let working = $state(false)
    const stages = ['출력 변환', '이미지 삽입', '변수 처리', '봇·모듈 실행', '플러그인 실행', '삽화 자동생성', '저장 확인']
    const checkpoint = $derived(info?.outputRecovery)
    const active = $derived([...$generationStates.values()].some(v => v.generationId === info?.generationId))
    const latest = $derived(getCurrentChat()?.message.at(-1)?.generationInfo?.generationId === info?.generationId)
    async function resolve(action: 'retry' | 'skip') {
        const char = getCurrentCharacter(), chat = getCurrentChat()
        if (!chat?.id || !info?.generationId || active || working) return
        const confirmed = await alertConfirm(action === 'retry'
            ? '이 단계가 이미 일부 실행됐을 수 있어요. 다른 창의 처리가 멈췄는지 확인하세요. 삽화 비용이나 상태 변경이 중복될 수 있습니다. 현재 단계부터 다시 실행할까요?'
            : '현재 단계를 완료한 것으로 처리하고 다음 단계로 넘어갈까요? 실제로 완료되지 않았다면 상태창이나 삽화가 빠질 수 있어요.')
        if (!confirmed) return
        working = true
        try {
            const response = await fetch('/api/output-recovery-resolve', { method: 'POST', headers: {
                'content-type': 'application/json', 'risu-auth': await forageStorage.createAuth(), 'x-session-id': await forageStorage.getSessionId(),
            }, body: JSON.stringify({ chaId: char.chaId, chatId: chat.id, generationId: info.generationId, action }) })
            if (!response.ok) throw Error(`복구 요청이 거부됐어요 (${response.status}). 화면을 새로고침하고 상태를 다시 확인해주세요.`)
            const result = await response.json()
            const index = char.chats.findIndex(c => c.id === chat.id)
            if (index >= 0) char.chats[index] = normalizeChat(result.chat)
        } catch (error) { notifyError(String(error)) }
        finally { working = false }
    }
</script>

{#if checkpoint && checkpoint.state !== 'done'}
    <div class="my-2 rounded border border-bordercolor p-2 text-sm" role="status">
        <p>후처리: {stages[Math.min(checkpoint.next, 6)]} · {active ? '진행 중' : checkpoint.state === 'pending' ? '대기 중' : '확인 필요'}</p>
        {#if !active && checkpoint.state !== 'pending'}
            <p class="opacity-70">완료 여부가 불명확하여 자동 재실행을 멈췄어요.</p>
            {#if !latest}<p class="opacity-70">이후 대화가 있어 이전 응답의 상태 변경은 자동 재개하지 않아요.</p>{/if}
            <div class="mt-2 flex gap-2">
                <button class="rounded border border-bordercolor px-2 py-1" disabled={working || !latest} onclick={() => resolve('retry')}>현재 단계 재시도</button>
                <button class="rounded border border-bordercolor px-2 py-1" disabled={working || !latest} onclick={() => resolve('skip')}>완료로 확인하고 계속</button>
            </div>
        {/if}
    </div>
{/if}

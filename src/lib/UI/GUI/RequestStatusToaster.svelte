<script lang="ts">
    import { onDestroy } from 'svelte'
    import { requestStatuses, isTerminalPhase, clearStatus } from 'src/ts/status/requestStatus'
    import RequestStatusToast from './RequestStatusToast.svelte'
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const unsubscribe = requestStatuses.subscribe(entries => {
        for (const [id, entry] of entries) {
            if (isTerminalPhase(entry.phase) && !timers.has(id)) {
                timers.set(id, setTimeout(() => { timers.delete(id); clearStatus(id) }, 4000))
            } else if (!isTerminalPhase(entry.phase) && timers.has(id)) {
                clearTimeout(timers.get(id)); timers.delete(id)
            }
        }
        for (const [id, timer] of timers) {
            if (!entries.has(id)) { clearTimeout(timer); timers.delete(id) }
        }
    })
    onDestroy(() => { unsubscribe(); for (const timer of timers.values()) clearTimeout(timer) })
</script>

<div class="request-status-stack" aria-label="요청 상태">
    {#each [...$requestStatuses.keys()] as id (id)}
        <RequestStatusToast {id} />
    {/each}
</div>

<style>
    .request-status-stack {
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 8px);
        left: 50%;
        transform: translateX(-50%);
        width: min(280px, calc(100vw - 96px));
        z-index: 60;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
</style>

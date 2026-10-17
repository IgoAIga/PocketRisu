import { get } from 'svelte/store'
import { getCurrentCharacter, getCurrentChat, getDatabase, normalizeChat } from 'src/ts/storage/database.svelte'
import { saveChatToServer } from 'src/ts/storage/chatStorage'
import { forageStorage } from 'src/ts/globalApi.svelte'
import { selectedCharID } from 'src/ts/stores.svelte'
import { generationStates, startGeneration, endGeneration } from '../generationState'
import { processScriptFull, risuChatParser } from '../scripts'
import { runInlayScreen } from '../inlayScreen'
import { runTrigger } from '../triggers'
import { pluginV2 } from 'src/ts/plugins/plugins.svelte'
import { notifyError } from 'src/ts/alert'
import { trimUntilPunctuation } from 'src/ts/util'
import { beginOutputLifecycle } from '../outputLifecycle'
import { authHeader } from './jobFetch'
import { runCheckpointedOutput } from './outputCheckpoint'
import { hydrateAssetListsForCbs, serializeForCbsScan } from 'src/ts/parser/assetListHydration'
import { getModuleTriggers, getModules } from '../modules'
import { pendingArgonIllustrations } from './illustrationRecovery'

let busy = false
let installed = false
const warned = new Set<string>()

// Legacy module APIs use the current selection. Execute only while the origin
// is selected, with the same navigation/send guard as ordinary output hooks.
export async function resumeSelectedOutput(): Promise<void> {
    if (busy || get(generationStates).size || document.visibilityState !== 'visible') return
    const char = getCurrentCharacter()
    const chat = getCurrentChat()
    if (!char || (char as any).type === 'group' || !chat?.id || chat._placeholder) return
    // An old blocked response must not starve recovery of newer responses.
    const target = chat.message.at(-1)
    if (!target?.generationInfo?.outputRecovery || target.generationInfo.outputRecovery.state === 'done') return
    const generationId = target.generationInfo?.generationId
    const checkpoint = target.generationInfo?.outputRecovery
    if (!generationId || !checkpoint) return
    if (checkpoint.state !== 'pending' || target !== chat.message.at(-1)) {
        if (!warned.has(generationId)) {
            warned.add(generationId)
            notifyError('이 응답의 후처리 완료 여부를 확인할 수 없어 자동 재실행을 보류했어요. 중복 삽화 생성·상태 변경을 막기 위한 조치예요.')
        }
        return
    }
    busy = true
    const chatId = chat.id
    const charIndex = get(selectedCharID)
    const index = char.chats.findIndex(c => c.id === chatId)
    const current = () => char.chats.find(c => c.id === chatId)!
    const message = () => current().message.find(m => m.generationInfo?.generationId === generationId)!
    const assertOrigin = () => {
        if (getCurrentCharacter()?.chaId !== char.chaId || getCurrentChat()?.id !== chatId || message() !== current().message.at(-1)) {
            throw new Error('Output recovery origin changed')
        }
    }
    const persist = async (claimStage?: number) => {
        assertOrigin()
        await saveChatToServer(char.chaId, index, chatId, current())
        const response = await fetch('/api/output-recovery-checkpoint', {
            method: 'POST',
            headers: { ...await authHeader(), 'content-type': 'application/json', 'x-session-id': await forageStorage.getSessionId() },
            body: JSON.stringify({ chaId: char.chaId, chatId, generationId, claimStage }),
        })
        if (!response.ok) throw new Error(`Output checkpoint rejected (${response.status})`)
    }
    startGeneration(chatId, generationId)
    const lifecycle = beginOutputLifecycle(generationId, chatId, char.name, getDatabase().showRequestStatus !== false, false)
    const illustrationModules = getModules().filter(m => m.trigger?.some(t => t.effect?.some(e => e.type === 'triggerlua' && e.code.includes('toggle_argon_nai.timing')))).map(m => m.id)
    const applyOutputTriggers = async (illustrationOnly: boolean) => {
        const info = structuredClone($state.snapshot(message().generationInfo!))
        const identity = message().chatId
        const result = await runTrigger(char, 'output', {
            chat: current(), strictErrors: true,
            ...(illustrationOnly ? { includeModuleIds: illustrationModules } : { excludeModuleIds: illustrationModules }),
        })
        assertOrigin()
        if (result?.chat) {
            char.chats[index] = normalizeChat(result.chat)
            const original = current().message.find(m => m.chatId === identity)
            if (!original) throw new Error('Output hook removed recovery message')
            original.generationInfo = { ...original.generationInfo, ...info }
        }
        if (result?.sendAIprompt) notifyError('복구 후처리에서 추가 AI 요청이 요청됐어요. 자동 재전송하지 않았으니 내용을 확인해주세요.')
    }
    try {
        await hydrateAssetListsForCbs(char, [message().data, serializeForCbsScan([char.customscript, char.triggerscript, getModuleTriggers(), getModules().map(m => m.regex)])])
        assertOrigin()
        await runCheckpointedOutput(
            () => message().generationInfo!.outputRecovery!,
            value => { message().generationInfo!.outputRecovery = value },
            persist,
            [
                async () => {
                    const result = await processScriptFull(char, message().data.trim(), 'editoutput', current().message.length - 1)
                    assertOrigin()
                    message().data = getDatabase().removeIncompleteResponse ? trimUntilPunctuation(result.data) : result.data
                },
                async () => {
                    const result = runInlayScreen(char, message().data)
                    const text = result.promise ? await result.promise : result.text
                    assertOrigin()
                    message().data = text
                },
                async () => { message().data = risuChatParser(message().data, { chara: char, runVar: true }) },
                async () => { await applyOutputTriggers(false) },
                async () => {
                    const charSnapshot = $state.snapshot(char)
                    const chatSnapshot = $state.snapshot(current())
                    for (const listener of pluginV2.chatOutput) {
                        assertOrigin()
                        await listener({ char: charSnapshot, chat: chatSnapshot, characterIndex: charIndex, chatIndex: index, messageIndex: current().message.length - 1 })
                    }
                },
                async () => {
                    if (!illustrationModules.length) return
                    const toggles = getDatabase().globalChatVariables
                    const shouldGenerate = toggles['toggle_argon_nai.timing'] === '1' && toggles['toggle_argon_nai.mode'] !== '1'
                    const before = pendingArgonIllustrations(message().data)
                    await applyOutputTriggers(true)
                    if (shouldGenerate && before > 0 && pendingArgonIllustrations(message().data) > 0) {
                        throw new Error('Automatic illustration did not complete; review before retry')
                    }
                },
            ],
        )
        char.reloadKeys += 1
        lifecycle.saved()
    } catch (error) {
        console.warn('[OutputRecovery] checkpoint stopped', error)
        warned.add(generationId)
        notifyError('후처리를 완료하지 못해 자동 재실행을 보류했어요. 저장된 응답을 확인하고 중복 실행 여부를 점검해야 해요.')
    } finally {
        lifecycle.finish(false)
        endGeneration(chatId, { generationId })
        busy = false
    }
}

export function initRecoveredOutput(): void {
    if (installed || !(globalThis as any).__NODE__) return
    installed = true
    // Only inspect the selected, hydrated chat; never load the whole history.
    setInterval(() => { void resumeSelectedOutput().catch(console.warn) }, 1000)
}

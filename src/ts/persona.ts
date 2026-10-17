import { DBState } from "./stores.svelte"
import { addPersonaImage, getPersonaExportImage, removePersonaImage, selectPersonaImage } from "./personaImages"
import { getDatabase, saveImage, setDatabase } from "./storage/database.svelte"
import { selectSingleFile, sleep } from "./util"
import { alertError, alertStore, notifySuccess, notifyError } from "./alert"
import { AppendableBuffer, downloadFile, readImage } from "./globalApi.svelte"
import { language } from "src/lang"
import { reencodeImage } from "./process/files/inlays"
import { PngChunk } from "./pngChunk"
import { v4 } from "uuid"

export async function selectUserImg() {
    saveUserPersona()
    const persona = DBState.db.personas[DBState.db.selectedPersona]
    persona.id ??= v4()
    const selected = await selectSingleFile(['png', 'webp', 'jpg', 'jpeg'])
    if (!selected) {
        return
    }
    const img = selected.data
    const imgp = await saveImage(img)
    // The file picker may outlive the currently selected persona.
    if (!DBState.db.personas.includes(persona)) return
    addPersonaImage(persona, imgp)
    if (DBState.db.personas[DBState.db.selectedPersona] === persona) DBState.db.userIcon = persona.icon
}

export function useUserImage(image: string) {
    saveUserPersona()
    const persona = DBState.db.personas[DBState.db.selectedPersona]
    if (selectPersonaImage(persona, image)) DBState.db.userIcon = persona.icon
}

export function removeUserImage(image: string) {
    saveUserPersona()
    const persona = DBState.db.personas[DBState.db.selectedPersona]
    removePersonaImage(persona, image)
    DBState.db.userIcon = persona.icon
}

export function saveUserPersona() {
    let db = getDatabase()
    db.personas[db.selectedPersona].name = db.username
    db.personas[db.selectedPersona].icon = db.userIcon
    db.personas[db.selectedPersona].personaPrompt = db.personaPrompt
    db.personas[db.selectedPersona].note = db.userNote
}

export function changeUserPersona(id: number, save: 'save' | 'noSave' = 'save') {
    if (save === 'save') {
        saveUserPersona()
    }
    let db = getDatabase()
    const pr = db.personas[id]
    db.personaPrompt = pr.personaPrompt
    db.username = pr.name
    db.userIcon = pr.icon
    db.userNote = pr.note
    db.selectedPersona = id
}

interface PersonaCard {
    name: string
    personaPrompt: string
    note?: string
}

export async function exportUserPersona(personaIndex?: number, image?: string) {
    let db = getDatabase({ snapshot: true })
    const persona = personaIndex === undefined
        ? {
            ...db.personas[db.selectedPersona],
            name: db.username,
            personaPrompt: db.personaPrompt,
            note: db.userNote,
            icon: db.userIcon,
        }
        : db.personas[personaIndex]
    if (!persona || !persona.name || !persona.personaPrompt) {
        notifyError("username or persona prompt is empty")
        return
    }

    const exportImage = getPersonaExportImage(persona, image)
    let img: Uint8Array
    if (!exportImage) {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 256
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = 'rgb(100, 116, 139)'
        ctx.fillRect(0, 0, 256, 256)
        const dataUrl = canvas.toDataURL('image/png')
        const base64 = dataUrl.split(',')[1]
        img = new Uint8Array(Buffer.from(base64, 'base64'))
    } else {
        img = await readImage(exportImage)
    }

    let card: PersonaCard = safeStructuredClone({
        name: persona.name,
        personaPrompt: persona.personaPrompt,
        note: persona.note,
    })

    alertStore.set({
        type: 'wait',
        msg: 'Loading... (Writing Exif)'
    })

    await sleep(10)

    img = (await PngChunk.write(await reencodeImage(img), {
        "persona": Buffer.from(JSON.stringify(card)).toString('base64')
    })) as Uint8Array

    alertStore.set({
        type: 'wait',
        msg: 'Loading... (Writing)'
    })

    await sleep(10)
    await downloadFile(`${persona.name.replace(/[<>:"/\\|?*\.\,]/g, "")}_export.png`, img)

    notifySuccess(language.successExport)
}

export async function importUserPersona() {
    try {
        const v = await selectSingleFile(['png'])
        if (!v) {
            return
        }
        const readGenerator = PngChunk.readGenerator(v.data)
        let decoded: string | undefined;

        for await (const chunk of readGenerator) {
            if (chunk && !(chunk instanceof AppendableBuffer) && chunk.key === 'persona') {
                decoded = chunk.value
                break
            }
        }

        if (!decoded) {
            alertError(language.errors.noData)
            return
        }
        const data: PersonaCard = JSON.parse(Buffer.from(decoded, 'base64').toString('utf-8'))
        if (data.name && data.personaPrompt) {
            let db = getDatabase()
            db.personas.push({
                name: data.name,
                icon: await saveImage(await reencodeImage(v.data)),
                personaPrompt: data.personaPrompt,
                note: data.note,
                id: v4()
            })
            notifySuccess(language.successImport)
        } else {
            alertError(language.errors.noData)
        }
    } catch (error) {
        alertError(error)
        return
    }
}

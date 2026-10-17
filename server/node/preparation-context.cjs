// A server-owned, immutable execution context. This is intentionally separate
// from the UI's selected character/chat. No provider credentials are copied.
const crypto = require('node:crypto');

function buildPreparationContext(db, chat, chaId, generationId) {
    const char = db.characters?.find(c => c.chaId === chaId);
    if (!char || !chat?.id || !Array.isArray(chat.message)) throw new Error('Preparation chat missing');
    const ids = new Set([...(db.enabledModules ?? []), ...(char.modules ?? []), ...(chat.modules ?? [])]);
    const modules = (db.modules ?? []).filter(m => ids.has(m.id) || ids.has(m.namespace));
    const persona = (db.personas ?? []).find(p => p.id === chat.bindedPersona);
    if (persona?.embeddedModule && !modules.some(m => m.id === persona.embeddedModule.id)) modules.push(persona.embeddedModule);
    const reasons = [];
    if ((char.triggerscript ?? []).length || modules.some(m => m.trigger?.length)) reasons.push('lua-or-trigger-context');
    if ((db.plugins ?? []).some(p => p.enabled !== false)) reasons.push('browser-plugin-hooks');
    if (db.hypaModel && !['custom', 'ada', 'openai3small', 'openai3large'].includes(db.hypaModel)) reasons.push('embedding-runtime-adapter');
    // Never claim that assembling these records executes the existing parser,
    // lorebook budget logic, Hypa or arbitrary module side effects.
    reasons.push('legacy-prompt-assembler');
    const context = {
        version: 1, chaId, chatId: chat.id, generationId,
        character: { name: char.name, description: char.desc, personality: char.personality, scenario: char.scenario,
            systemPrompt: char.systemPrompt, globalNote: char.globalNote, defaultVariables: char.defaultVariables,
            triggers: char.triggerscript, regex: char.customscript, lore: char.globalLore },
        chat: structuredClone(chat),
        modules: modules.map(m => ({ id: m.id, name: m.name, trigger: m.trigger, regex: m.regex, lorebook: m.lorebook, lowLevelAccess: m.lowLevelAccess })),
        // Store references to authentication-bearing model presets, not keys.
        modelBinding: structuredClone(chat.modelBinding ?? null),
        persona: persona ? { id: persona.id, name: persona.name, prompt: persona.personaPrompt } : { name: db.username, prompt: db.personaPrompt },
        legacyModels: { main: db.aiModel, sub: db.subModel },
        budget: { context: db.maxContext, output: db.maxResponse },
        prompt: { main: db.mainPrompt, jailbreak: db.jailbreak, globalNote: db.globalNote, template: db.promptTemplate, toggles: db.globalChatVariables },
        memory: { model: db.hypaModel, presets: db.hypaV3Presets },
        capabilities: { server: ['history-load', 'context-snapshot', 'compatibility-audit'], waitingForAdapter: [...new Set(reasons)] },
    };
    const serialized = JSON.stringify(context);
    return { context: JSON.parse(serialized), fingerprint: crypto.createHash('sha256').update(serialized).digest('hex') };
}

function registerPreparationRoutes(app, deps) {
    const { auth, activeSession, queue, snapshot, get, put } = deps;
    app.post('/api/preparation-context', async (req, res, next) => {
        if (!await auth(req, res) || !activeSession(req, res)) return;
        try {
            await queue(async () => {
                const { chaId, chatId, generationId } = req.body ?? {};
                if (![chaId, chatId, generationId].every(v => typeof v === 'string' && /^[\w-]{1,100}$/.test(v))) return res.status(400).json({ error: 'Invalid identity' });
                const key = `preparation-context/${chatId}/${generationId}`;
                const prior = get(key);
                if (prior) {
                    const value = JSON.parse(prior.toString());
                    return res.json({ fingerprint: value.fingerprint, capabilities: value.context.capabilities, reused: true });
                }
                const { db, chat } = await snapshot(chaId, chatId);
                const value = buildPreparationContext(db, chat, chaId, generationId);
                put(key, Buffer.from(JSON.stringify(value)));
                res.json({ fingerprint: value.fingerprint, capabilities: value.context.capabilities, reused: false });
            });
        } catch (error) { next(error); }
    });
}
module.exports = { buildPreparationContext, registerPreparationRoutes };

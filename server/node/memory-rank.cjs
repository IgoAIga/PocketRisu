const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
function rankVectors(query, vectors) {
    if (!Array.isArray(query) || !query.length || !query.every(Number.isFinite)) throw Error('Invalid query vector');
    return vectors.map((vector, index) => {
        if (!Array.isArray(vector) || vector.length !== query.length || !vector.every(Number.isFinite)) throw Error('Incompatible vector');
        let score = 0;
        for (let i = 0; i < query.length; i++) score += query[i] * vector[i];
        return { index, score };
    }).sort((a, b) => b.score - a.score);
}
if (!isMainThread && workerData?.memoryRank) {
    try { parentPort.postMessage({ results: rankVectors(workerData.query, workerData.vectors) }); }
    catch { parentPort.postMessage({ error: 'Incompatible vector cache' }); }
}
function registerMemoryRankRoute(app, { auth, get }) {
    app.post('/api/memory-rank', async (req, res, next) => {
        if (!await auth(req, res)) return;
        try {
            const { query, keys } = req.body ?? {};
            if (!Array.isArray(query) || !query.length || !query.every(Number.isFinite) || !Array.isArray(keys)
                || keys.length > 10000 || query.length * keys.length > 20000000
                || !keys.every(k => typeof k === 'string' && /^cache\/hypa-vector\/[a-zA-Z0-9_-]+\.json$/.test(k))) {
                return res.status(400).json({ error: 'Invalid memory search' });
            }
            const vectors = [];
            for (const key of keys) {
                const raw = get(key);
                if (!raw) return res.status(409).json({ error: 'Vector cache incomplete' });
                const value = JSON.parse(raw.toString()).value?.embedding;
                if (!Array.isArray(value) || value.length !== query.length) return res.status(409).json({ error: 'Vector cache incompatible' });
                vectors.push(value);
            }
            const worker = new Worker(__filename, { workerData: { memoryRank: true, query, vectors } });
            let timeout;
            try {
                const result = await new Promise((resolve, reject) => {
                    timeout = setTimeout(() => reject(Error('Memory search timeout')), 30000);
                    worker.once('message', resolve);
                    worker.once('error', reject);
                    worker.once('exit', code => { if (code) reject(Error('Memory worker stopped')); });
                });
                if (result.error) return res.status(409).json({ error: result.error });
                res.json(result);
            } finally { clearTimeout(timeout); await worker.terminate(); }
        } catch (error) { next(error); }
    });
}
module.exports = { rankVectors, registerMemoryRankRoute };

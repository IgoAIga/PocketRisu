'use strict';
const { createHash } = require('node:crypto');

// Cookies are scoped to host/path, not port. Independent installations on
// localhost or a shared LAN/Tailscale host must not overwrite each other.
function assetSessionCookieName(instanceId) {
    return 'risu-session-' + createHash('sha256').update(instanceId).digest('hex').slice(0, 24);
}

function readAssetSessionCookie(header, name) {
    for (const part of (header || '').split(';')) {
        const eq = part.indexOf('=');
        if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
}

module.exports = { assetSessionCookieName, readAssetSessionCookie };

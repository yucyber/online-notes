const fs = require('node:fs')
const path = require('node:path')

function parseEnvValue(value) {
    const trimmed = String(value || '').trim()
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1)
    }
    return trimmed
}

function parseEnvFile(text) {
    const env = {}
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const index = line.indexOf('=')
        if (index === -1) continue
        const key = line.slice(0, index).trim()
        const value = parseEnvValue(line.slice(index + 1))
        env[key] = value
    }
    return env
}

function defaultEnvFile() {
    return process.env.YWS_ENV_FILE || path.resolve(__dirname, '..', 'notes-backend', '.env')
}

function loadJwtSecretFromEnvFile({
    env = process.env,
    envFile = defaultEnvFile(),
    existsSync = fs.existsSync,
    readFileSync = fs.readFileSync,
} = {}) {
    if (env.YWS_JWT_SECRET || env.JWT_SECRET) {
        return { status: 'skipped', reason: 'secret-already-set' }
    }

    if (!existsSync(envFile)) {
        return { status: 'skipped', reason: 'env-file-missing', envFile }
    }

    const parsed = parseEnvFile(readFileSync(envFile, 'utf8'))
    if (!parsed.JWT_SECRET) {
        return { status: 'skipped', reason: 'jwt-secret-missing', envFile }
    }

    env.JWT_SECRET = parsed.JWT_SECRET
    return { status: 'loaded', key: 'JWT_SECRET', envFile }
}

module.exports = {
    loadJwtSecretFromEnvFile,
    parseEnvFile,
}

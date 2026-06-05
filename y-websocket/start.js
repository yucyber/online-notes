const { loadJwtSecretFromEnvFile } = require('./env-utils')

const secretLoad = loadJwtSecretFromEnvFile()

if (secretLoad.status === 'loaded') {
    console.log(`[Auth] Loaded ${secretLoad.key} from ${secretLoad.envFile}`)
} else if (secretLoad.reason === 'env-file-missing') {
    console.warn(`[Auth] Local env file not found: ${secretLoad.envFile}`)
} else if (secretLoad.reason === 'jwt-secret-missing') {
    console.warn(`[Auth] JWT_SECRET not found in ${secretLoad.envFile}`)
}

require('./server')

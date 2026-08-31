import { timingSafeEqual } from 'crypto'
import { RequestHandler } from 'express'

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

function parseBasicCredentials(value?: string) {
  if (!value?.startsWith('Basic ')) return null
  try {
    const decoded = Buffer.from(value.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator < 0) return null
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) }
  } catch {
    return null
  }
}

export function createQueueMonitorAuth(username: string, password: string): RequestHandler {
  return (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    const credentials = parseBasicCredentials(request.headers.authorization)
    if (!credentials || !safeEqual(credentials.username, username) || !safeEqual(credentials.password, password)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="AI Task Monitor"')
      response.status(401).send('Unauthorized')
      return
    }
    next()
  }
}

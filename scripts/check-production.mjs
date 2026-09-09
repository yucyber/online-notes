import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = parse(readFileSync(resolve(root, 'docker-compose.production.yml'), 'utf8'))
const services = config.services || {}
if (Object.keys(services).sort().join() !== 'backend,frontend,nginx,redis,y-websocket') throw new Error('Compose must contain exactly the five production containers')
const published = Object.entries(services).filter(([, service]) => service.ports?.length).map(([name]) => name)
if (published.join() !== 'nginx') throw new Error('Only nginx may publish ports')
if (services.nginx.ports.join() !== '80:80,443:443') throw new Error('Nginx must publish only HTTP 80 and HTTPS 443')
if (Object.keys(config.volumes || {}).join() !== 'redis-data') throw new Error('Redis must be the only local persistent volume')
if (!services.redis.volumes?.includes('redis-data:/data') || !Object.hasOwn(config.volumes || {}, 'redis-data')) throw new Error('Redis persistent volume required')
if (services.backend.environment.MONGODB_URI !== '${MONGODB_URI:?MONGODB_URI required}') throw new Error('Backend must require external MONGODB_URI')
for (const [key, expected] of Object.entries({
  SMTP_HOST: '${SMTP_HOST:?SMTP_HOST required}',
  SMTP_PORT: '${SMTP_PORT:-465}',
  SMTP_SECURE: '${SMTP_SECURE:-true}',
  SMTP_USER: '${SMTP_USER:?SMTP_USER required}',
  SMTP_PASSWORD: '${SMTP_PASSWORD:?SMTP_PASSWORD required}',
})) {
  if (services.backend.environment[key] !== expected) throw new Error('Backend SMTP setting is missing or unsafe: ' + key)
}
if (services.backend.env_file !== '.env.production') throw new Error('Backend must load MAIL_FROM from .env.production')
if (services.backend.environment.CLIENT_URL !== 'https://${PUBLIC_HOST:?PUBLIC_HOST required}') throw new Error('CLIENT_URL must use HTTPS PUBLIC_HOST')
if (services.backend.environment.COOKIE_SECURE !== 'true') throw new Error('Production cookies must be Secure')
if (services.frontend.build.args.NEXT_PUBLIC_YWS_URL !== 'wss://${PUBLIC_HOST:?PUBLIC_HOST required}/ws/yjs') throw new Error('Browser Yjs URL must use WSS')
if (!services.nginx.volumes?.includes('/etc/letsencrypt:/etc/letsencrypt:ro')) throw new Error('Certbot certificates must be mounted read-only')

const nginx = readFileSync(resolve(root, 'deploy/nginx.conf'), 'utf8')
for (const expected of [
  'return 301 https://47.97.243.59$request_uri;',
  'listen 443 ssl;',
  'ssl_certificate /etc/letsencrypt/live/47.97.243.59/fullchain.pem;',
  'ssl_certificate_key /etc/letsencrypt/live/47.97.243.59/privkey.pem;',
]) {
  if (!nginx.includes(expected)) throw new Error('Missing Nginx HTTPS setting: ' + expected)
}

const proxy = 'm.daocloud.io/docker.io/library/'
for (const [service, image] of [['redis', 'redis:7.4-alpine'], ['nginx', 'nginx:1.28-alpine']]) {
  if (services[service].image !== proxy + image) throw new Error(service + ' must use the ECS-compatible image proxy')
}
for (const file of ['notes-backend/Dockerfile', 'notes-frontend/Dockerfile', 'y-websocket/Dockerfile']) {
  const dockerfile = readFileSync(resolve(root, file), 'utf8')
  if ([...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].some(([, image]) => !image.startsWith(proxy + 'node:'))) {
    throw new Error(file + ' must use the ECS-compatible Node image proxy')
  }
}

const template = readFileSync(resolve(root, '.env.production.example'), 'utf8')
const templateLines = template.split(/\r?\n/)
const templateEntries = templateLines.filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index), line.slice(index + 1).trim()]
})
const sensitiveTemplateEntries = templateLines.flatMap(line => {
  const match = line.match(/^\s*(SMTP_USER|SMTP_PASSWORD|MAIL_FROM)\s*(?:=|:)\s*(.*?)\s*$/)
  return match ? [[match[1], match[2]]] : []
})
const templateValues = Object.fromEntries(templateEntries)
if (templateValues.PUBLIC_HOST !== '47.97.243.59') throw new Error('PUBLIC_HOST template must match the ECS public IP')
if (!/^mongodb\+srv:\/\/USERNAME:PASSWORD@CLUSTER\/notes\?/.test(templateValues.MONGODB_URI || '')) throw new Error('MONGODB_URI template must use external Atlas')
for (const [key, expected] of Object.entries({SMTP_HOST: 'smtp.qq.com', SMTP_PORT: '465', SMTP_SECURE: 'true'})) {
  if (templateValues[key] !== expected) throw new Error(key + ' template value is missing or invalid')
}
for (const key of ['SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM']) {
  const assignments = sensitiveTemplateEntries.filter(([name]) => name === key)
  if (assignments.length !== 1 || assignments[0][1] !== '' || !templateLines.includes(key + '=')) {
    throw new Error(key + ' must appear exactly once and be empty in template')
  }
}
if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(template)) throw new Error('Email addresses must not appear in the production env template')
for (const key of ['SILICONFLOW_API_KEY', 'BAI_API_KEY', 'AR_API_KEY']) {
  if (!template.split(/\r?\n/).includes(key + '=')) throw new Error(key + ' must be empty in template')
}
if (process.argv.includes('--env')) {
  const content = readFileSync(resolve(root, '.env.production'), 'utf8')
  const values = Object.fromEntries(content.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1).trim()]
  }))
  if (!/^[a-zA-Z0-9.-]+$/.test(values.PUBLIC_HOST || '') || /YOUR_|CHANGE_ME/.test(values.PUBLIC_HOST)) throw new Error('Set PUBLIC_HOST to an IP or hostname without protocol/path')
  for (const [key, min] of [['JWT_SECRET', 64], ['BULL_BOARD_PASSWORD', 32]]) {
    if (!new RegExp('^[a-fA-F0-9]{' + min + ',}$').test(values[key] || '')) throw new Error(key + ' must be random hexadecimal, minimum ' + min + ' characters')
  }
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(values.BULL_BOARD_USERNAME || '')) throw new Error('Set BULL_BOARD_USERNAME')
}
console.log('Production configuration checks passed (no secrets printed).')

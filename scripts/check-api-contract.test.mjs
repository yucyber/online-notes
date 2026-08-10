import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReleaseGateOperations } from './check-api-contract.mjs'

function createValidDocument() {
  return {
    paths: {
      '/api/auth/logout': {
        post: {
          responses: { '200': { $ref: '#/components/responses/LogoutEnvelope' } },
        },
      },
      '/api/notes/{id}/room-ticket': {
        parameters: [{ $ref: '#/components/parameters/Id' }],
        post: {
          security: [{ CookieAuth: [] }, { BearerAuth: [] }],
          responses: { '201': { $ref: '#/components/responses/RoomTicketEnvelope' } },
        },
      },
    },
    components: {
      securitySchemes: {
        CookieAuth: { type: 'apiKey', in: 'cookie', name: 'notes_token' },
        BearerAuth: { type: 'http', scheme: 'bearer' },
      },
      responses: {
        LogoutEnvelope: {
          content: {
            'application/json': {
              schema: {
                allOf: [{ $ref: '#/components/schemas/ApiEnvelope' }, {
                  type: 'object',
                  required: ['data'],
                  properties: { data: { $ref: '#/components/schemas/LogoutResult' } },
                }],
              },
            },
          },
        },
        RoomTicketEnvelope: {
          content: {
            'application/json': {
              schema: {
                allOf: [{ $ref: '#/components/schemas/ApiEnvelope' }, {
                  type: 'object',
                  required: ['data'],
                  properties: { data: { $ref: '#/components/schemas/RoomTicket' } },
                }],
              },
            },
          },
        },
      },
      schemas: {
        LogoutResult: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } },
        },
        RoomTicket: {
          type: 'object',
          required: ['ticket', 'role', 'expiresIn'],
          properties: {
            ticket: { type: 'string' },
            role: { type: 'string', enum: ['writer', 'reader'] },
            expiresIn: { type: 'integer' },
          },
        },
      },
    },
  }
}

test('accepts the expected logout and room-ticket contract', () => {
  assert.doesNotThrow(() => validateReleaseGateOperations(createValidDocument()))
})

test('rejects release-gate operation drift', () => {
  const cases = [
    ['logout POST', (doc) => { delete doc.paths['/api/auth/logout'].post }],
    ['LogoutEnvelope', (doc) => { delete doc.components.responses.LogoutEnvelope }],
    ['LogoutResult.message', (doc) => { delete doc.components.schemas.LogoutResult.properties.message }],
    ['room-ticket POST', (doc) => { delete doc.paths['/api/notes/{id}/room-ticket'].post }],
    ['room-ticket Id parameter', (doc) => { doc.paths['/api/notes/{id}/room-ticket'].parameters = [] }],
    ['CookieAuth', (doc) => { doc.paths['/api/notes/{id}/room-ticket'].post.security = [{ BearerAuth: [] }] }],
    ['BearerAuth', (doc) => { doc.paths['/api/notes/{id}/room-ticket'].post.security = [{ CookieAuth: [] }] }],
    ['RoomTicketEnvelope', (doc) => { delete doc.components.responses.RoomTicketEnvelope }],
    ['RoomTicketEnvelope.data', (doc) => { doc.components.responses.RoomTicketEnvelope.content['application/json'].schema.allOf[1].required = [] }],
    ['RoomTicket required fields', (doc) => { doc.components.schemas.RoomTicket.required = ['ticket'] }],
  ]

  for (const [message, mutate] of cases) {
    const document = createValidDocument()
    mutate(document)
    assert.throws(() => validateReleaseGateOperations(document), new RegExp(message))
  }
})

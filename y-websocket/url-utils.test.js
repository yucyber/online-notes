const { test } = require('node:test')
const assert = require('node:assert/strict')
const { redactRequestUrl } = require('./url-utils')

test('redactRequestUrl hides websocket token query params', () => {
  assert.equal(
    redactRequestUrl('/note:abc?access_token=jwt-secret&foo=1&token=legacy-secret'),
    '/note:abc?access_token=<redacted>&foo=1&token=<redacted>',
  )
})

test('redactRequestUrl tolerates empty and malformed urls', () => {
  assert.equal(redactRequestUrl(undefined), '')
  assert.equal(redactRequestUrl('not a url with spaces'), 'not a url with spaces')
})

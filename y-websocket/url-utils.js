function redactRequestUrl(rawUrl) {
    if (!rawUrl) return ''

    return String(rawUrl).replace(
        /([?&](?:access_token|token)=)[^&\s]*/gi,
        '$1<redacted>',
    )
}

module.exports = { redactRequestUrl }

function readVarUint(bytes, offset) {
    let value = 0
    let shift = 0
    let index = offset
    while (index < bytes.length) {
        const current = bytes[index++]
        value |= (current & 0x7f) << shift
        if ((current & 0x80) === 0) return { value, offset: index }
        shift += 7
    }
    return null
}

function shouldDropMessage(message, role) {
    if (role !== 'reader') return false
    const bytes = message instanceof Uint8Array ? message : new Uint8Array(message)
    const outer = readVarUint(bytes, 0)
    if (!outer || outer.value !== 0) return false
    const sync = readVarUint(bytes, outer.offset)
    // reader 只允许 sync step1 拉取状态；step2 和 update 都可能向房间写入内容。
    return Boolean(sync && (sync.value === 1 || sync.value === 2))
}

function installReadOnlyGuard(connection, role) {
    if (role !== 'reader') return () => {}
    const originalOn = connection.on
    connection.on = function (event, listener) {
        if (event !== 'message') return originalOn.call(this, event, listener)
        return originalOn.call(this, event, function (message, ...args) {
            if (shouldDropMessage(message, role)) return
            return listener.call(this, message, ...args)
        })
    }
    return () => { connection.on = originalOn }
}

module.exports = { installReadOnlyGuard, shouldDropMessage }

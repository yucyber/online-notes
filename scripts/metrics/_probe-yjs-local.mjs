import { Y } from './_deps.mjs'
// 本地（无网络）：验证 delete 语义
const d1=new Y.Doc(); const t1=d1.getText('c')
t1.insert(0,'AAAAAAAAAA'); console.log('local after insert:', JSON.stringify(t1.toString()), 'len', t1.length)
t1.delete(0,5); console.log('local after delete(0,5):', JSON.stringify(t1.toString()), 'len', t1.length)
// 两个 doc 之间同步（无网络，手动 applyUpdate）：模拟并发删除
const a=new Y.Doc(), b=new Y.Doc()
const ta=a.getText('c'), tb=b.getText('c')
a.on('update',(u)=>Y.applyUpdate(b,u)); b.on('update',(u)=>Y.applyUpdate(a,u))
ta.insert(0,'AAAAAAAAAA'); console.log('sync after insert: a=',JSON.stringify(ta.toString()),'b=',JSON.stringify(tb.toString()))
ta.delete(0,5); tb.delete(0,5)
console.log('sync after concurrent deletes: a=',JSON.stringify(ta.toString()),'b=',JSON.stringify(tb.toString()))

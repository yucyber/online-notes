import { WebSocket, Y, WebsocketProvider } from './_deps.mjs'
const URL='ws://127.0.0.1:1234'
const room='diag-s3-'+Date.now()
const wait=(ms)=>new Promise(r=>setTimeout(r,ms))
const mk=()=>{const doc=new Y.Doc();const p=new WebsocketProvider(URL,room,doc,{WebSocketPolyfill:WebSocket});return {doc,p,text:doc.getText('content')}}
const A=mk(),B=mk()
for(let i=0;i<100;i++){if(A.p.synced&&B.p.synced)break;await wait(50)}
console.log('synced')
A.text.insert(0,'AAAAAAAAAA')
await wait(600)
console.log('after setup  A=',JSON.stringify(A.text.toString()),'B=',JSON.stringify(B.text.toString()))
A.text.delete(0,5)
B.text.delete(0,5)
console.log('immediately  A=',JSON.stringify(A.text.toString()),'B=',JSON.stringify(B.text.toString()))
await wait(1500)
console.log('after 1.5s   A=',JSON.stringify(A.text.toString()),'B=',JSON.stringify(B.text.toString()))
console.log('len A',A.text.length,'len B',B.text.length)
A.p.destroy();B.p.destroy();A.doc.destroy();B.doc.destroy()

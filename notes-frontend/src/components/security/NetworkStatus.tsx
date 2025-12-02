 'use client'

 import React, { useEffect, useState } from 'react'
 import { networkAPI } from '@/lib/api'
 import { WifiOff, Wifi, RefreshCcw } from 'lucide-react'

 interface Props {
   // 可选：当网络恢复时触发外部同步（例如编辑器监听该事件）
   onReconnect?: () => void
 }

 /**
  * 安全中心 · 网络状态模块
  * - 显示在线/离线状态、API 连通性与延迟
  * - 提供手动重试与触发外部同步的交互
  */
export default function NetworkStatus({ onReconnect }: Props) {
   const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)
   const [latency, setLatency] = useState<number | null>(null)
   const [apiReachable, setApiReachable] = useState<boolean | null>(null)
   const [loading, setLoading] = useState(false)

   const runPing = async () => {
     setLoading(true)
     try {
       const res = await networkAPI.ping()
       setLatency(res.latency)
       setApiReachable(res.ok)
     } catch (e) {
       setLatency(null)
       setApiReachable(false)
     } finally {
       setLoading(false)
     }
   }

   useEffect(() => {
     runPing()
     const handleOnline = () => {
       setIsOnline(true)
       runPing()
       onReconnect?.()
     }
     const handleOffline = () => {
       setIsOnline(false)
     }
     window.addEventListener('online', handleOnline)
     window.addEventListener('offline', handleOffline)
     return () => {
       window.removeEventListener('online', handleOnline)
       window.removeEventListener('offline', handleOffline)
     }
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [])

   const statusColor = !isOnline
     ? '#dc2626'
     : apiReachable === false
       ? '#f59e0b'
       : '#16a34a'

  return (
    <div
      className="flex items-center justify-between"
      role="status"
      aria-live="polite"
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '10px',
        padding: '8px 12px',
        backgroundColor: '#ffffff',
      }}
    >
       <div className="flex items-center gap-2">
         {isOnline ? (
           <Wifi className="h-4 w-4" color={statusColor} />
         ) : (
           <WifiOff className="h-4 w-4" color={statusColor} />
         )}
         <span style={{ color: statusColor, fontWeight: 600 }}>
           {isOnline ? '在线' : '离线'}
         </span>
         <span className="text-xs text-gray-500">
           {apiReachable === null
             ? '检测中…'
             : apiReachable
               ? `API 正常（~${latency ?? '?'}ms）`
               : 'API 不可达'}
         </span>
       </div>

       <div className="flex items-center gap-2">
         <button
           type="button"
           className="flex items-center gap-1"
           style={{
             height: '44px',
             padding: '0 12px',
             borderRadius: '10px',
             border: '1px solid #e5e7eb',
             backgroundColor: '#f9fafb',
           }}
           onClick={runPing}
           disabled={loading}
         >
           <RefreshCcw className="h-4 w-4" />
           {loading ? '重试中…' : '重试'}
         </button>
         {isOnline && apiReachable && (
           <button
             type="button"
             style={{
               height: '44px',
               padding: '0 12px',
               borderRadius: '10px',
               border: 'none',
               color: '#fff',
               background: 'linear-gradient(120deg, #34d399, #10b981)',
             }}
             onClick={() => onReconnect?.()}
           >
             触发同步
           </button>
         )}
       </div>
     </div>
   )
 }

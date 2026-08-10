// 预加载脚本：在所有模块（mongoose 等）加载前强制指定 DNS 服务器。
// 解决 Node.js c-ares 在 Windows 下读不到全局 DNS 配置时回退到 127.0.0.1，
// 导致 MongoDB Atlas SRV 记录查询被拒绝（ECONNREFUSED）的问题。
// 通过 nodemon 的 `ts-node -r ./scripts/set-dns.ts src/main.ts` 预加载。
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '1.1.1.1']);

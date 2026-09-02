import { Types } from 'mongoose'

// 测试内存模型用明文 id（'u1'/'c1'），生产是 ObjectId hex：isValid 兜底避免构造非法 ObjectId 抛错，
// 同时保证生产查询仍按 ObjectId 匹配（assistant 各 service 共用）。
export function toObjectId(value: string): Types.ObjectId | string {
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : value
}

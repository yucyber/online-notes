import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Model, Types } from 'mongoose'

// categories 和 tags 都需要批量校验 ID 归属同一用户，防止跨用户引用。
export async function assertOwnedByUser(
  ids: string[],
  userId: string,
  model: Model<any>,
  resourceName: string,
): Promise<void> {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)))
  if (uniqueIds.length === 0) return
  if (uniqueIds.some((id) => !Types.ObjectId.isValid(id))) {
    throw new BadRequestException(`${resourceName}ID格式不正确`)
  }
  const owned = await model.find({
    _id: { $in: uniqueIds.map((id) => new Types.ObjectId(id)) },
    userId: new Types.ObjectId(userId),
  }).select('_id').exec()
  if (owned.length !== uniqueIds.length) {
    throw new NotFoundException(`${resourceName}不存在或不属于当前用户`)
  }
}

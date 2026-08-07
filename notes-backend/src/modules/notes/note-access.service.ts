import { BadRequestException, Injectable } from '@nestjs/common'
import { Types } from 'mongoose'

@Injectable()
export class NoteAccessService {
  objectId(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`${label} is invalid`)
    return new Types.ObjectId(id)
  }

  /** 统一的可读范围：创建者、ACL 成员或公开笔记。列表和领域服务都应复用它，避免权限口径漂移。 */
  readableFilter(userId: string) {
    const userObjectId = this.objectId(userId, 'user id')
    return {
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId } } },
        { visibility: 'public' },
      ],
    }
  }

  /** 在候选 ID 内再次套用可读范围，供知识库等“先有关联、再验权限”的场景使用。 */
  readableNotesQuery(noteIds: Types.ObjectId[], userId: string) {
    return {
      $and: [
        { _id: { $in: noteIds } },
        this.readableFilter(userId),
      ],
    }
  }

  readScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    return {
      _id: noteObjectId,
      ...this.readableFilter(userId),
    }
  }

  /** 协作成员范围不包含仅因公开而可读的用户，评论和查看 ACL 等协作操作使用此边界。 */
  memberScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId } } },
      ],
    }
  }

  /** 会改变正文的操作仅允许创建者、ACL owner 和 editor。 */
  writeScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId, role: { $in: ['owner', 'editor'] } } } },
      ],
    }
  }

  /** 可见性、删除和版本恢复会影响整篇笔记，只允许创建者或 ACL owner。 */
  ownerScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    const userObjectId = this.objectId(userId, 'user id')
    return {
      _id: noteObjectId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId, role: 'owner' } } },
      ],
    }
  }
}

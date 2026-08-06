import { BadRequestException, Injectable } from '@nestjs/common'
import { Types } from 'mongoose'

@Injectable()
export class NoteAccessService {
  objectId(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`${label} is invalid`)
    return new Types.ObjectId(id)
  }

  /** List-level readable filter (owner / ACL member / public). */
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

  readScope(noteId: string, userId: string) {
    const noteObjectId = this.objectId(noteId, 'note id')
    return {
      _id: noteObjectId,
      ...this.readableFilter(userId),
    }
  }

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

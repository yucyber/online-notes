import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Mindmap } from './schemas/mindmap.schema'
import { Note } from '../notes/schemas/note.schema'

@Injectable()
export class MindmapsService {
  constructor(
    @InjectModel(Mindmap.name) private readonly model: Model<Mindmap>,
    @InjectModel(Note.name) private readonly noteModel: Model<Note>,
  ) { }

  private parseObjectId(id: string | Types.ObjectId, label: string) {
    if (!Types.ObjectId.isValid(id as any)) {
      throw new BadRequestException(`${label} is invalid`)
    }
    return new Types.ObjectId(id as any)
  }

  private serialize(doc: any) {
    return {
      id: String(doc.id || doc._id),
      title: String(doc.title || ''),
      content: doc.content,
    }
  }

  private async canReadSourceNote(noteId: Types.ObjectId | undefined, userObjectId: Types.ObjectId) {
    if (!noteId) return false
    const note = await this.noteModel.findOne({
      _id: noteId,
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId } } },
        { visibility: 'public' },
      ],
    }).select('_id').lean().exec()
    return Boolean(note)
  }

  async create(input: { title: string; noteId?: string; userId: string; content?: any; _id?: string }) {
    const data: any = {
      title: String(input.title || ''),
      noteId: input.noteId ? this.parseObjectId(input.noteId, 'Note id') : undefined,
      userId: this.parseObjectId(input.userId, 'User id'),
      content: input.content,
    }
    if (input._id) data._id = this.parseObjectId(input._id, 'Mindmap id')

    try {
      const doc = await this.model.create(data)
      return this.serialize(doc)
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('Mindmap already exists')
      throw error
    }
  }

  async getById(id: string, userId: string) {
    const mapId = this.parseObjectId(id, 'Mindmap id')
    const userObjectId = this.parseObjectId(userId, 'User id')
    const doc = await this.model.findOne({ _id: mapId }).lean().exec()
    if (!doc) throw new NotFoundException('Mindmap not found')
    if (String((doc as any).userId) === String(userObjectId)) return this.serialize(doc)
    if (await this.canReadSourceNote((doc as any).noteId, userObjectId)) return this.serialize(doc)
    throw new NotFoundException('Mindmap not found')
  }

  async update(id: string, userId: string, input: { title?: string; content?: any }) {
    const updateData: any = {}
    if (input.title !== undefined) updateData.title = input.title
    if (input.content !== undefined) updateData.content = input.content

    const doc = await this.model.findOneAndUpdate(
      {
        _id: this.parseObjectId(id, 'Mindmap id'),
        userId: this.parseObjectId(userId, 'User id'),
      },
      updateData,
      { new: true },
    ).lean().exec()
    if (!doc) throw new NotFoundException('Mindmap not found')
    return this.serialize(doc)
  }
}

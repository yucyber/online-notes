import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Board } from './schemas/board.schema'
import { Note } from '../notes/schemas/note.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { canReadLinkedNote } from '../notes/resource-access'

@Injectable()
export class BoardsService {
  constructor(
    @InjectModel(Board.name) private readonly model: Model<Board>,
    @InjectModel(Note.name) private readonly noteModel: Model<Note>,
    private readonly noteAccess: NoteAccessService,
  ) { }

  private serialize(doc: any) {
    return {
      id: String(doc.id || doc._id),
      title: String(doc.title || ''),
      content: doc.content,
    }
  }

  async create(input: { title: string; noteId?: string; userId: string; content?: any; _id?: string }) {
    const data: any = {
      title: String(input.title || ''),
      noteId: input.noteId ? this.noteAccess.objectId(input.noteId, 'Note id') : undefined,
      userId: this.noteAccess.objectId(input.userId, 'User id'),
      content: input.content,
    }
    if (input._id) data._id = this.noteAccess.objectId(input._id, 'Board id')

    try {
      const doc = await this.model.create(data)
      return this.serialize(doc)
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('Board already exists')
      throw error
    }
  }

  async getById(id: string, userId: string) {
    const boardId = this.noteAccess.objectId(id, 'Board id')
    const userObjectId = this.noteAccess.objectId(userId, 'User id')
    const doc = await this.model.findOne({ _id: boardId }).lean().exec()
    if (!doc) throw new NotFoundException('Board not found')
    if (String((doc as any).userId) === String(userObjectId)) return this.serialize(doc)
    if (await canReadLinkedNote((doc as any).noteId, userObjectId, this.noteModel, this.noteAccess)) return this.serialize(doc)
    throw new NotFoundException('Board not found')
  }

  async update(id: string, userId: string, input: { title?: string; content?: any }) {
    const updateData: any = {}
    if (input.title !== undefined) updateData.title = input.title
    if (input.content !== undefined) updateData.content = input.content

    const doc = await this.model.findOneAndUpdate(
      {
        _id: this.noteAccess.objectId(id, 'Board id'),
        userId: this.noteAccess.objectId(userId, 'User id'),
      },
      updateData,
      { new: true },
    ).lean().exec()
    if (!doc) throw new NotFoundException('Board not found')
    return this.serialize(doc)
  }
}

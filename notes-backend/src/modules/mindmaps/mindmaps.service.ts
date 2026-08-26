import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Mindmap } from './schemas/mindmap.schema'
import { Note } from '../notes/schemas/note.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { canReadLinkedNote } from '../notes/resource-access'

@Injectable()
export class MindmapsService {
  constructor(
    @InjectModel(Mindmap.name) private readonly model: Model<Mindmap>,
    @InjectModel(Note.name) private readonly noteModel: Model<Note>,
    private readonly noteAccess: NoteAccessService,
  ) { }

  private serialize(doc: any, note?: any) {
    return {
      id: String(doc.id || doc._id),
      title: String(doc.title || ''),
      content: doc.content,
      noteId: doc.noteId ? String(doc.noteId) : undefined,
      noteTitle: note ? String(note.title || '') : undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }
  }

  async create(input: { title: string; noteId: string; userId: string; content?: any; _id?: string }) {
    if (!input.noteId) throw new BadRequestException('Note id is required')
    const note = await this.noteModel
      .findOne(this.noteAccess.writeScope(input.noteId, input.userId))
      .select('title')
      .lean()
      .exec()
    if (!note) throw new NotFoundException('Note not found')

    const title = this.normalizeTitle(input.title)
    const data: any = {
      title,
      noteId: this.noteAccess.objectId(input.noteId, 'Note id'),
      userId: this.noteAccess.objectId(input.userId, 'User id'),
      content: input.content,
    }
    if (input._id) data._id = this.noteAccess.objectId(input._id, 'Mindmap id')

    try {
      const doc = await this.model.create(data)
      return this.serialize(doc, note)
    } catch (error: any) {
      if (error?.code === 11000) throw new ConflictException('Mindmap already exists')
      throw error
    }
  }

  async getById(id: string, userId: string) {
    const mapId = this.noteAccess.objectId(id, 'Mindmap id')
    const userObjectId = this.noteAccess.objectId(userId, 'User id')
    const doc = await this.model.findOne({ _id: mapId }).lean().exec()
    if (!doc) throw new NotFoundException('Mindmap not found')
    const canRead = String((doc as any).userId) === String(userObjectId) ||
      await canReadLinkedNote((doc as any).noteId, userObjectId, this.noteModel, this.noteAccess)
    if (canRead) {
      const note = await this.noteModel
        .findOne(this.noteAccess.readScope(String((doc as any).noteId), userId))
        .select('title')
        .lean()
        .exec()
      return this.serialize(doc, note)
    }
    throw new NotFoundException('Mindmap not found')
  }

  async update(id: string, userId: string, input: { title?: string; content?: any }) {
    const updateData: any = {}
    if (input.content !== undefined) updateData.content = input.content
    if (input.title !== undefined) updateData.title = this.normalizeTitle(input.title)

    const doc = await this.model.findOneAndUpdate(
      {
        _id: this.noteAccess.objectId(id, 'Mindmap id'),
        userId: this.noteAccess.objectId(userId, 'User id'),
      },
      updateData,
      { new: true },
    ).lean().exec()
    if (!doc) throw new NotFoundException('Mindmap not found')
    return this.serialize(doc)
  }

  private normalizeTitle(value: string) {
    const title = String(value || '').trim()
    if (!title) throw new BadRequestException('Mindmap title is required')
    if (title.length > 80) throw new BadRequestException('Mindmap title is too long')
    return title
  }
}

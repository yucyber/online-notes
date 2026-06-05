import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Note, NoteDocument } from '../notes/schemas/note.schema'
import { NoteAccessService } from '../notes/note-access.service'
import { AddKnowledgeBaseNoteDto, CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from './dto'
import { KnowledgeBase, KnowledgeBaseDocument } from './schemas/knowledge-base.schema'
import { KnowledgeBaseNote, KnowledgeBaseNoteDocument } from './schemas/knowledge-base-note.schema'

@Injectable()
export class KnowledgeBasesService {
  constructor(
    @InjectModel(KnowledgeBase.name) private readonly kbModel: Model<KnowledgeBaseDocument>,
    @InjectModel(KnowledgeBaseNote.name) private readonly kbNoteModel: Model<KnowledgeBaseNoteDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    private readonly noteAccess: NoteAccessService,
  ) {}

  async create(input: CreateKnowledgeBaseDto, userId: string) {
    const created = await this.kbModel.create({
      name: this.cleanName(input.name),
      description: this.cleanDescription(input.description),
      userId: this.objectId(userId, 'user id'),
    })

    return this.serializeKnowledgeBase(created)
  }

  async findAll(userId: string) {
    const docs = await this.kbModel
      .find({ userId: this.objectId(userId, 'user id') })
      .sort({ createdAt: -1 })
      .exec()

    return docs.map((doc) => this.serializeKnowledgeBase(doc))
  }

  async update(id: string, input: UpdateKnowledgeBaseDto, userId: string) {
    const $set: Record<string, unknown> = {}
    if (input.name !== undefined) $set.name = this.cleanName(input.name)
    if (input.description !== undefined) $set.description = this.cleanDescription(input.description)

    const doc = await this.kbModel.findOneAndUpdate(
      { _id: this.objectId(id, 'knowledge base id'), userId: this.objectId(userId, 'user id') },
      { $set },
      { new: true },
    ).exec()
    if (!doc) throw new NotFoundException('Knowledge base not found')

    return this.serializeKnowledgeBase(doc)
  }

  async remove(id: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    await this.kbNoteModel.deleteMany({ knowledgeBaseId: this.idOf(kb), userId: this.objectId(userId, 'user id') }).exec()
    await this.kbModel.deleteOne({ _id: this.idOf(kb), userId: this.objectId(userId, 'user id') }).exec()
    return { ok: true }
  }

  async addNote(id: string, noteId: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    const note = await this.noteModel
      .findOne(this.noteAccess.readScope(noteId, userId))
      .select('title updatedAt createdAt')
      .exec()

    if (!note) throw new NotFoundException('Note not found or not readable')

    const userObjectId = this.objectId(userId, 'user id')
    const knowledgeBaseId = this.idOf(kb)
    const noteObjectId = this.idOf(note)
    const link = await this.kbNoteModel.findOneAndUpdate(
      { knowledgeBaseId, noteId: noteObjectId, userId: userObjectId },
      { $setOnInsert: { knowledgeBaseId, noteId: noteObjectId, userId: userObjectId } },
      { new: true, upsert: true },
    ).exec()

    return this.serializeKnowledgeBaseNote(link, note)
  }

  async addNoteFromDto(id: string, input: AddKnowledgeBaseNoteDto, userId: string) {
    return this.addNote(id, input.noteId, userId)
  }

  async listNotes(id: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    const userObjectId = this.objectId(userId, 'user id')
    const links = await this.kbNoteModel
      .find({ knowledgeBaseId: this.idOf(kb), userId: userObjectId })
      .sort({ createdAt: -1 })
      .exec()

    const noteIds = links.map((link) => this.idOf(link, 'noteId'))
    if (noteIds.length === 0) return []

    const notes = await this.noteModel.find({
      _id: { $in: noteIds },
      $or: [
        { userId: userObjectId },
        { acl: { $elemMatch: { userId: userObjectId } } },
        { visibility: 'public' },
      ],
    }).select('title summary updatedAt createdAt').exec()

    const noteById = new Map(notes.map((note) => [String(this.idOf(note)), note]))
    return links
      .map((link) => {
        const note = noteById.get(String(this.idOf(link, 'noteId')))
        return note ? this.serializeKnowledgeBaseNote(link, note) : null
      })
      .filter(Boolean)
  }

  async removeNote(id: string, noteId: string, userId: string) {
    const kb = await this.requireKnowledgeBase(id, userId)
    await this.kbNoteModel.deleteOne({
      knowledgeBaseId: this.idOf(kb),
      noteId: this.objectId(noteId, 'note id'),
      userId: this.objectId(userId, 'user id'),
    }).exec()
    return { ok: true }
  }

  private async requireKnowledgeBase(id: string, userId: string) {
    const kb = await this.kbModel.findOne({
      _id: this.objectId(id, 'knowledge base id'),
      userId: this.objectId(userId, 'user id'),
    }).exec()
    if (!kb) throw new NotFoundException('Knowledge base not found')
    return kb
  }

  private serializeKnowledgeBase(doc: any) {
    const value = this.toObject(doc)
    return {
      id: String(value._id),
      name: value.name,
      description: value.description || '',
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    }
  }

  private serializeKnowledgeBaseNote(link: any, note: any) {
    const linkValue = this.toObject(link)
    const noteValue = this.toObject(note)
    return {
      id: String(linkValue._id),
      knowledgeBaseId: String(linkValue.knowledgeBaseId),
      noteId: String(linkValue.noteId),
      note: {
        id: String(noteValue._id),
        title: noteValue.title || 'Untitled',
        summary: noteValue.summary,
        createdAt: noteValue.createdAt,
        updatedAt: noteValue.updatedAt,
      },
      createdAt: linkValue.createdAt,
    }
  }

  private toObject(doc: any) {
    return typeof doc?.toObject === 'function' ? doc.toObject() : doc
  }

  private idOf(doc: any, field = '_id'): Types.ObjectId {
    const value = this.toObject(doc)?.[field]
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value))
  }

  private objectId(id: string, label: string) {
    return this.noteAccess.objectId(id, label)
  }

  private cleanName(value: string) {
    return String(value || '').trim()
  }

  private cleanDescription(value?: string) {
    return String(value || '').trim()
  }
}

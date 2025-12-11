import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Board } from './schemas/board.schema'

@Injectable()
export class BoardsService {
  constructor(@InjectModel(Board.name) private readonly model: Model<Board>) {}

  async create(input: { title: string; noteId?: string; userId: string }) {
    const doc = await this.model.create({
      title: String(input.title || ''),
      noteId: input.noteId ? new Types.ObjectId(input.noteId) : undefined,
      userId: new Types.ObjectId(input.userId),
    })
    return { id: String((doc as any).id), title: String(doc.title || '') }
  }

  async getById(id: string) {
    const doc = await this.model.findById(id).lean()
    if (!doc) throw new NotFoundException('Board not found')
    return { id: String((doc as any).id || (doc as any)?._id), title: String((doc as any).title || '') }
  }
}


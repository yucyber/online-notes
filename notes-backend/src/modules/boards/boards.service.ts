import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Board } from './schemas/board.schema'

@Injectable()
export class BoardsService {
  constructor(@InjectModel(Board.name) private readonly model: Model<Board>) { }

  async create(input: { title: string; noteId?: string; userId: string; content?: any; _id?: string }) {
    const data: any = {
      title: String(input.title || ''),
      noteId: input.noteId ? new Types.ObjectId(input.noteId) : undefined,
      userId: new Types.ObjectId(input.userId),
      content: input.content,
    };
    if (input._id) {
      data._id = new Types.ObjectId(input._id);
    }
    const doc = await this.model.create(data)
    return { id: String((doc as any).id), title: String(doc.title || ''), content: doc.content }
  }

  async getById(id: string) {
    const doc = await this.model.findById(id).lean()
    if (!doc) throw new NotFoundException('Board not found')
    return {
      id: String((doc as any).id || (doc as any)?._id),
      title: String((doc as any).title || ''),
      content: (doc as any).content
    }
  }

  async update(id: string, input: { title?: string; content?: any }) {
    const updateData: any = {};
    if (input.title) updateData.title = input.title;
    if (input.content) updateData.content = input.content;

    const doc = await this.model.findByIdAndUpdate(id, updateData, { new: true }).lean();
    if (!doc) throw new NotFoundException('Board not found');
    return {
      id: String((doc as any).id || (doc as any)?._id),
      title: String((doc as any).title || ''),
      content: (doc as any).content
    };
  }
}


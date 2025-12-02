import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SavedFilter, SavedFilterDocument } from './schemas/saved-filter.schema';
import { CreateSavedFilterDto } from './dto';

@Injectable()
export class SavedFiltersService {
  constructor(
    @InjectModel(SavedFilter.name) private savedFilterModel: Model<SavedFilterDocument>,
  ) {}

  async create(createDto: CreateSavedFilterDto, userId: string): Promise<SavedFilter> {
    const created = new this.savedFilterModel({
      ...createDto,
      userId: new Types.ObjectId(userId),
    });
    return created.save();
  }

  async findAll(userId: string): Promise<SavedFilter[]> {
    return this.savedFilterModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).exec();
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.savedFilterModel.deleteOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }).exec();
  }
}

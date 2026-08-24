import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from './schemas/category.schema';
import { CreateCategoryDto, UpdateCategoryDto } from './dto';
import { assertOwnedByUser } from '../taxonomy/taxonomy-ownership';

@Injectable()
export class CategoriesService {
  constructor(@InjectModel(Category.name) private categoryModel: Model<CategoryDocument>) {}

  private async resolveParentId(
    parentId: string | null | undefined,
    userId: string,
    currentCategoryId?: string,
  ): Promise<Types.ObjectId | null> {
    if (parentId === undefined || parentId === null || parentId === '') {
      return null;
    }

    if (currentCategoryId && parentId === currentCategoryId) {
      throw new BadRequestException('分类不能以自己作为父级');
    }

    const parent = await this.categoryModel.findOne({
      _id: new Types.ObjectId(parentId),
      userId: new Types.ObjectId(userId),
    });

    if (!parent) {
      throw new NotFoundException('父级分类不存在');
    }

    return new Types.ObjectId(parentId);
  }

  async create(createCategoryDto: CreateCategoryDto, userId: string): Promise<Category> {
    // 分类名只要求在当前用户空间内唯一，不影响其他用户使用同名分类。
    const existingCategory = await this.categoryModel.findOne({
      name: createCategoryDto.name,
      userId: new Types.ObjectId(userId),
    });

    if (existingCategory) {
      throw new ConflictException('分类名称已存在');
    }

    const resolvedParentId = await this.resolveParentId(createCategoryDto.parentId, userId);
    const createdCategory = new this.categoryModel({
      ...createCategoryDto,
      parentId: resolvedParentId,
      userId: new Types.ObjectId(userId),
    });
    return createdCategory.save();
  }

  async findAll(userId: string): Promise<Category[]> {
    return this.categoryModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findRefsByIds(ids: string[]): Promise<Array<{ id: string; name: string; color?: string }>> {
    const objectIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id))
    if (objectIds.length === 0) return []
    const categories = await this.categoryModel.find({ _id: { $in: objectIds } }).select('name color').lean().exec()
    return categories.map((category: any) => ({ id: String(category._id), name: category.name, color: category.color }))
  }

  async assertOwnedIds(ids: string[], userId: string): Promise<void> {
    await assertOwnedByUser(ids, userId, this.categoryModel, '分类')
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto, userId: string): Promise<Category> {
    // 重命名时排除自身，同时仍把唯一性限制在当前用户空间内。
    if (updateCategoryDto.name) {
      const existingCategory = await this.categoryModel.findOne({
        name: updateCategoryDto.name,
        userId: new Types.ObjectId(userId),
        _id: { $ne: new Types.ObjectId(id) },
      });

      if (existingCategory) {
        throw new ConflictException('分类名称已存在');
      }
    }

    const { parentId, ...restDto } = updateCategoryDto;
    const updatePayload: Partial<CategoryDocument> = { ...restDto };

    if (Object.prototype.hasOwnProperty.call(updateCategoryDto, 'parentId')) {
      const resolvedParentId = await this.resolveParentId(
        parentId,
        userId,
        id,
      );
      updatePayload.parentId = resolvedParentId;
    }

    const updatedCategory = await this.categoryModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        updatePayload,
        { new: true, runValidators: true },
      )
      .exec();

    if (!updatedCategory) {
      throw new NotFoundException('分类不存在');
    }

    return updatedCategory;
  }

  async remove(id: string, userId: string): Promise<void> {
    const result = await this.categoryModel.deleteOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    }).exec();

    if (result.deletedCount === 0) {
      throw new NotFoundException('分类不存在');
    }
  }

  async incrementNoteCount(categoryId: string): Promise<void> {
    await this.categoryModel.findByIdAndUpdate(categoryId, {
      $inc: { noteCount: 1 },
    }).exec();
  }

  async decrementNoteCount(categoryId: string): Promise<void> {
    await this.categoryModel.findByIdAndUpdate(categoryId, {
      $inc: { noteCount: -1 },
    }).exec();
  }
}

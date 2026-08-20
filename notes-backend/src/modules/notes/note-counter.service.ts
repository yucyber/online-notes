import { Injectable } from '@nestjs/common'
import { CategoriesService } from '../categories/categories.service'
import { TagsService } from '../tags/tags.service'

@Injectable()
export class NoteCounterService {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly tagsService: TagsService,
  ) { }

  diffIds(prev: string[], next: string[]) {
    const prevSet = new Set(prev.filter(Boolean))
    const nextSet = new Set(next.filter(Boolean))
    return {
      add: [...nextSet].filter(id => !prevSet.has(id)),
      remove: [...prevSet].filter(id => !nextSet.has(id)),
    }
  }

  async incrementForCreate(input: { categoryId?: string; tags?: string[] }) {
    if (input.categoryId) {
      await this.categoriesService.incrementNoteCount(input.categoryId)
    }
    for (const id of input.tags || []) {
      if (id) await this.tagsService.incrementNoteCount(id)
    }
  }

  async updateCategories(prev: string[], next: string[]) {
    const delta = this.diffIds(prev, next)
    for (const id of delta.add) await this.categoriesService.incrementNoteCount(id)
    for (const id of delta.remove) await this.categoriesService.decrementNoteCount(id)
  }

  async updateTags(prev: string[], next: string[]) {
    const delta = this.diffIds(prev, next)
    for (const id of delta.add) await this.tagsService.incrementNoteCount(id)
    for (const id of delta.remove) await this.tagsService.decrementNoteCount(id)
  }

  async decrementForDelete(input: { categoryId?: string; tags?: string[] }) {
    if (input.categoryId) {
      await this.categoriesService.decrementNoteCount(input.categoryId)
    }
    for (const id of input.tags || []) {
      if (id) await this.tagsService.decrementNoteCount(id)
    }
  }
}

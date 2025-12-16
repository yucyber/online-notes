// 用户相关类型
export interface User {
  id: string
  email: string
  createdAt: string
  updatedAt: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterData extends LoginCredentials {
  confirmPassword: string
}

// 笔记相关类型
export interface NoteCategoryRef {
  id: string
  name: string
  color?: string
}

export interface NoteTagRef {
  id: string
  name: string
  color?: string
}

export interface Note {
  id: string
  title: string
  content: string
  summary?: string
  categoryId?: string
  categoryIds?: string[]
  category?: NoteCategoryRef | null
  tags: (string | NoteTagRef)[]
  createdAt: string
  updatedAt: string
  userId: string
  status?: 'published' | 'draft'
  visibility?: 'private' | 'org' | 'public'
}

export interface CreateNoteDto {
  title: string
  content: string
  categoryId?: string
  categoryIds?: string[]
  tags: string[]
  status?: 'published' | 'draft'
  visibility?: 'private' | 'org' | 'public'
}

export type UpdateNoteDto = Partial<CreateNoteDto>

export interface NoteFilterParams {
  keyword?: string
  categoryId?: string
  categoryIds?: string[]
  categoriesMode?: 'any' | 'all'
  tagIds?: string[]
  tagsMode?: 'any' | 'all'
  startDate?: string
  endDate?: string
  status?: 'published' | 'draft'
  ids?: string[]
}

export interface SavedFilter {
  id: string
  name: string
  criteria: NoteFilterParams
  userId: string
  createdAt: string
}

export interface CreateSavedFilterDto {
  name: string
  criteria: NoteFilterParams
}

// 分类相关类型
export interface Category {
  id: string
  name: string
  description?: string
  color?: string
  parentId?: string | null
  userId: string
  noteCount?: number
  createdAt: string
  updatedAt: string
}

// 标签相关类型
export interface Tag {
  id: string
  name: string
  color?: string
  noteCount?: number
  userId: string
  createdAt: string
}

// API响应类型
export interface ApiResponse<T> {
  success: boolean
  data?: T
  message?: string
  error?: string
}

// 分页相关类型
export interface PaginationParams {
  page?: number
  limit?: number
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface DashboardStats {
  notes: number
  categories: number
  tags: number
}

export interface RecentNoteSummary {
  id: string
  title: string
  preview: string
  updatedAt: string
  createdAt: string
  category?: NoteCategoryRef | null
  tags: NoteTagRef[]
}

export interface DashboardOverview {
  stats: DashboardStats
  recentNotes: RecentNoteSummary[]
  topCategories: Array<
    Pick<Category, 'id' | 'name' | 'color' | 'noteCount'>
  >
}

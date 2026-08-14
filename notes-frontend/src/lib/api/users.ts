import { patchTyped } from './client'
import type { User } from '@/types'

export type UpdateProfileDto = {
  displayName?: string
}

export const usersAPI = {
  updateProfile: (dto: UpdateProfileDto) =>
    patchTyped<User>('/users/me', dto),
}


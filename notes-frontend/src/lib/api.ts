/** Domain-split API modules with transitional re-exports for existing `@/lib/api` imports. */
export { default as api } from './api/client'
export { authAPI } from './api/auth'
export { usersAPI } from './api/users'
export { notesAPI, clearNotesCache } from './api/notes'
export { semanticAPI } from './api/semantic'
export type { SemanticSearchItem, SemanticSearchPage } from './api/semantic'
export {
  aclAPI,
  invitationsAPI,
  versionsAPI,
  auditAPI,
  notificationsAPI,
  commentsAPI,
} from './api/collab'
export { savedFiltersAPI, categoriesAPI, tagsAPI } from './api/taxonomy'
export { knowledgeBasesAPI } from './api/knowledge-bases'
export { dashboardAPI } from './api/dashboard'
export { boardsAPI, mindmapsAPI } from './api/boards-mindmaps'
export { networkAPI } from './api/network'

import { authAPI } from './api/auth'
import { notesAPI } from './api/notes'
import { semanticAPI } from './api/semantic'
import {
  invitationsAPI,
  notificationsAPI,
  versionsAPI,
  auditAPI,
  commentsAPI,
} from './api/collab'
import { categoriesAPI, tagsAPI } from './api/taxonomy'
import { dashboardAPI } from './api/dashboard'

export const login = authAPI.login
export const register = authAPI.register
export const fetchNotes = notesAPI.getAllCached
export const semanticSearch = semanticAPI.search
export const fetchNoteById = notesAPI.getById
export const createNote = notesAPI.create
export const updateNote = notesAPI.update
export const deleteNote = notesAPI.delete
export const fetchCategories = categoriesAPI.getAll
export const createCategory = categoriesAPI.create
export const updateCategory = categoriesAPI.update
export const deleteCategory = categoriesAPI.delete
export const fetchTags = tagsAPI.getAll
export const createTag = tagsAPI.create
export const deleteTag = tagsAPI.delete
export const fetchDashboardOverview = dashboardAPI.getOverview
export const fetchTopics = dashboardAPI.getTopics
export const convertTopicToTag = dashboardAPI.convertTopicToTag
export const previewInvitation = invitationsAPI.preview
export const acceptInvitation = invitationsAPI.accept
export const listMyInvitations = invitationsAPI.mine
export const listNotifications = notificationsAPI.list
export const markNotificationRead = notificationsAPI.markRead
export const listVersions = versionsAPI.list
export const snapshotVersion = versionsAPI.snapshot
export const restoreVersion = versionsAPI.restore
export const listAuditLogs = auditAPI.list
export const listComments = commentsAPI.list
export const createComment = commentsAPI.create

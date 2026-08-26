import 'dotenv/config'
import mongoose from 'mongoose'

export const CUTOFF = new Date('2026-06-30T16:00:00.000Z')

type CleanupCollectionResult = { matched: number; deleted: number }
type CleanupResult = {
  execute: boolean
  cutoff: string
  collections: Record<string, CleanupCollectionResult>
}

function userReferenceFilters(userIds: any[]) {
  if (userIds.length === 0) return []
  return [
    { userId: { $in: userIds } },
    { ownerId: { $in: userIds } },
    { actorId: { $in: userIds } },
    { createdBy: { $in: userIds } },
    { 'acl.userId': { $in: userIds } },
  ]
}

function noteReferenceFilters(noteIds: any[]) {
  if (noteIds.length === 0) return []
  const values = [...noteIds, ...noteIds.map(String)]
  return [
    { noteId: { $in: noteIds } },
    { resourceType: 'note', resourceId: { $in: values } },
  ]
}

async function idsFor(collection: any, filter: any) {
  const rows = await collection.find(filter).project({ _id: 1 }).toArray()
  return rows.map((row: any) => row._id)
}

export async function cleanupPreJuly2026(db: any, execute = false, session?: any): Promise<CleanupResult> {
  const oldUserIds = await idsFor(db.collection('users'), { createdAt: { $lt: CUTOFF } })
  const userFilters = userReferenceFilters(oldUserIds)
  const noteSelection = { $or: [{ createdAt: { $lt: CUTOFF } }, ...userFilters] }
  const deletedNoteIds = await idsFor(db.collection('notes'), noteSelection)
  const dependencyFilters = [...userFilters, ...noteReferenceFilters(deletedNoteIds)]
  const collections = await db.listCollections().toArray()
  const result: CleanupResult = { execute, cutoff: CUTOFF.toISOString(), collections: {} }

  for (const { name } of collections) {
    const collection = db.collection(name)
    const filter = { $or: [{ createdAt: { $lt: CUTOFF } }, ...dependencyFilters] }
    const matched = await collection.countDocuments(filter, session ? { session } : undefined)
    if (matched === 0) continue
    let deleted = 0
    if (execute) {
      const response = await collection.deleteMany(filter, session ? { session } : undefined)
      deleted = Number(response.deletedCount || 0)
    }
    result.collections[name] = { matched, deleted }
  }

  return result
}

async function main() {
  const execute = process.argv.includes('--execute')
  await mongoose.connect(process.env.MONGODB_URI || '')
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB is not connected')

  let result: CleanupResult
  if (execute) {
    const session = await mongoose.startSession()
    try {
      let transactionResult: CleanupResult | undefined
      await session.withTransaction(async () => {
        transactionResult = await cleanupPreJuly2026(db, true, session)
      })
      result = transactionResult!
    } finally {
      await session.endSession()
    }
  } else {
    result = await cleanupPreJuly2026(db, false)
  }

  console.log(JSON.stringify(result, null, 2))
  await mongoose.disconnect()
}

if (require.main === module) {
  void main().catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
}

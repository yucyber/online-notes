import mongoose, { Types } from 'mongoose'
import { NoteSchema } from '../src/modules/notes/schemas/note.schema'

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/notes'
  await mongoose.connect(uri)

  const NoteModel = mongoose.model('Note', NoteSchema)

  // 请将这些ID替换为实际环境中的标签ID（示例基于现有数据结构）：
  const tagC = new Types.ObjectId('6925652c2eae2ec502e4f144')
  const tagA = new Types.ObjectId('6925652c2eae2ec502e4f140')

  const singleAny = await NoteModel.find({
    $or: [
      { tags: { $in: [tagC] } },
      { tags: { $in: ['6925652c2eae2ec502e4f144'] } },
    ],
  }).sort({ createdAt: -1 })

  const multiAll = await NoteModel.find({
    $or: [
      { tags: { $all: [tagC, tagA] } },
      { tags: { $all: ['6925652c2eae2ec502e4f144', '6925652c2eae2ec502e4f140'] } },
    ],
  }).sort({ createdAt: -1 })

  console.log('单标签(任意) 返回数量:', singleAny.length)
  console.log('多标签(全部) 返回数量:', multiAll.length)

  await mongoose.disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

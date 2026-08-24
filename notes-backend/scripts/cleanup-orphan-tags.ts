import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';

// 加载项目根目录 .env，沿用后端统一的环境变量约定。
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/notes';

// 最小 Schema，仅用于读取/清洗 tags 字段，避免引入 NestJS 运行时依赖。
const NoteSchema = new mongoose.Schema(
  { title: String, userId: mongoose.Types.ObjectId, tags: [mongoose.Schema.Types.Mixed] },
  { timestamps: true, collection: 'notes' },
);
const TagSchema = new mongoose.Schema(
  { userId: mongoose.Types.ObjectId },
  { timestamps: true, collection: 'tags' },
);

const Note = mongoose.model('Note', NoteSchema);
const Tag = mongoose.model('Tag', TagSchema);

async function main() {
  const targetUserId = process.argv[2];
  if (!targetUserId) {
    console.error('用法: npx ts-node scripts/cleanup-orphan-tags.ts <userId>');
    console.error('示例: npx ts-node scripts/cleanup-orphan-tags.ts 693c227c49eab548ab436930');
    process.exit(1);
  }

  console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const userObj = new mongoose.Types.ObjectId(targetUserId);

  // 当前用户所有有效 tag id（ObjectId 形态）
  const validTags = await Tag.find({ userId: userObj }).select('_id').exec();
  const validIds = new Set(validTags.map((t) => t._id.toString()));

  // 当前用户所有笔记
  const notes = await Note.find({ userId: userObj }).exec();
  let orphanCount = 0;
  const affected: { id: string; title: string; removed: string[] }[] = [];

  for (const note of notes) {
    const tags = (note.tags || []).map((t: any) => String(t));
    const orphans = tags.filter((id) => !validIds.has(id));
    if (orphans.length === 0) continue;

    // 只保留仍然有效的 tag id，并把它们归一化为字符串（与现有 String 形态历史数据保持一致）
    const cleaned = tags.filter((id) => validIds.has(id));
    note.set('tags', cleaned);
    await note.save();

    orphanCount += orphans.length;
    affected.push({ id: String(note._id), title: note.get('title') || '(无标题)', removed: orphans });
  }

  console.log('\n===== 清理结果 =====');
  console.log(`清理了 ${orphanCount} 个悬空 tag id，涉及 ${affected.length} 篇笔记。`);
  for (const a of affected) {
    console.log(`- [${a.id}] ${a.title}`);
    console.log(`    移除: ${a.removed.join(', ')}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/notes';

// Minimal Schema Definition
const NoteSchema = new mongoose.Schema({
    title: String,
    content: String,
    userId: mongoose.Types.ObjectId,
    status: { type: String, default: 'published' },
    visibility: { type: String, default: 'private' },
    embedding: [Number],
    tags: [mongoose.Types.ObjectId],
    categoryIds: [mongoose.Types.ObjectId],
}, { timestamps: true });

const Note = mongoose.model('Note', NoteSchema);
const User = mongoose.model('User', new mongoose.Schema({ email: String, name: String }));

async function seed() {
    console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
    await mongoose.connect(MONGODB_URI);
    console.log('Connected.');

    // Debug: List all users
    const allUsers = await User.find({}, '_id email');
    console.log('Existing users in DB:', allUsers.map(u => `${u._id} (${u.get('email')})`).join(', '));

    // 1. Get a user
    // Hardcode the user ID. Based on system path (34850), the likely user is the QQ email one.
    const targetUserId = '693c227c49eab548ab436930'; // 3485085627@qq.com
    let user = await User.findById(targetUserId);

    if (!user) {
        console.log(`User ID ${targetUserId} not found. Trying email fallback...`);
        const targetEmail = '3485085627@qq.com';
        user = await User.findOne({ email: targetEmail });
    }

    if (!user) {
        console.log('No user found. Creating a test user...');
        user = await User.create({
            _id: new mongoose.Types.ObjectId(targetUserId),
            email: '3485085627@qq.com',
            name: 'Test User'
        });
    }
    console.log(`Using user: ${user._id} (${user.get('email')})`);

    // 2. Generate Mock Data
    // Cluster A: Frontend / React (High dimension values)
    const clusterA_Titles = [
        'React Hooks 深度解析',
        'Next.js 14 App Router 实战',
        'Tailwind CSS 最佳实践',
        '前端性能优化指南',
        'TypeScript 高级类型体操'
    ];

    // Cluster B: Backend / Infrastructure (Low dimension values)
    const clusterB_Titles = [
        'NestJS 依赖注入原理',
        'MongoDB 索引优化策略',
        'Docker 容器化部署',
        'Redis 缓存设计模式',
        '微服务架构设计'
    ];

    const notes = [];

    // Generate Cluster A (Vector values ~0.8)
    for (const title of clusterA_Titles) {
        notes.push({
            title,
            content: `This is a note about ${title}. It covers frontend technologies and modern web development practices.`,
            userId: user._id,
            status: 'published',
            visibility: 'private',
            embedding: Array(1024).fill(0).map(() => 0.8 + (Math.random() * 0.1)) // 0.8 - 0.9
        });
    }

    // Generate Cluster B (Vector values ~0.2)
    for (const title of clusterB_Titles) {
        notes.push({
            title,
            content: `This is a note about ${title}. It focuses on backend systems, databases, and infrastructure.`,
            userId: user._id,
            status: 'published',
            visibility: 'private',
            embedding: Array(1024).fill(0).map(() => 0.2 + (Math.random() * 0.1)) // 0.2 - 0.3
        });
    }

    // 3. Insert
    console.log(`Inserting ${notes.length} notes...`);
    await Note.insertMany(notes);
    console.log('Done!');

    await mongoose.disconnect();
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});

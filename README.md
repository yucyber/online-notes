# 在线知识笔记平台

一个全栈知识笔记管理平台，支持Markdown编辑、分类管理、标签系统、全文搜索等功能。

## 技术栈

### 前端
- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **UI组件**: 自定义组件库
- **状态管理**: React Hooks
- **表单验证**: React Hook Form + Zod
- **Markdown渲染**: react-markdown + react-syntax-highlighter
- **HTTP客户端**: Axios

### 后端
- **框架**: NestJS
- **语言**: TypeScript
- **数据库**: MongoDB (Mongoose)
- **认证**: JWT (Passport.js)
- **密码加密**: bcryptjs
- **验证**: class-validator

## 项目结构

```
online-notes/
├── notes-frontend/          # 前端项目
│   ├── src/
│   │   ├── app/             # Next.js App Router 页面
│   │   │   ├── (auth)/      # 认证相关页面（登录、注册）
│   │   │   ├── dashboard/   # 仪表盘页面
│   │   │   └── page.tsx     # 首页（重定向）
│   │   ├── components/      # React 组件
│   │   │   ├── editor/      # 编辑器组件
│   │   │   ├── layout/      # 布局组件
│   │   │   ├── notes/       # 笔记相关组件
│   │   │   └── ui/          # UI 基础组件
│   │   ├── lib/             # 工具函数和 API 封装
│   │   ├── types/           # TypeScript 类型定义
│   │   └── utils/           # 通用工具函数
│   └── package.json
│
├── notes-backend/           # 后端项目
│   ├── src/
│   │   ├── modules/         # 业务模块
│   │   │   ├── auth/        # 认证模块
│   │   │   ├── users/       # 用户模块
│   │   │   ├── notes/       # 笔记模块
│   │   │   ├── categories/  # 分类模块
│   │   │   ├── tags/        # 标签模块
│   │   │   └── dashboard/   # 仪表盘模块
│   │   ├── config/          # 配置文件
│   │   ├── app.module.ts    # 根模块
│   │   └── main.ts          # 入口文件
│   └── package.json
│
└── README.md
```

## 快速开始

### 前置要求

- Node.js >= 18.0.0
- MongoDB (本地安装或使用云数据库)
- npm 或 yarn

### 安装步骤

1. **克隆项目**

```bash
git clone <repository-url>
cd online-notes
```

2. **安装后端依赖**

```bash
cd notes-backend
npm install
```

3. **配置后端环境变量**

在 `notes-backend` 目录下创建 `.env` 文件：

```env
# MongoDB 连接字符串
MONGODB_URI=mongodb://localhost:27017/notes

# JWT 密钥（生产环境请使用随机字符串）
JWT_SECRET=your-secret-key-here

# 前端URL（用于CORS配置）
FRONTEND_URL=http://localhost:3000

# 服务端口
PORT=3001
```

4. **启动后端服务**

```bash
npm run dev
```

后端服务将在 `http://localhost:3001` 启动

5. **安装前端依赖**

```bash
cd ../notes-frontend
npm install
```

6. **配置前端环境变量**

在 `notes-frontend` 目录下创建 `.env.local` 文件：

```env
# 后端API地址
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

7. **启动前端服务**

```bash
npm run dev
```

前端应用将在 `http://localhost:3000` 启动

## 功能特性

### 已实现功能

- ✅ 用户注册和登录
- ✅ JWT 认证和授权
- ✅ 笔记的创建、编辑、删除、查看
- ✅ Markdown 编辑器（支持实时预览）
- ✅ 分类管理（支持颜色标识）
- ✅ 标签管理
- ✅ 笔记搜索（标题、内容、标签）
- ✅ 仪表盘概览（统计数据和最近编辑）
- ✅ 响应式设计（支持移动端）
- ✅ 用户设置页面

### 功能模块

#### 1. 认证模块
- 用户注册（邮箱 + 密码）
- 用户登录（JWT Token）
- 自动登录状态检测
- 登录状态持久化

#### 2. 笔记模块
- 创建新笔记
- 编辑笔记（Markdown 格式）
- 删除笔记
- 查看笔记详情
- 笔记列表展示
- 实时保存功能
- Markdown 实时预览

#### 3. 分类模块
- 创建分类（支持名称、描述、颜色）
- 编辑分类
- 删除分类
- 分类列表展示
- 分类统计（笔记数量）

#### 4. 标签模块
- 创建标签
- 删除标签
- 标签列表展示
- 笔记标签关联

#### 5. 仪表盘
- 数据统计（笔记数、分类数、标签数）
- 最近编辑笔记列表
- 热门分类展示

#### 6. 设置页面
- 账户信息查看
- 密码修改（待实现API）
- 偏好设置
- 退出登录

## API 接口文档

### 认证相关

#### POST /api/auth/register
注册新用户

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### POST /api/auth/login
用户登录

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应:**
```json
{
  "token": "jwt-token-string",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /api/auth/me
获取当前用户信息（需要认证）

**Headers:**
```
Authorization: Bearer <token>
```

### 笔记相关

#### GET /api/notes
获取所有笔记（需要认证）

**查询参数:**
- `category`: 可选，按分类筛选

#### GET /api/notes/:id
获取单个笔记详情（需要认证）

#### POST /api/notes
创建新笔记（需要认证）

**请求体:**
```json
{
  "title": "笔记标题",
  "content": "笔记内容（Markdown格式）",
  "categoryId": "category-id（可选）",
  "tags": ["tag-id-1", "tag-id-2"]
}
```

#### PATCH /api/notes/:id
更新笔记（需要认证）

#### DELETE /api/notes/:id
删除笔记（需要认证）

### 分类相关

#### GET /api/categories
获取所有分类（需要认证）

#### POST /api/categories
创建分类（需要认证）

**请求体:**
```json
{
  "name": "分类名称",
  "description": "分类描述（可选）",
  "color": "#3B82F6"
}
```

#### PATCH /api/categories/:id
更新分类（需要认证）

#### DELETE /api/categories/:id
删除分类（需要认证）

### 标签相关

#### GET /api/tags
获取所有标签（需要认证）

#### POST /api/tags
创建标签（需要认证）

**请求体:**
```json
{
  "name": "标签名称"
}
```

#### DELETE /api/tags/:id
删除标签（需要认证）

### 仪表盘

#### GET /api/dashboard/overview
获取仪表盘概览数据（需要认证）

**响应:**
```json
{
  "stats": {
    "notes": 10,
    "categories": 3,
    "tags": 5
  },
  "recentNotes": [...],
  "topCategories": [...]
}
```

## 开发指南

### 前端开发

```bash
cd notes-frontend
npm run dev        # 启动开发服务器
npm run build      # 构建生产版本
npm run start      # 启动生产服务器
npm run lint       # 代码检查
```

### 后端开发

```bash
cd notes-backend
npm run dev        # 启动开发服务器（nodemon）
npm run build      # 编译TypeScript
npm run start      # 启动生产服务器
```

## 部署

### 前端部署（Vercel）

1. 将项目推送到 GitHub
2. 在 Vercel 导入项目
3. 选择 `notes-frontend` 目录
4. 配置环境变量 `NEXT_PUBLIC_API_URL`
5. 部署

### 后端部署（Railway）

1. 在 Railway 创建新项目
2. 连接 GitHub 仓库
3. 选择 `notes-backend` 目录
4. 配置环境变量
5. 添加 MongoDB 服务（Railway 提供）
6. 部署

## 环境变量说明

### 后端 (.env)

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| MONGODB_URI | MongoDB 连接字符串 | mongodb://localhost:27017/notes |
| JWT_SECRET | JWT 密钥 | - |
| FRONTEND_URL | 前端URL（CORS） | http://localhost:3000 |
| PORT | 服务端口 | 3001 |

### 前端 (.env.local)

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| NEXT_PUBLIC_API_URL | 后端API地址 | http://localhost:3001/api |

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

如有问题或建议，请提交 Issue。


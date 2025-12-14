# 在线笔记项目集成 COZE AI + 画板 + 思维导图详细实施方案

## 一、技术栈与集成核心原则

| 技术层 | 选型 | 本地项目适配说明 |
| :--- | :--- | :--- |
| **前端框架** | Next.js 14 (App Router) | 位于 `notes-frontend`，使用 `'use client'` 处理交互逻辑。 |
| **状态管理** | React Context | 新增 `AIContext` 统一管理 AI 生成数据，与现有 Yjs 协作状态解耦。 |
| **画板组件** | Drawnix (`@drawnix/react-board`) | 位于 `notes-frontend/src/components/board`，适配现有 UI 风格。 |
| **思维导图** | Mind Elixir | 位于 `notes-frontend/src/components/mindmap`，用于渲染结构化数据。 |
| **后端框架** | NestJS | 位于 `notes-backend`，复用现有的 `mindmaps` 和 `boards` 模块。 |
| **数据库** | MongoDB (Mongoose) | 复用现有的数据库连接，扩展 Schema 存储 JSON 数据。 |
| **AI 平台** | COZE (扣子) | 通过 SDK 集成，后端仅透传 Key 或前端直接调用（推荐前端直接调用以减少延迟）。 |

**集成核心原则**：
1.  **模块复用**：优先复用 `notes-backend` 中已存在的 `mindmaps` 和 `boards` 模块，避免重复造轮子。
2.  **统一接口**：前端 API 请求应集成到 `notes-frontend/src/lib/api.ts`，遵循现有的 Axios 封装和拦截器逻辑。
3.  **客户端优先**：AI SDK 和图形组件仅在客户端加载，避免 SSR 兼容性问题。
4.  **页面替换**：直接替换现有的占位页面 `src/app/dashboard/mindmaps/[id]/page.tsx` 和 `src/app/dashboard/boards/[id]/page.tsx`。

## 二、分步实现流程

### 步骤 1：COZE AI 平台配置与 SDK 准备

#### 1.1 COZE 智能体配置
1.  登录 [COZE 平台](https://www.coze.cn/)，创建「在线笔记 AI 助手」。
2.  **Prompt 设定**：
    ```text
    角色：在线笔记专属 AI 助手。
    任务：
    1. 接收文本，输出思维导图 JSON：{root: string, nodes: [{id: string, content: string, children: []}]}。
    2. 接收思维导图 JSON，优化 content 内容。
    约束：必须返回标准 JSON 格式，无 Markdown 代码块包裹。
    ```
3.  **插件**：启用 `TreeMap` (可选) 或仅使用 LLM 的结构化输出能力。
4.  **发布**：发布为 API 服务，获取 `Bot ID` 和 `API Key`。

#### 1.2 前端 SDK 封装 (`notes-frontend/src/lib/coze.ts`)

```typescript
// notes-frontend/src/lib/coze.ts
'use client';
import { CozeClient, ChatEventType, RoleType } from '@coze/web-sdk';

let cozeClient: CozeClient | null = null;

const initCozeClient = () => {
  if (cozeClient) return cozeClient;
  
  // 1. 定义常量存储三个参数（建议放到环境变量中，不要硬编码！）
  const apiKey = process.env.NEXT_PUBLIC_COZE_API_KEY; // 你的API Key (以pat_开头的令牌)
  const botId = process.env.NEXT_PUBLIC_COZE_BOT_ID; // 你的Agent ID (智能体ID，字符串)
  const apiVersion = process.env.NEXT_PUBLIC_COZE_API_VERSION || 'v1'; // API版本固定为v1

  if (!apiKey || !botId) {
    throw new Error('COZE 配置缺失，请检查环境变量');
  }

  try {
    // 2. 初始化coze客户端时，传入这三个参数
    cozeClient = new CozeClient({
      token: apiKey, // ① API Key填这里
      // 注意：新版SDK可能不需要在初始化时传入botId，而是在调用chat时传入，但部分版本可能支持全局配置
      // 如果SDK版本支持，可以在这里传入 agentId: botId 
      allowPersonalAccessTokenInBrowser: true, // 允许浏览器端调用
      baseUrl: 'https://api.coze.cn',
    });
    return cozeClient;
  } catch (error) {
    console.error('COZE客户端初始化失败：', error);
    throw new Error('AI服务初始化失败，请检查配置');
  }
};

export const getAIMindMapData = async (noteContent: string) => {
  const client = initCozeClient();
  const botId = process.env.NEXT_PUBLIC_COZE_BOT_ID!; // ② Agent ID 在调用时填这里

  try {
    const stream = await client.chat.stream({
      bot_id: botId,
      additional_messages: [
        { role: RoleType.User, content: `生成思维导图：${noteContent}`, content_type: 'text' }
      ],
    });

    let fullContent = '';
    for await (const part of stream) {
      if (part.event === ChatEventType.CONVERSATION_MESSAGE_DELTA) {
        fullContent += part.data.content;
      }
    }

    // 尝试解析 JSON，处理可能的 Markdown 包裹
    const jsonStr = fullContent.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('COZE AI 调用失败:', error);
    throw error;
  }
};
```

### 步骤 2：全局状态管理 (`notes-frontend/src/context/AIContext.tsx`)

```typescript
// notes-frontend/src/context/AIContext.tsx
'use client';
import { createContext, useState, ReactNode, useContext } from 'react';

export type MindMapNode = {
  id: string;
  content: string;
  children: MindMapNode[];
};

export type MindMapData = {
  root: string;
  nodes: MindMapNode[];
};

interface AIContextType {
  mindMapData: MindMapData | null;
  setMindMapData: (data: MindMapData | null) => void;
  isAILoading: boolean;
  setIsAILoading: (status: boolean) => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export const AIProvider = ({ children }: { children: ReactNode }) => {
  const [mindMapData, setMindMapData] = useState<MindMapData | null>(null);
  const [isAILoading, setIsAILoading] = useState(false);

  return (
    <AIContext.Provider value={{ mindMapData, setMindMapData, isAILoading, setIsAILoading }}>
      {children}
    </AIContext.Provider>
  );
};

export const useAI = () => {
  const context = useContext(AIContext);
  if (!context) throw new Error('useAI must be used within AIProvider');
  return context;
};
```

**集成点**：在 `notes-frontend/src/app/layout.tsx` 中包裹 `AIProvider`。

### 步骤 3：组件开发与页面集成

#### 3.1 画板组件 (`notes-frontend/src/components/board/DrawnixBoard.tsx`)
*   **依赖**：`npm install @drawnix/react-board plait-core uuid`
*   **逻辑**：
    *   使用 `useAI` 获取数据。
    *   调用 `getAIMindMapData` 生成数据。
    *   使用 `notes-frontend/src/lib/api.ts` 中的方法保存数据到后端。

#### 3.2 思维导图组件 (`notes-frontend/src/components/mindmap/MindElixirMap.tsx`)
*   **依赖**：`npm install mind-elixir`
*   **逻辑**：
    *   初始化 `MindElixir` 实例。
    *   监听 `nodeChange` 事件同步数据。

#### 3.3 页面集成 (替换现有占位页面)

**思维导图页面** (`notes-frontend/src/app/dashboard/mindmaps/[id]/page.tsx`):
*   **现状**：仅显示标题和“功能占位”文本。
*   **修改**：
    *   引入 `MindElixirMap` 组件。
    *   使用 `mindmapsAPI.get(id)` 获取初始数据。
    *   将数据传递给 `MindElixirMap` 进行渲染。
    *   添加“AI 生成”按钮，调用 `getAIMindMapData` 并更新视图。

**画板页面** (`notes-frontend/src/app/dashboard/boards/[id]/page.tsx`):
*   **现状**：仅显示标题和“功能占位”文本。
*   **修改**：
    *   引入 `DrawnixBoard` 组件。
    *   使用 `boardsAPI.get(id)` 获取初始数据。
    *   将数据传递给 `DrawnixBoard` 进行渲染。

### 步骤 4：后端接口适配

#### 4.1 扩展现有模块
*   **Mindmaps 模块** (`notes-backend/src/modules/mindmaps`):
    *   更新 Schema (`schemas/mindmap.schema.ts`) 以支持存储 JSON 结构 (添加 `content` 或 `data` 字段，类型为 `Mixed`)。
    *   更新 Service (`mindmaps.service.ts`) 添加 `updateContent` 逻辑。
*   **Boards 模块** (`notes-backend/src/modules/boards`):
    *   同上，适配 Drawnix 的数据格式。

#### 4.2 API 客户端扩展 (`notes-frontend/src/lib/api.ts`)
在现有的 `api` 实例基础上添加方法：

```typescript
// notes-frontend/src/lib/api.ts (追加内容)

export const saveMindMap = async (noteId: string, data: any) => {
  return api.post('/mindmaps', { noteId, data });
};

export const getMindMap = async (noteId: string) => {
  return api.get(\`/mindmaps/\${noteId}\`);
};

export const saveBoard = async (noteId: string, data: any) => {
  return api.post('/boards', { noteId, data });
};

export const getBoard = async (noteId: string) => {
  return api.get(\`/boards/\${noteId}\`);
};
```

## 三、错误处理与注意事项

1.  **环境变量**：
    *   前端 `.env.local` 需配置以下三个关键参数：
        ```env
        NEXT_PUBLIC_COZE_API_KEY=你的API Key (以pat_开头的令牌)
        NEXT_PUBLIC_COZE_BOT_ID=你的Agent ID (智能体ID)
        NEXT_PUBLIC_COZE_API_VERSION=v1
        ```
    *   注意不要将 Key 提交到 Git。
2.  **类型安全**：
    *   严格定义 API 返回的数据类型，避免 `any`。
    *   后端 DTO 需使用 `class-validator` 进行校验。
3.  **样式隔离**：
    *   Mind Elixir 的 CSS 可能会影响全局样式，建议使用 CSS Module 或 Tailwind 的 `isolate` 类。
4.  **SSR 兼容**：
    *   所有涉及 Canvas 或 DOM 操作的组件（画板、思维导图）必须使用 `next/dynamic` 引入，并设置 `ssr: false`。

## 四、后续优化
*   **协同编辑**：目前方案为单人编辑 + 覆盖保存。后续可结合 Yjs (`y-websocket`) 实现多人实时协作。
*   **版本控制**：利用现有的 `versions` 模块，为画板和思维导图添加历史版本支持。
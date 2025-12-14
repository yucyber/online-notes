'use client';
import React, { useState, useEffect } from 'react';
import { saveBoard } from '@/lib/api';
import { Excalidraw, MainMenu, WelcomeScreen, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { getAIMermaidData } from '@/lib/coze';
import { Sparkles, X, PlusSquare } from 'lucide-react';
// 引入 Excalidraw 样式，防止 UI 图标显示异常
import "@excalidraw/excalidraw/index.css";

// 辅助函数：计算元素组的边界
const getElementsBounds = (elements: any[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    elements.forEach(el => {
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
        maxX = Math.max(maxX, el.x + el.width);
        maxY = Math.max(maxY, el.y + el.height);
    });

    return { minX, minY, width: maxX - minX, height: maxY - minY };
};

// 辅助函数：尝试用素材库项目替换生成的元素
const replaceWithLibraryItems = (elements: any[], libraryItems: any[]) => {
    console.log('[AI Replace] Starting. Elements:', elements.length, 'Library Items:', libraryItems?.length);
    if (!libraryItems || libraryItems.length === 0) return elements;

    // 1. 建立素材库索引 (名称 -> 元素列表)
    const libraryMap = new Map();
    libraryItems.forEach(item => {
        if (item.name) {
            // 支持中文和英文匹配，忽略大小写
            const key = item.name.toLowerCase().trim();
            libraryMap.set(key, item.elements);
            console.log('[AI Replace] Indexed item:', key);
        }
    });

    if (libraryMap.size === 0) return elements;

    const elementsToRemove = new Set();
    const elementsToAdd: any[] = [];

    // 2. 遍历生成的元素，寻找匹配的文本节点
    elements.forEach(el => {
        if (el.type === 'text') {
            // 预处理文本：去除换行符，将多个空格合并为一个，转为小写
            const rawText = el.text || '';
            const normalizedText = rawText.toLowerCase().replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

            console.log('[AI Replace] Checking text:', { raw: rawText, normalized: normalizedText });

            // 改进匹配逻辑：查找文本中是否包含任何素材名称
            // 优先匹配最长的名称，以避免部分匹配错误 (例如 "User Profile" 优于 "User")
            let bestMatchName = null;
            let maxLen = 0;

            for (const name of libraryMap.keys()) {
                // 检查归一化后的文本是否包含素材名称
                // 或者素材名称是否包含归一化后的文本 (处理 AI 生成文本不完整的情况)
                if (normalizedText.includes(name)) {
                    if (name.length > maxLen) {
                        maxLen = name.length;
                        bestMatchName = name;
                    }
                }
            }

            // 检查是否有匹配的素材
            if (bestMatchName) {
                console.log('[AI Replace] Match found:', bestMatchName, '->', normalizedText);
                const libElements = libraryMap.get(bestMatchName);

                // 3. 计算位置偏移，将素材居中放置在原文本位置
                const textCx = el.x + el.width / 2;
                const textCy = el.y + el.height / 2;

                const { minX, minY, width, height } = getElementsBounds(libElements);
                const libCx = minX + width / 2;
                const libCy = minY + height / 2;

                const offsetX = textCx - libCx;
                const offsetY = textCy - libCy;

                // 4. 克隆并平移素材元素
                // 生成新的 Group ID 以保持素材内部的组合关系
                const newGroupId = `group_${Math.random().toString(36).substr(2, 9)}`;
                const oldGroupIdsMap = new Map(); // 旧 GroupID -> 新 GroupID 映射

                const placedLibElements = libElements.map((libEl: any) => {
                    // 处理 Group ID
                    let currentGroupIds = [];
                    if (libEl.groupIds && libEl.groupIds.length > 0) {
                        currentGroupIds = libEl.groupIds.map((gid: string) => {
                            if (!oldGroupIdsMap.has(gid)) {
                                oldGroupIdsMap.set(gid, `group_${Math.random().toString(36).substr(2, 9)}`);
                            }
                            return oldGroupIdsMap.get(gid);
                        });
                    } else {
                        // 如果素材本身没有编组，我们给它统一编个组方便管理
                        currentGroupIds = [newGroupId];
                    }

                    return {
                        ...libEl,
                        id: `${libEl.id}_${Math.random().toString(36).substr(2, 9)}`, // 重新生成 ID
                        x: libEl.x + offsetX,
                        y: libEl.y + offsetY,
                        groupIds: currentGroupIds,
                        seed: Math.floor(Math.random() * 2 ** 31), // 随机种子
                        version: 1, // 重置版本
                        versionNonce: Math.floor(Math.random() * 2 ** 31),
                    };
                });

                elementsToAdd.push(...placedLibElements);

                // 5. 标记需要移除的旧元素 (文本及其所在的容器)
                if (el.groupIds && el.groupIds.length > 0) {
                    const groupId = el.groupIds[0];
                    elements.forEach((other: any) => {
                        if (other.groupIds && other.groupIds.includes(groupId)) {
                            elementsToRemove.add(other.id);
                        }
                    });
                } else {
                    // 如果没有编组，尝试查找与文本重叠的矩形容器 (简单的启发式)
                    elementsToRemove.add(el.id);

                    // 查找包含该文本中心的容器
                    const cx = el.x + el.width / 2;
                    const cy = el.y + el.height / 2;
                    const container = elements.find(other =>
                        other.id !== el.id &&
                        ['rectangle', 'diamond', 'ellipse'].includes(other.type) &&
                        other.x <= cx && other.x + other.width >= cx &&
                        other.y <= cy && other.y + other.height >= cy
                    );

                    if (container) {
                        console.log('[AI Replace] Removing container:', container.type);
                        elementsToRemove.add(container.id);
                    }
                }
            }
        }
    });

    // 过滤掉被替换的元素，添加新元素
    const finalElements = [
        ...elements.filter(e => !elementsToRemove.has(e.id)),
        ...elementsToAdd
    ];

    // 再次标准化所有元素，防止 Linear element is not normalized 错误
    return convertToExcalidrawElements(finalElements);
};

interface DrawnixBoardProps {
    id: string;
    initialData: any;
    readonly?: boolean;
}

const DrawnixBoard: React.FC<DrawnixBoardProps> = ({ id, initialData, readonly = false }) => {
    const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [showAIDialog, setShowAIDialog] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    // 初始化 libraryItems，优先从 initialData 中获取
    const [libraryItems, setLibraryItems] = useState<any>(() => {
        if (initialData && initialData.libraryItems) {
            return initialData.libraryItems;
        }
        return [];
    });

    // 处理初始数据：兼容旧版 imageData 或新版 Excalidraw 数据
    // 使用函数式初始化，确保首次渲染时就有数据
    const [initData, setInitData] = useState<any>(() => {
        if (initialData) {
            if (initialData.elements) {
                return initialData;
            }
        }
        return null;
    });

    useEffect(() => {
        if (initialData) {
            if (initialData.elements) {
                // 已经是 Excalidraw 格式
                setInitData(initialData);
                if (initialData.libraryItems) {
                    setLibraryItems(initialData.libraryItems);
                }
            } else if (initialData.imageData) {
                // 旧版图片数据，无法直接编辑，暂不处理或仅提示
                console.warn('Legacy image data detected, starting fresh.');
            }
        }
    }, [initialData]);

    // 当 excalidrawAPI 就绪且有 libraryItems 时，尝试更新库
    // 这确保了即使 initialData 没能正确初始化库，也能通过 API 补救
    useEffect(() => {
        if (excalidrawAPI && libraryItems && libraryItems.length > 0) {
            // 检查当前库是否为空，或者是否需要合并
            // 这里简单地进行合并更新
            try {
                excalidrawAPI.updateLibrary({
                    libraryItems: libraryItems,
                    merge: true
                });
            } catch (e) {
                console.error("Failed to update library", e);
            }
        }
    }, [excalidrawAPI]); // 仅在 API 就绪时执行一次，避免循环更新

    // 监听 URL hash 中的 addLibrary 参数，手动导入素材库

    // 监听 URL hash 中的 addLibrary 参数，手动导入素材库
    useEffect(() => {
        if (!excalidrawAPI) return;

        const handleHashChange = async () => {
            const hash = window.location.hash;
            const params = new URLSearchParams(hash.slice(1));
            const libraryUrl = params.get('addLibrary');

            if (libraryUrl) {
                try {
                    const response = await fetch(decodeURIComponent(libraryUrl));
                    const blob = await response.blob();
                    const text = await blob.text();
                    const data = JSON.parse(text);

                    let items = [];
                    if (Array.isArray(data)) {
                        items = data;
                    } else if (data.libraryItems) {
                        items = data.libraryItems;
                    } else if (data.library) {
                        items = data.library;
                    }

                    if (items.length > 0) {
                        excalidrawAPI.updateLibrary({
                            libraryItems: items,
                            merge: true,
                            openLibraryMenu: true
                        });
                        // 清除 hash
                        window.history.replaceState(null, '', window.location.pathname);
                    }
                } catch (error) {
                    console.error('Failed to load library:', error);
                }
            }
        };

        handleHashChange();
    }, [excalidrawAPI]);

    const handleSave = async () => {
        if (!excalidrawAPI) return;
        setIsSaving(true);
        try {
            const elements = excalidrawAPI.getSceneElements();
            const appState = excalidrawAPI.getAppState();
            const files = excalidrawAPI.getFiles();

            const content = {
                elements,
                appState: {
                    viewBackgroundColor: appState.viewBackgroundColor,
                    currentItemFontFamily: appState.currentItemFontFamily,
                    currentItemStrokeColor: appState.currentItemStrokeColor,
                    currentItemBackgroundColor: appState.currentItemBackgroundColor,
                    currentItemFillStyle: appState.currentItemFillStyle,
                    currentItemStrokeWidth: appState.currentItemStrokeWidth,
                    currentItemStrokeStyle: appState.currentItemStrokeStyle,
                    currentItemRoughness: appState.currentItemRoughness,
                    currentItemOpacity: appState.currentItemOpacity,
                    gridSize: appState.gridSize,
                },
                files,
                libraryItems,
            };

            await saveBoard(id, content);
            // alert('保存成功'); // 移除弹窗，体验更好
        } catch (err) {
            console.error('保存失败', err);
            alert('保存失败');
        } finally {
            setIsSaving(false);
        }
    };

    // 当打开 AI 对话框时，主动刷新一次素材库
    useEffect(() => {
        if (showAIDialog && excalidrawAPI) {
            const fetchLibrary = async () => {
                try {
                    const items = await excalidrawAPI.updateLibrary({
                        libraryItems: [],
                        merge: true,
                        openLibraryMenu: false
                    });
                    if (items) {
                        setLibraryItems(items);
                    }
                } catch (err) {
                    console.warn('Failed to refresh library items', err);
                }
            };
            fetchLibrary();
        }
    }, [showAIDialog, excalidrawAPI]);

    const handleAddLibraryItem = () => {
        if (!excalidrawAPI) return;

        const elements = excalidrawAPI.getSceneElements();
        const appState = excalidrawAPI.getAppState();
        const selectedElementIds = appState.selectedElementIds;

        // selectedElementIds is object { [id]: boolean }
        const selectedElements = elements.filter((el: any) => selectedElementIds[el.id]);

        if (selectedElements.length === 0) {
            alert('请先在画布上选择一个或多个元素，然后点击此按钮将其注册为 AI 素材。');
            return;
        }

        const name = prompt('请输入素材名称 (英文，例如: Database, User):\nAI 将根据此名称来引用素材。');
        if (!name || !name.trim()) return;

        // 创建新素材项
        const newItem = {
            id: Date.now().toString(),
            status: "published",
            elements: selectedElements.map((el: any) => ({ ...el })), // 简单克隆
            name: name.trim(),
            created: Date.now(),
        };

        // 更新本地状态和 Excalidraw 库
        // 注意：这里我们不覆盖旧的，而是追加新的。用户可以在库面板中手动删除旧的无名素材。
        const newItems = [newItem, ...libraryItems];
        setLibraryItems(newItems);

        excalidrawAPI.updateLibrary({
            libraryItems: newItems,
            openLibraryMenu: true
        });

        alert(`已添加素材 "${name}"！\n现在您可以在 AI 生成对话框中看到它了。`);
    };

    const handleAIGenerate = async () => {
        if (!aiPrompt.trim()) return;
        setIsGenerating(true);
        try {
            // 提取素材库中的项目名称
            const availableIcons = libraryItems
                .filter((item: any) => item.name)
                .map((item: any) => item.name);

            console.log('Available icons for AI:', availableIcons);

            const mermaidCode = await getAIMermaidData(aiPrompt, availableIcons);
            const { elements } = await parseMermaidToExcalidraw(mermaidCode, { fontSize: 16 });

            // 统一调整样式：手写体、细线条、手绘感 (可爱风格)
            elements.forEach((el: any) => {
                el.roughness = 1;
                el.strokeWidth = 1;
                el.fillStyle = 'hachure'; // 强制使用手绘填充
                el.strokeSharpness = 'round'; // 圆润拐角

                if (el.type === 'text') {
                    el.fontFamily = 1; // Virgil
                    el.fontSize = 16;
                }
            });

            if (excalidrawAPI) {
                // 将新生成的元素添加到现有场景中
                const currentElements = excalidrawAPI.getSceneElements();

                // 转换 Mermaid 元素为标准 Excalidraw 元素
                const standardElements = convertToExcalidrawElements(elements);

                // 智能替换：使用素材库中的项目替换匹配的节点
                const finalElements = replaceWithLibraryItems(standardElements, libraryItems);

                excalidrawAPI.updateScene({
                    elements: [
                        ...currentElements,
                        ...finalElements
                    ]
                });
            }
            setShowAIDialog(false);
            setAiPrompt('');
        } catch (e) {
            console.error(e);
            alert('生成失败: ' + (e as Error).message);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="h-full flex flex-col relative">
            {!readonly && (
                <div className="p-2 border-b flex justify-between items-center bg-gray-50">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">专业白板 (Excalidraw)</span>
                        {isSaving && <span className="text-xs text-gray-400">保存中...</span>}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleAddLibraryItem}
                            className="flex items-center gap-1 px-3 py-1 text-gray-600 hover:bg-gray-100 rounded text-sm transition-colors"
                            title="选中画布上的元素，点击此按钮将其注册为带名称的素材"
                        >
                            <PlusSquare size={14} />
                            注册素材
                        </button>
                        <button
                            onClick={() => setShowAIDialog(true)}
                            className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm transition-colors"
                        >
                            <Sparkles size={14} />
                            AI 生成图表
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
                        >
                            {isSaving ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>
            )}
            <div className="flex-1 w-full h-full overflow-hidden bg-white relative">
                <Excalidraw
                    initialData={initData}
                    excalidrawAPI={(api) => setExcalidrawAPI(api)}
                    langCode="zh-CN"
                    viewModeEnabled={readonly}
                    onLibraryChange={(items) => setLibraryItems(items)}
                    UIOptions={{
                        canvasActions: {
                            saveToActiveFile: false,
                            loadScene: false,
                            export: { saveFileToDisk: !readonly },
                            saveAsImage: !readonly,
                        }
                    }}
                >
                    <MainMenu>
                        <MainMenu.DefaultItems.Export />
                        <MainMenu.DefaultItems.SaveAsImage />
                        <MainMenu.DefaultItems.ClearCanvas />
                        <MainMenu.DefaultItems.ChangeCanvasBackground />
                        <MainMenu.DefaultItems.Help />
                    </MainMenu>
                    <WelcomeScreen />
                </Excalidraw>
            </div>

            {/* AI Dialog */}
            {showAIDialog && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-lg shadow-xl w-[400px] p-4 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-medium flex items-center gap-2">
                                <Sparkles className="text-purple-600" size={18} />
                                AI 图表生成
                            </h3>
                            <button onClick={() => setShowAIDialog(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">描述你想要的图表</label>
                                <textarea
                                    value={aiPrompt}
                                    onChange={(e) => setAiPrompt(e.target.value)}
                                    placeholder="例如：画一个用户登录注册的流程图，包含忘记密码的分支..."
                                    className="w-full h-32 p-3 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                                    autoFocus
                                />
                                <div className="text-xs text-gray-400 mt-1 flex flex-col gap-1">
                                    <div className="flex justify-between items-center w-full">
                                        <span>支持 Mermaid 语法描述</span>
                                        {libraryItems.length > 0 && (
                                            <span className="text-purple-600 font-medium">
                                                已加载 {libraryItems.length} 个素材
                                            </span>
                                        )}
                                    </div>
                                    {libraryItems.length > 0 && (
                                        <div className="flex flex-col gap-1 w-full">
                                            <div className="text-[10px] text-gray-500 truncate">
                                                可用: {libraryItems.filter((i: any) => i.name && i.name.trim()).map((i: any) => i.name).join(', ') || '无'}
                                            </div>
                                            {libraryItems.some((i: any) => !i.name || !i.name.trim()) && (
                                                <div className="text-[10px] text-amber-600 bg-amber-50 p-1 rounded border border-amber-100">
                                                    ⚠️ 检测到 {libraryItems.filter((i: any) => !i.name || !i.name.trim()).length} 个未命名素材。
                                                    <br />请在右侧素材库中切换到列表视图并重命名，否则 AI 无法使用。
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowAIDialog(false)}
                                    className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleAIGenerate}
                                    disabled={isGenerating || !aiPrompt.trim()}
                                    className="flex items-center gap-2 px-4 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isGenerating ? (
                                        <>
                                            <span className="animate-spin">⏳</span>
                                            生成中...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={14} />
                                            开始生成
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


export default DrawnixBoard;

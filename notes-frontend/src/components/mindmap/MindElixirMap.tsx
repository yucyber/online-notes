'use client';
import React, { useEffect, useRef, useState } from 'react';
import MindElixir from 'mind-elixir';
// 引入样式文件，修复 UI 显示异常
import 'mind-elixir/style';
import { useAI } from '@/context/AIContext';
import { saveMindMap } from '@/lib/api';

interface MindElixirMapProps {
    id: string;
    initialData: any;
    readonly?: boolean;
}

const MindElixirMap: React.FC<MindElixirMapProps> = ({ id, initialData, readonly = false }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [mindElixirInstance, setMindElixirInstance] = useState<any>(null);
    const { mindMapData, setMindMapData } = useAI();

    useEffect(() => {
        if (!containerRef.current) return;

        // 清理容器，防止 React Strict Mode 下重复渲染
        containerRef.current.innerHTML = '';

        const DEFAULT_DATA = {
            nodeData: {
                id: 'root',
                topic: '新建思维导图',
                root: true,
                children: []
            },
            linkData: {}
        };

        // 确保 initialData 是有效的 MindElixir 数据结构
        let data = DEFAULT_DATA;
        if (initialData && typeof initialData === 'object') {
            if (initialData.nodeData) {
                data = initialData;
            } else if (initialData.root) {
                // 兼容旧格式或 AI 生成格式
                data = {
                    nodeData: {
                        id: 'root',
                        topic: initialData.root.topic || '新建思维导图',
                        root: true,
                        children: initialData.root.children || []
                    },
                    linkData: {}
                };
            }
        }

        // Deep clone data to avoid mutation and ensure valid JSON
        let safeData = DEFAULT_DATA;
        try {
            if (data) {
                const stringified = JSON.stringify(data);
                if (stringified) {
                    safeData = JSON.parse(stringified);
                } else {
                    console.warn('JSON.stringify returned undefined for data:', data);
                }
            }
        } catch (e) {
            console.error('Data sanitization failed:', e);
        }

        const options = {
            el: containerRef.current,
            direction: (MindElixir.LEFT || 2) as 0 | 1 | 2,
            data: safeData,
            draggable: !readonly,
            contextMenu: !readonly,
            toolBar: !readonly,
            nodeMenu: !readonly,
            keypress: !readonly,
            editable: !readonly,
            locale: 'zh_CN' as any
        };

        console.log('Initializing MindElixir with options:', options);

        try {
            const me = new MindElixir(options);

            // 扩展渲染逻辑：支持图片显示
            me.bus.addListener('operation', (operation: any) => {
                if (operation.name === 'finishRender') {
                    // 尝试匹配 MindElixir 的节点元素 (兼容 v5+ 的 me-tp 和旧版的 .mind-elixir-node)
                    const topicNodes = containerRef.current?.querySelectorAll('me-tp, .mind-elixir-node');

                    topicNodes?.forEach((node) => {
                        // 获取节点 ID
                        const id = node.getAttribute('data-nodeid');
                        if (!id) return;

                        // @ts-expect-error: MindElixir types are incomplete
                        const nodeData = me.nodeDataMap[id];
                        if (nodeData?.data?.image) {
                            // 防止重复添加图片
                            if (node.querySelector('img')) return;

                            const img = document.createElement('img');
                            img.src = nodeData.data.image;
                            img.style.maxWidth = '120px';
                            img.style.display = 'block';
                            img.style.marginTop = '5px';
                            node.appendChild(img);
                        }
                    });
                }
            });

            me.init(safeData); // Pass data to init to ensure correct rendering
            setMindElixirInstance(me);
        } catch (err) {
            console.error('MindElixir init error:', err);
        }

        // 监听数据变化并保存
        // MindElixir 没有直接的 change 事件，这里简化处理，手动保存或定时保存
        // 实际项目中可以监听操作事件

        return () => {
            // Cleanup if needed
        };
    }, []);

    // 当 AI 生成数据时，更新导图
    useEffect(() => {
        if (mindMapData && mindElixirInstance) {
            let newData;

            // Check if data is already in MindElixir format (has nodeData)
            if ((mindMapData as any).nodeData) {
                newData = mindMapData;
            } else {
                // 转换 AI 数据格式到 MindElixir 格式
                // 假设 AI 返回 { root: "Topic", nodes: [...] }
                const transformNode = (node: any): any => ({
                    topic: node.content,
                    id: node.id || 'node_' + Math.random().toString(36).substr(2, 9),
                    children: node.children ? node.children.map(transformNode) : []
                });

                newData = {
                    nodeData: {
                        topic: mindMapData.root || 'AI Result',
                        id: 'root',
                        children: (mindMapData.nodes || []).map(transformNode)
                    },
                    linkData: {}
                };
            }

            // 深度克隆数据，确保没有 undefined 值，防止 JSON 错误
            let cleanData;
            try {
                cleanData = JSON.parse(JSON.stringify(newData));
            } catch (e) {
                console.error('JSON serialization failed:', e);
                cleanData = {
                    nodeData: { id: 'root', topic: 'Error', root: true, children: [] },
                    linkData: {}
                };
            }

            try {
                // 重新初始化前必须清理容器，防止工具栏重复和 DOM 堆叠
                if (containerRef.current) {
                    containerRef.current.innerHTML = '';

                    const options = {
                        el: containerRef.current,
                        direction: (MindElixir.LEFT || 2) as 0 | 1 | 2,
                        data: cleanData,
                        draggable: true,
                        contextMenu: true,
                        toolBar: true,
                        nodeMenu: true,
                        keypress: true,
                        locale: 'zh_CN' as any
                    };

                    const me = new MindElixir(options);

                    // 扩展渲染逻辑：支持图片显示
                    me.bus.addListener('operation', (operation: any) => {
                        if (operation.name === 'finishRender') {
                            const nodeElements = containerRef.current?.querySelectorAll('me-tp');
                            nodeElements?.forEach((node) => {
                                const id = node.getAttribute('data-nodeid');
                                if (!id) return;

                                // @ts-expect-error: MindElixir types are incomplete
                                const nodeData = me.nodeDataMap[id];
                                if (nodeData?.data?.image) {
                                    if (node.querySelector('img')) return;
                                    const img = document.createElement('img');
                                    img.src = nodeData.data.image;
                                    img.style.maxWidth = '120px';
                                    img.style.display = 'block';
                                    img.style.marginTop = '5px';
                                    node.appendChild(img);
                                }
                            });
                        }
                    });

                    me.init(cleanData); // Explicitly pass data to init
                    setMindElixirInstance(me);

                    // 自动选中根节点，方便用户直接操作
                    // 注意：MindElixir 实例可能需要一点时间才能准备好 DOM
                    setTimeout(() => {
                        try {
                            // 尝试选中根节点 (具体 API 可能因版本而异，这里尝试常见方法)
                            // me.selectNode(me.nodes.root); 
                            // 或者触发点击
                            const rootEl = containerRef.current?.querySelector('me-root');
                            if (rootEl) (rootEl as HTMLElement).click();
                        } catch { }
                    }, 500);
                }
            } catch (e) {
                console.error('Failed to refresh Mind Map:', e);
            }

            saveMindMap(id, cleanData); // 保存到后端
            setMindMapData(null); // 清空 AI 数据，避免重复应用
        }
    }, [mindMapData, mindElixirInstance, id, setMindMapData]);

    const handleSave = () => {
        if (mindElixirInstance) {
            const data = mindElixirInstance.getData();
            saveMindMap(id, data).then(() => {
                alert('保存成功');
            }).catch(err => {
                console.error('保存失败', err);
                alert('保存失败');
            });
        }
    };

    return (
        <div className="h-full flex flex-col">
            <style jsx global>{`
                .mind-elixir-toolbar svg {
                    width: 24px;
                    height: 24px;
                }
                /* 修复 Tailwind 可能导致的 SVG 尺寸异常 */
                .map-container svg {
                    max-width: none; 
                }
                /* 修复全屏变黑问题 */
                :fullscreen {
                    background-color: #ffffff;
                }
                /* 修复工具栏按钮鼠标样式 */
                .mind-elixir-toolbar button {
                    cursor: pointer;
                }
            `}</style>
            {!readonly && (
                <div className="p-2 border-b flex justify-between items-center bg-gray-50">
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500">思维导图编辑器</span>
                        <div className="text-xs text-gray-400 flex gap-2">
                            <span>提示: 选中节点后可使用工具栏按钮</span>
                            <span>Enter: 添加同级</span>
                            <span>Tab: 添加子级</span>
                        </div>
                    </div>
                    <button
                        onClick={handleSave}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                        保存
                    </button>
                </div>
            )}
            <div ref={containerRef} className="flex-1 w-full h-full overflow-hidden" />
        </div>
    );
};

export default MindElixirMap;

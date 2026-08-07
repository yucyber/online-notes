'use client';
import React, { useEffect, useRef } from 'react';
import MindElixir from 'mind-elixir';
// 引入样式文件，修复 UI 显示异常
import 'mind-elixir/style';
import { useAI } from '@/context/AIContext';
import { mindmapsAPI } from '@/lib/api';
import {
    buildMindElixirOptions,
    cloneMindElixirData,
    decorateMindElixirImages,
    normalizeMindElixirData,
    transformAiMindMapData,
} from './mind-elixir-factory';
import { useMindElixirMap } from './useMindElixirMap';

interface MindElixirMapProps {
    id: string;
    initialData: any;
    readonly?: boolean;
}

const MindElixirMap: React.FC<MindElixirMapProps> = ({ id, initialData, readonly = false }) => {
    const { containerRef, handleSave, mindElixirInstance, setMindElixirInstance } = useMindElixirMap(id);
    const { mindMapData, setMindMapData } = useAI();

    // 保存最新的 props，供只运行一次的初始化 effect 读取
    const initialDataRef = useRef(initialData)
    initialDataRef.current = initialData
    const readonlyRef = useRef(readonly)
    readonlyRef.current = readonly

    useEffect(() => {
        if (!containerRef.current) return;
        const initialContainer = containerRef.current;

        // 清理容器，防止 React Strict Mode 下重复渲染
        containerRef.current.innerHTML = '';

        const safeData = cloneMindElixirData(normalizeMindElixirData(initialDataRef.current));
        const options = buildMindElixirOptions(containerRef.current, safeData, readonlyRef.current, MindElixir.LEFT || 2);

        console.log('Initializing MindElixir with options:', options);

        try {
            const me = new MindElixir(options);

            // 扩展渲染逻辑：支持图片显示
            me.bus.addListener('operation', (operation: any) => {
                if (operation.name === 'finishRender') {
                    decorateMindElixirImages(containerRef.current, me);
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
            initialContainer.innerHTML = '';
        };
    }, [containerRef, setMindElixirInstance]);

    // 当 AI 生成数据时，更新导图
    useEffect(() => {
        if (mindMapData && mindElixirInstance) {
            const cleanData = cloneMindElixirData(transformAiMindMapData(mindMapData));

            try {
                // 重新初始化前必须清理容器，防止工具栏重复和 DOM 堆叠
                if (containerRef.current) {
                    containerRef.current.innerHTML = '';

                    const options = buildMindElixirOptions(containerRef.current, cleanData, false, MindElixir.LEFT || 2);

                    const me = new MindElixir(options);

                    // 扩展渲染逻辑：支持图片显示
                    me.bus.addListener('operation', (operation: any) => {
                        if (operation.name === 'finishRender') {
                            decorateMindElixirImages(containerRef.current, me);
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

            mindmapsAPI.save(id, cleanData); // 保存到后端
            setMindMapData(null); // 清空 AI 数据，避免重复应用
        }
    }, [mindMapData, mindElixirInstance, id, setMindMapData, containerRef, setMindElixirInstance]);

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

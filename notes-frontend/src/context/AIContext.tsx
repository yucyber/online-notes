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

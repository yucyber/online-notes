import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, FilePlus2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import dynamic from 'next/dynamic';

const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), { ssr: false });

interface AggregateSummaryDialogProps {
    open: boolean;
    onClose: () => void;
    loading: boolean;
    error?: string;
    summary?: string;
    onCopy?: () => void;
    onSave?: () => void;
}

export const AggregateSummaryDialog: React.FC<AggregateSummaryDialogProps> = ({
    open,
    onClose,
    loading,
    error,
    summary,
    onCopy,
    onSave,
}) => {
    const handleCopy = () => {
        if (summary) {
            navigator.clipboard.writeText(summary);
            toast.success('已复制到剪贴板');
            onCopy?.();
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>多文档聚合摘要</DialogTitle>
                    <DialogDescription>
                        AI 将自动整合所选笔记的核心要点，生成一份结构化总结，便于复盘与分享。
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-[180px] max-h-[60vh] overflow-y-auto bg-zinc-50 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-100 dark:border-zinc-800">
                    {loading ? (
                        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 animate-pulse">
                            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /></svg>
                            AI 正在分析并生成聚合摘要，请稍候...
                        </div>
                    ) : error ? (
                        <div className="text-red-500 dark:text-red-400">{error}</div>
                    ) : summary ? (
                        <MarkdownRenderer content={summary} />
                    ) : (
                        <div className="text-gray-400 dark:text-gray-500">暂无摘要内容</div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button onClick={handleCopy} disabled={!summary} variant="secondary" className="flex items-center gap-1">
                        <Copy className="w-4 h-4" /> 复制摘要
                    </Button>
                    <Button onClick={onSave} disabled={!summary} className="flex items-center gap-1">
                        <FilePlus2 className="w-4 h-4" /> 保存为新笔记
                    </Button>
                    <Button variant="outline" onClick={onClose}>关闭</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AggregateSummaryDialog;

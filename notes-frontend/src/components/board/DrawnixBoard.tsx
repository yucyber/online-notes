'use client';
import React, { useEffect, useRef, useState } from 'react';
import { saveBoard } from '@/lib/api';

interface DrawnixBoardProps {
    id: string;
    initialData: any;
}

const DrawnixBoard: React.FC<DrawnixBoardProps> = ({ id, initialData }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [context, setContext] = useState<CanvasRenderingContext2D | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        setContext(ctx);

        // 设置画布大小
        canvas.width = canvas.parentElement?.clientWidth || 800;
        canvas.height = canvas.parentElement?.clientHeight || 600;

        // 恢复数据 (简单的图像数据恢复比较复杂，这里仅作为演示，实际应存储路径数据)
        if (initialData && initialData.imageData) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
            };
            img.src = initialData.imageData;
        }

        // 设置样式
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000';

    }, [initialData]);

    const startDrawing = (e: React.MouseEvent) => {
        if (!context) return;
        setIsDrawing(true);
        context.beginPath();
        context.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    };

    const draw = (e: React.MouseEvent) => {
        if (!isDrawing || !context) return;
        context.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        context.stroke();
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        if (context) {
            context.closePath();
        }
    };

    const handleSave = () => {
        if (canvasRef.current) {
            const dataUrl = canvasRef.current.toDataURL();
            saveBoard(id, { imageData: dataUrl }).then(() => {
                alert('保存成功');
            }).catch(err => {
                console.error('保存失败', err);
                alert('保存失败');
            });
        }
    };

    const handleClear = () => {
        if (context && canvasRef.current) {
            context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="p-2 border-b flex justify-between items-center bg-gray-50">
                <span className="text-sm text-gray-500">简易画板 (Canvas)</span>
                <div className="space-x-2">
                    <button
                        onClick={handleClear}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                    >
                        清空
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                        保存
                    </button>
                </div>
            </div>
            <div className="flex-1 w-full h-full overflow-hidden bg-white relative">
                <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    className="cursor-crosshair touch-none"
                    style={{ width: '100%', height: '100%' }}
                />
            </div>
        </div>
    );
};

export default DrawnixBoard;

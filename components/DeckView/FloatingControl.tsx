import React from 'react';
import { ZoomIn, ZoomOut, Play } from 'lucide-react';

interface FloatingControlsProps {
  zoom: number;
  setZoom: (fn: (z: number) => number) => void;
  onPresent: () => void;
}

export const FloatingControls: React.FC<FloatingControlsProps> = ({
  zoom,
  setZoom,
  onPresent,
}) => {
  return (
    <div className="fixed bottom-8 ml-24 left-1/2 -translate-x-1/2 bg-white/90 p-1 rounded-full shadow-2xl border border-slate-200 flex items-center gap-1 z-[9999]">
      <button onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))} className="p-2 hover:bg-slate-100 rounded-full text-slate-500"><ZoomOut size={16} /></button>
      <span className="text-xs font-mono font-bold text-slate-400 w-8 text-center">{Math.round(zoom * 100)}</span>
      <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))} className="p-2 hover:bg-slate-100 rounded-full text-slate-500"><ZoomIn size={16} /></button>

      <div className="w-px bg-slate-200 h-6 mx-1" />

      <button onClick={onPresent} className="p-2 hover:bg-indigo-50 rounded-full text-indigo-600 transition" title="Start Presentation">
        <Play size={16} fill="currentColor" />
      </button>
    </div>
  );
};
import React from 'react';
import { Upload } from 'lucide-react';
import { getAudioFormatsDisplayList } from '@/constants/audioFormats';

interface ImportDropOverlayProps {
  visible: boolean;
}

export function ImportDropOverlay({ visible }: ImportDropOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm
                 flex items-center justify-center pointer-events-none
                 transition-opacity duration-200"
    >
      <div className="rounded-xl border-2 border-dashed border-[#8A6FD1]/40
                       bg-[#8A6FD1]/20 p-12 text-center shadow-2xl
                       transform scale-100 transition-transform">
        <Upload className="mx-auto mb-4 h-16 w-16 text-[#FF8A3D]" />
        <p className="text-xl font-medium text-white">Drop audio file to import</p>
        <p className="mt-2 text-sm text-[#A88BD6]">{getAudioFormatsDisplayList()}</p>
      </div>
    </div>
  );
}

'use client';

/**
 * features/resident/proof/components/bundle-dropzone.tsx
 *
 * Takes the ZIP the registry issued, or the two JSON files inside it, and hands
 * the File[] to `lib/bundle.ts`. Nothing is uploaded: `readBundleFiles` reads
 * them with FileReader and unzips in memory.
 */

import { FolderOpen, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { buttonStyles } from '@/components/ui/button';

export function BundleDropzone({
  onFiles,
  label,
  hint,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = [...event.dataTransfer.files];
    if (files.length > 0) onFiles(files);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center ui-transition ${
        over ? 'border-authority bg-whisper' : 'border-hairline bg-surface'
      }`}
    >
      <Upload className="h-6 w-6 text-steel" strokeWidth={1.5} aria-hidden />

      <input
        ref={input}
        type="file"
        multiple
        accept=".zip,.json,application/zip,application/json"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // Reset so re-picking the same file fires change again.
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />

      <button
        type="button"
        className={buttonStyles.primary}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <span className="inline-flex items-center gap-2">
          <FolderOpen className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {label}
        </span>
      </button>

      <p className="text-xs text-steel">{hint}</p>
    </div>
  );
}

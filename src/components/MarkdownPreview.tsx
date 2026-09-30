import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { readFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';

interface Props {
  content: string;
  path: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
  onActivate: () => void;
}

function isRemote(source: string) {
  return /^(https?:|data:|blob:)/i.test(source);
}

function relativeFilePath(documentPath: string, source: string) {
  const separator = documentPath.includes('\\') ? '\\' : '/';
  const lastSeparator = Math.max(documentPath.lastIndexOf('/'), documentPath.lastIndexOf('\\'));
  const relative = source.split(/[?#]/, 1)[0];
  let decoded = relative;
  try { decoded = decodeURIComponent(relative); } catch { /* Keep malformed escapes as literal file name characters. */ }
  if (decoded.startsWith('/') || /^[a-z]:[\\/]/i.test(decoded)) return decoded;
  return `${documentPath.slice(0, lastSeparator + 1)}${decoded.replace(/[\\/]/g, separator)}`;
}

function imageMimeType(path: string) {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

function PreviewImage({ src, alt, path }: { src?: string; alt?: string; path: string }) {
  const [resolvedSource, setResolvedSource] = useState<string | null>(null);

  useEffect(() => {
    if (!src || isRemote(src)) {
      setResolvedSource(src ?? null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setResolvedSource(null);
    const filePath = relativeFilePath(path, src);
    void readFile(filePath).then(bytes => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: imageMimeType(filePath) }));
      setResolvedSource(objectUrl);
    }).catch(() => { if (!cancelled) setResolvedSource(null); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src, path]);

  return resolvedSource ? <img src={resolvedSource} alt={alt ?? ''} /> : <span className="markdown-image-fallback">{alt || src || 'Image unavailable'}</span>;
}

export default function MarkdownPreview({ content, path, onOpenFile, onClose, onActivate }: Props) {
  return <section className="markdown-preview" aria-label="Markdown preview" onMouseDown={onActivate}>
    <div className="markdown-preview-header"><span>PREVIEW · {path.split(/[\\/]/).pop()}</span><button aria-label="Close Markdown preview" title="Close preview" onClick={onClose}>×</button></div>
    <div className="markdown-preview-scroll">
      <article className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ src, alt }) => <PreviewImage src={src} alt={alt} path={path} />,
            a: ({ href, children }) => <a href={href} onClick={event => {
              event.preventDefault();
              if (!href) return;
              if (/^https?:\/\//i.test(href)) void openUrl(href).catch(console.error);
              else if (!href.startsWith('#') && !/^[a-z]+:/i.test(href)) onOpenFile(relativeFilePath(path, href));
            }}>{children}</a>,
          }}
        >{content}</ReactMarkdown>
      </article>
    </div>
  </section>;
}

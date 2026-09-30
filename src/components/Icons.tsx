import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export function FileIcon(props: IconProps) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M6 2.75h8l4 4V21.25H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z" />
    <path d="M14 2.75v4h4M8 12h6M8 16h8" />
  </svg>;
}

export function FolderIcon(props: IconProps) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M2.75 6.5a2 2 0 0 1 2-2h5l2.2 2.25h7.3a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2Z" />
  </svg>;
}

export function NewFileIcon(props: IconProps) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M5 3.5h8l4 4v5M13 3.5v4h4M5 3.5v16a1.5 1.5 0 0 0 1.5 1.5H12M16 16v6M13 19h6" />
  </svg>;
}

export function NewFolderIcon(props: IconProps) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M2.75 6.5a2 2 0 0 1 2-2h5l2.2 2.25h7.3a2 2 0 0 1 2 2v5M2.75 8.75v10.5a2 2 0 0 0 2 2H12M17 16v6M14 19h6" />
  </svg>;
}

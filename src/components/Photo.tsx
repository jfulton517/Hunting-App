import { useEffect, useState } from 'react';
import { useData } from '../lib/data/store';

export function Photo({ path, alt, className, onClick }: { path: string | null; alt: string; className?: string; onClick?: () => void }) {
  const { repo } = useData();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) repo.photoUrl(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path, repo]);
  if (!url) return <div className={`photo placeholder ${className ?? ''}`}>{path ? '…' : 'No photo'}</div>;
  return <img className={`photo ${className ?? ''}`} src={url} alt={alt} loading="lazy" onClick={onClick} />;
}

/** Full-screen photo viewer. */
export function Lightbox({ path, onClose }: { path: string; onClose: () => void }) {
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="Photo">
      <Photo path={path} alt="Trail camera photo" />
    </div>
  );
}

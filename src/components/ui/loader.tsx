import { LoaderCircle } from 'lucide-react';
export function Loader() {
  return <LoaderCircle className="spin" size={18} aria-label="Loading" />;
}
export function Skeleton() {
  return (
    <div className="skeleton-stack" role="status" aria-label="Loading workspace">
      {Array.from({ length: 5 }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}

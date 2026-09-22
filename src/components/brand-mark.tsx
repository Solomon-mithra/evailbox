export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="currentColor" />
      <path d="M10 13h20v15H10V13Z" stroke="#cbf39d" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m10 14 10 8 10-8" stroke="#cbf39d" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M15 9h10" stroke="#cbf39d" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

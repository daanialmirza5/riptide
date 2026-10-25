export default function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="rt-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0b1324" stroke="rgba(255,255,255,.08)" />
      <path d="M10 38c8-10 16-10 22 0s14 10 22 0" fill="none" stroke="url(#rt-g)" strokeWidth="5" strokeLinecap="round" />
      <path d="M10 26c8-10 16-10 22 0s14 10 22 0" fill="none" stroke="url(#rt-g)" strokeWidth="3" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}

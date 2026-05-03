import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: '1.125rem' }}>
          MDCalc
        </Link>
        <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>take-home</span>
      </div>
    </header>
  );
}

import { Fragment } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom';

interface Crumb {
  label: string;
  href?: string;
}

function buildCrumbs(pathname: string, sp: URLSearchParams): Crumb[] {
  const metaProvider = sp.get('meta');
  const metaId = sp.get('id');
  const provider = sp.get('provider');
  const title = sp.get('title');
  const ep = sp.get('ep');
  const type = sp.get('type');

  const crumbs: Crumb[] = [{ label: 'anime-sdk', href: '/' }];

  if (pathname === '/search') {
    crumbs.push({ label: 'search' });
    return crumbs;
  }

  if (pathname === '/media') {
    if (metaProvider) crumbs.push({ label: metaProvider, href: `/?meta=${metaProvider}` });
    if (title) crumbs.push({ label: title });
    return crumbs;
  }

  if (pathname === '/episodes') {
    if (metaProvider && metaId) {
      crumbs.push({ label: metaProvider, href: `/?meta=${metaProvider}` });
      if (title) {
        crumbs.push({
          label: title,
          href: `/media?meta=${metaProvider}&id=${encodeURIComponent(metaId)}`,
        });
      }
      if (provider) crumbs.push({ label: provider });
    } else {
      if (provider) crumbs.push({ label: provider, href: `/?provider=${provider}` });
      if (title) crumbs.push({ label: title });
    }
    return crumbs;
  }

  if (pathname === '/stream') {
    const metaIdParam = sp.get('metaId');
    if (metaProvider && metaIdParam) {
      crumbs.push({ label: metaProvider, href: `/?meta=${metaProvider}` });
      if (title) {
        crumbs.push({
          label: title,
          href: `/media?meta=${metaProvider}&id=${encodeURIComponent(metaIdParam)}`,
        });
      }
      const mid = sp.get('mid');
      if (provider && metaIdParam && title) {
        crumbs.push({
          label: provider,
          href: `/episodes?meta=${metaProvider}&id=${encodeURIComponent(metaIdParam)}&provider=${provider}&title=${encodeURIComponent(title)}&type=${type ?? 'ANIME'}`,
        });
      }
    } else {
      if (provider) {
        const epHref = `/episodes?provider=${provider}&mid=${encodeURIComponent(sp.get('mid') ?? '')}&title=${encodeURIComponent(title ?? '')}&type=${type ?? 'ANIME'}`;
        crumbs.push({ label: provider, href: `/?provider=${provider}` });
        if (title) crumbs.push({ label: title, href: epHref });
      }
    }
    if (ep) crumbs.push({ label: ep });
    return crumbs;
  }

  if (metaProvider) crumbs.push({ label: metaProvider });
  if (provider) crumbs.push({ label: provider });

  return crumbs;
}

export default function Layout() {
  const loc = useLocation();
  const [sp] = useSearchParams();
  const crumbs = buildCrumbs(loc.pathname, sp);

  return (
    <div className="bg-base-100 text-base-850 min-h-screen font-mono text-sm">
      <div className="mx-auto max-w-3xl">
        <header className="border-base-200 flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/anime-sdk.svg" width="16" height="16" alt="anime-sdk logo" />
            <div className="flex items-center gap-0">
              {crumbs.map((c, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="text-base-300 mx-2 select-none">/</span>}
                  {c.href ? (
                    <Link
                      to={c.href}
                      className="text-base-450 hover:text-base-650 text-xs tracking-widest transition-colors"
                    >
                      {c.label}
                    </Link>
                  ) : (
                    <span className="text-base-800 text-xs tracking-widest">{c.label}</span>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
          <Link
            to="/search"
            className="text-base-400 hover:text-base-600 text-[10px] tracking-widest transition-colors"
          >
            SEARCH
          </Link>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

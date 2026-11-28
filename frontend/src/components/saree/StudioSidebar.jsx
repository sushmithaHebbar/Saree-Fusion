import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, X } from 'lucide-react';

// One left sidebar for every studio tool, drawn as a collapsible tree.
//
// `tree` is data, so the page decides what the tools are and this component
// only decides how they are navigated:
//   [{ key, label, icon, keywords?, children: [{ key, label, icon?, keywords?, render }] }]
//
// - Groups and leaves expand independently; the last leaf opened is "active".
// - The filter box matches leaf labels/keywords (and group labels), shows only
//   matching branches and expands them while a query is typed.
// - xl and up: a sticky column scrolling on its own beside the canvas.
//   Below xl: an off-canvas drawer opened by the page (open / onClose).

function matches(q, ...texts) {
  return texts.some((t) => t && t.toLowerCase().includes(q));
}

export default function StudioSidebar({ tree, open, onClose, defaultOpen = [] }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set(defaultOpen));
  const [active, setActive] = useState(null);
  const q = query.trim().toLowerCase();

  // Close the drawer with Escape and lock page scroll behind it (mobile only)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const visible = useMemo(() => {
    if (!q) return tree;
    return tree
      .map((g) => {
        const groupHit = matches(q, g.label, g.keywords);
        const kids = groupHit ? g.children : g.children.filter((c) => matches(q, c.label, c.keywords));
        return kids.length ? { ...g, children: kids } : null;
      })
      .filter(Boolean);
  }, [tree, q]);

  const isOpen = (key) => Boolean(q) || expanded.has(key);
  const toggle = (key, leaf) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (leaf) setActive(key);
  };

  const body = (
    <nav aria-label="Studio tools" className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="text-sm font-bold text-fg">Studio tools</span>
        <button type="button" onClick={onClose} aria-label="Close tools"
          className="sf-tap -mr-2 grid h-10 w-10 place-items-center rounded-xl text-muted xl:hidden">
          <X size={18} />
        </button>
      </div>

      <div className="px-3 pt-3">
        <label className="relative block">
          <span className="sr-only">Filter tools</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tools…"
            className="h-10 w-full rounded-xl border border-line bg-surface-2/70 pl-9 pr-3 text-sm text-fg placeholder:text-muted/70 focus:border-gold focus:outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2">
        {visible.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted">No tools match “{query}”.</p>
        )}
        <ul className="space-y-1">
          {visible.map((g) => {
            const GIcon = g.icon;
            const gOpen = isOpen(g.key);
            return (
              <li key={g.key}>
                <button type="button" onClick={() => toggle(g.key)} aria-expanded={gOpen}
                  className="sf-tap flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-[13px] font-bold uppercase tracking-wider text-gold hover:bg-surface-2/60">
                  <ChevronRight size={15} className={`shrink-0 text-muted transition-transform ${gOpen ? 'rotate-90' : ''}`} />
                  {GIcon && <GIcon size={16} className="shrink-0" />}
                  <span className="truncate">{g.label}</span>
                </button>

                {gOpen && (
                  // Tree connector: a vertical rule with a short tick into each child
                  <ul className="relative ml-[17px] border-l border-line pl-3">
                    {g.children.map((c) => {
                      const CIcon = c.icon;
                      const cOpen = isOpen(c.key);
                      const on = active === c.key;
                      return (
                        <li key={c.key} className="relative py-0.5 before:absolute before:-left-3 before:top-5 before:h-px before:w-2.5 before:bg-line">
                          <button type="button" onClick={() => toggle(c.key, true)} aria-expanded={cOpen}
                            className={`sf-tap relative flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold transition-colors ${
                              on ? 'bg-gold/15 text-fg' : 'text-fg/85 hover:bg-surface-2/60'
                            }`}>
                            {on && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded bg-gold" />}
                            {CIcon && <CIcon size={15} className={`shrink-0 ${on ? 'text-gold' : 'text-muted'}`} />}
                            <span className="flex-1 truncate">{c.label}</span>
                            <ChevronRight size={14} className={`shrink-0 text-muted transition-transform ${cOpen ? 'rotate-90' : ''}`} />
                          </button>
                          {cOpen && (
                            <div className="mb-2 mt-1 rounded-xl border border-line bg-surface-2/40 p-3">
                              {c.render()}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile backdrop */}
      <div aria-hidden onClick={onClose}
        className={`fixed inset-0 z-[150] bg-black/50 transition-opacity xl:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />

      <aside
        className={`fixed inset-y-0 left-0 z-[160] w-[min(88vw,360px)] border-r border-line bg-bg shadow-2xl transition-[transform,visibility] duration-200
          ${open ? 'visible translate-x-0' : 'invisible -translate-x-full'}
          xl:visible xl:sticky xl:top-24 xl:z-auto xl:h-[calc(100vh-7rem)] xl:w-auto xl:translate-x-0 xl:self-start xl:rounded-2xl xl:border xl:bg-glass xl:shadow-none xl:backdrop-blur-md`}
      >
        {body}
      </aside>
    </>
  );
}

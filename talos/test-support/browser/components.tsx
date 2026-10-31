import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import Modal from '@/component/modal/modal';
import Viewer from '@/component/viewer/viewer';
import PopoverTooltip from '@/component/popover/popover';
import ContextMenu from '@/component/contextMenu/ContextMenu';
import Drawer from '@/component/drawer/drawer';
import TabView from '@/component/tabView/TabView';
import Feed from '@/component/feed/Feed';
import ActionBar from '@/component/actionBar/ActionBar';
import type { UGCImage } from '@/services/ugc/client';
import first from './first.svg?url';
import second from './second.svg?url';

const images: UGCImage[] = [
    { id: 'first', markerId: 'fixture', url: first, content: 'First fixture image', createdAt: '2026-05-21T03:28:31Z', author: { nickname: 'First author', publicUid: 'F-001' }, upvotes: 3 },
    { id: 'second', markerId: 'fixture', url: second, content: 'Second fixture image', createdAt: '2026-05-22T03:28:31Z', author: { nickname: 'Second author', publicUid: 'F-002' }, upvotes: 7 },
];

export default function Components() {
    const [open, setOpen] = useState(false);
    const [viewer, setViewer] = useState(false);
    const [selected, setSelected] = useState('first');
    const [closed, setClosed] = useState(0);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [action, setAction] = useState('none');
    const [disabled, setDisabled] = useState(false);
    const [scrollable, setScrollable] = useState(false);
    const [snap, setSnap] = useState(0);
    const [tab, setTab] = useState('first');
    const [wide, setWide] = useState(false);
    const [feedKey, setFeedKey] = useState('first');
    const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
    const feed = useRef<HTMLDivElement>(null);
    const reopen = useRef<number | undefined>(undefined);
    useEffect(() => () => window.clearTimeout(reopen.current), []);
    return <main data-fixture="ready" style={{ padding: 24, minHeight: '180vh', fontFamily: 'sans-serif' }}>
        <h1>Browser behavior fixture</h1>
        <p>Real components, styles, layout and browser APIs. External service writes are excluded.</p>
        <button onClick={() => setOpen(true)}>Open fixture modal</button>
        <output data-result="closed">{closed}</output>
        <PopoverTooltip content="Native tooltip content"><button>Tooltip fixture</button></PopoverTooltip>
        <button onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }} onKeyDown={(event) => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom });
        }}>Context fixture</button>
        <output data-result="action">{action}</output>
        <AnimatePresence>{menu && <ContextMenu key="fixture-menu" ownerDocument={document} position={menu} onDismiss={() => setMenu(null)} groups={[{
            id: 'fixture', items: [
                { id: 'first', label: 'First menu action', onSelect: () => setAction('first') },
                { id: 'disabled', label: 'Disabled menu action', disabled: true, onSelect: () => setAction('disabled') },
                { id: 'last', label: 'Last menu action', onSelect: () => setAction('last') },
            ],
        }]} />}</AnimatePresence>
        <Modal open={open} title="Fixture modal" onClose={() => setOpen(false)} onAfterClose={() => setClosed((value) => value + 1)}>
            <label>Fixture input<input aria-label="Fixture input" /></label>
            <PopoverTooltip content="Modal tooltip content"><button>Modal tooltip</button></PopoverTooltip>
            <button onClick={() => setViewer(true)}>Open nested viewer</button>
            <button onClick={() => { setOpen(false); window.clearTimeout(reopen.current); reopen.current = window.setTimeout(() => setOpen(true), 80); }}>Interrupt modal exit</button>
            <button onClick={() => setOpen(false)}>Close fixture modal</button>
        </Modal>
        <Viewer open={viewer} imageUrl={first} images={images} selectedImageId={selected} alt="Fixture viewer" onSelectedImageIdChange={setSelected} onClose={() => setViewer(false)} />
        <section style={{ marginTop: 40 }}>
            <button onClick={() => setSnap(0)}>Drawer minimum</button>
            <button onClick={() => setSnap(1)}>Drawer middle</button>
            <button onClick={() => setSnap(2)}>Drawer maximum</button>
            <button onClick={() => setDisabled((value) => !value)}>Toggle drawer disabled</button>
            <button onClick={() => setScrollable((value) => !value)}>Toggle drawer scrolling</button>
            <div data-fixture="drawer" style={{ position: 'relative', height: 340, width: '100%', maxWidth: 600 }}>
                <Drawer snap={[60, 180, 300]} initialSize={60} snapToIndex={snap} dragDisabled={disabled} fullWidth>
                    {scrollable ? <div data-fixture="scroll-surface" style={{ height: 180, overflowY: 'auto' }}>
                        <div style={{ height: 600 }}>Scrollable drawer surface</div>
                    </div> : <div data-fixture="drag-surface" style={{ height: 260 }}>Drawer surface</div>}
                </Drawer>
            </div>
        </section>
        <section data-fixture="tabs" style={{ width: wide ? 'min(780px, 100%)' : 'min(300px, 100%)', marginTop: 40 }}>
            <button onClick={() => setWide((value) => !value)}>Resize tab fixture</button>
            <TabView items={[{ key: 'first', label: 'First tab' }, { key: 'second', label: 'Second longer tab' }, { key: 'disabled', label: 'Disabled tab', disabled: true }]} activeKey={tab} onChange={setTab} />
        </section>
        <section data-fixture="feed" style={{ display: 'flex', flexDirection: 'column', height: 180, width: 320, marginTop: 40 }}>
            <button onClick={() => setFeedKey((value) => value === 'first' ? 'second' : 'first')}>Reset feed fixture</button>
            <Feed resetKey={feedKey} listRef={feed}>{Array.from({ length: 20 }, (_, index) => <p key={index}>Feed row {index + 1}</p>)}</Feed>
        </section>
        <section style={{ marginTop: 40 }}>
            <input aria-label="Floating editor" defaultValue="Select this text" onFocus={(event) => setSelectionRect(event.currentTarget.getBoundingClientRect())} />
            <ActionBar variant="floating" anchorRect={selectionRect} onFloatingDismiss={() => setSelectionRect(null)} items={[{ id: 'format', label: 'Format fixture text', icon: 'B', onClick: () => setAction('format') }]} />
        </section>
    </main>;
}

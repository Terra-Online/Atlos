import { useEffect, useState } from 'react';
import { useLocale, useTranslateUI } from '@/locale';
import { enabled, loadPoint, previewLink } from '@/services/noclip/client';
import { applyPreviewPreset, openPreview } from '@/services/noclip/preview';
import styles from './detail.module.scss';

type Loaded = NonNullable<Awaited<ReturnType<typeof loadPoint>>>;

export default function NoclipPreview({ pointId }: { pointId: string }) {
    const t = useTranslateUI(),
        locale = useLocale();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [error, setError] = useState(false);
    const [preset, setPreset] = useState('');
    useEffect(() => {
        let live = true;
        setLoaded(null);
        setError(false);
        setPreset('');
        if (enabled)
            void loadPoint(pointId)
                .then((value) => {
                    if (live) setLoaded(value);
                })
                .catch(() => {
                    if (live) setError(true);
                });
        return () => {
            live = false;
        };
    }, [pointId]);
    useEffect(() => {
        const receive = (event: Event) => {
            const state = (
                event as CustomEvent<{
                    point: string;
                    preset?: string;
                    type: string;
                }>
            ).detail;
            if (state.point === pointId) {
                if (state.preset) setPreset(state.preset);
                setError(state.type === 'error');
            }
        };
        window.addEventListener('noclip-state', receive);
        return () => window.removeEventListener('noclip-state', receive);
    }, [pointId]);
    if (
        !enabled ||
        (!loaded && !error) ||
        (loaded && loaded.point.id !== pointId)
    )
        return null;
    const chinese = locale.startsWith('zh');
    const label = (key: string, zh: string, en: string) =>
        t(`detail.noclip.${key}`) || (chinese ? zh : en);
    if (!loaded)
        return (
            <p role='status'>
                {label(
                    'unavailable',
                    '3D 预览数据暂不可用。',
                    '3D preview data is unavailable.',
                )}
            </p>
        );
    const { point, companion, catalog } = loaded;
    const requirement = (id: string, mask: number) => {
        const control = companion.controls.find((c) => c.id === id);
        const values = control?.values
            .filter((v) => (mask >>> v.value) & 1)
            .map((v) => v.label)
            .join(' / ');
        const names =
            companion.labels?.[locale === 'zh-HK' ? 'zh-TW' : locale] ||
            companion.labels?.['en-US'];
        return `${names?.[id] || control?.name || id}${values ? `: ${values}` : ''}`;
    };
    return (
        <section
            className={styles.noclipPreview}
            aria-label={label(
                'title',
                '3D 预览与前置条件',
                '3D preview and prerequisites',
            )}
        >
            <a
                href={previewLink(point.id, catalog.release)}
                target='_blank'
                onClick={(event) => {
                    if (openPreview(point.id, catalog.release))
                        event.preventDefault();
                }}
            >
                {label('open', '打开 3D 预览', 'Open 3D preview')} ↗
            </a>
            {point.condition ? (
                <div>
                    <strong>
                        {label(
                            'conditions',
                            '已知剧情前置',
                            'Known story prerequisites',
                        )}
                    </strong>
                    {point.condition.alternatives.map((alternative, i) => (
                        <p key={i}>
                            {i > 0 && `${label('or', '或', 'or')} `}
                            {alternative
                                .map((r) => requirement(r.control, r.mask))
                                .join(chinese ? '，且 ' : ' and ')}
                        </p>
                    ))}
                </div>
            ) : (
                <p>
                    {label(
                        'none',
                        '未记录任务进度前置。',
                        'No quest prerequisite is recorded.',
                    )}
                </p>
            )}
            {point.locks.length > 0 && (
                <p>
                    {label(
                        'locks',
                        '额外交互锁',
                        'Additional interaction locks',
                    )}
                    :{' '}
                    {point.locks
                        .map((lock) =>
                            [lock.kind, ...lock.quests, ...lock.games].join(
                                ' · ',
                            ),
                        )
                        .join('; ')}
                </p>
            )}
            {point.unknown.length > 0 && (
                <p>
                    {label(
                        'unknown',
                        '部分出生、脚本或交互条件尚未还原；预览仅应用已知剧情条件。',
                        'Some spawn, script or interaction conditions remain unknown; the preview applies known story conditions only.',
                    )}
                </p>
            )}
            <label>
                {label('state', '预览状态', 'Preview state')}
                <select
                    value={
                        preset ||
                        point.presets.find((p) => p.satisfies)?.id ||
                        'default'
                    }
                    onChange={(event) => {
                        const id = event.currentTarget.value;
                        setPreset(id);
                        applyPreviewPreset(point.id, catalog.release, id);
                    }}
                >
                    {point.presets.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.id === 'default'
                                ? label(
                                      'default',
                                      'noclip 默认状态',
                                      'noclip defaults',
                                  )
                                : p.label}
                        </option>
                    ))}
                </select>
            </label>
            {error && (
                <p role='status'>
                    {label(
                        'unavailable',
                        '3D 预览数据暂不可用。',
                        '3D preview data is unavailable.',
                    )}
                </p>
            )}
        </section>
    );
}

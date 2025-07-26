import { create } from "zustand";
import ALP from "accept-language-parser"

export interface II18nData {
    "markerType": {
        "key": Record<string, string>       // 点位类型三级索引（唯一识别id）
        "sub": Record<string, string>       // 点位类型二级索引
        "main": Record<string, string>      // 点位类型一级索引
    }
}

const getLanguage = () => {
    const language = navigator.language;
    const parsed = ALP.pick(["zh-tw"], language);
    return parsed || "zh-tw";
}

const useI18nStore = create<{
    locale: string,
    data: II18nData,
    t: (key: string) => string,
}>(() => ({
    locale: getLanguage(),
    data: {} as II18nData,
    t: <T = string>(key: string) => {
        const { data } = useI18nStore.getState();
        return key.split('.').reduce((obj, k) => (obj && obj[k] !== undefined) ? obj[k] : '', data) as T;
    },
}));
async function init() {
    useI18nStore.setState({
        locale: getLanguage(),
        data: await import(`./data/${useI18nStore.getState().locale}.json`)
    });
}
init();


export const useTranslate = () => {
    const { t } = useI18nStore();
    return t;
}
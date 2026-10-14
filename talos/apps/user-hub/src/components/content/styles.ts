import shared from '@main/component/notify/notify.module.scss';
import contentStyles from './content.module.scss';
import listStyles from './list.module.scss';

export const content = Object.assign({}, contentStyles, {
    feed: `${shared.notifyRoot} ${contentStyles.feed}`,
    pagination: shared.loadMore,
});
export const list = Object.assign({}, listStyles, {
    comment: `${shared.notificationCard} ${listStyles.comment}`,
    meta: `${shared.pointName} ${listStyles.meta}`,
});

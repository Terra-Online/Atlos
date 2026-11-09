import type React from 'react';
import {
    type FormatXMLElementFn,
    type PrimitiveType,
} from 'intl-messageformat';
import {
    capitalizeMessageValue,
    formatIcuMessage,
} from '@/locale/messageFormat';

export const NOTIFICATION_TEMPLATE_NAMES = [
    'approved',
    'needsReview',
    'removeResolved',
    'reply',
    'vote',
    'multiple',
] as const;

export type NotificationTemplateName =
    (typeof NOTIFICATION_TEMPLATE_NAMES)[number];
export type NotificationSubjectKind = 'image' | 'comment' | 'submission';

export interface FormatNotificationMessageOptions {
    template: string;
    locale: string;
    kind: NotificationSubjectKind;
    subject: string;
    point: string;
    count: number;
    renderSubject: FormatXMLElementFn<React.ReactNode, React.ReactNode>;
    renderPoint: FormatXMLElementFn<React.ReactNode, React.ReactNode>;
}

export const formatNotificationMessage = (
    options: FormatNotificationMessageOptions,
): React.ReactNode => {
    const values: Record<
        string,
        PrimitiveType | React.ReactNode | FormatXMLElementFn<React.ReactNode>
    > = {
        kind: options.kind,
        subject: options.subject,
        subjectCap: capitalizeMessageValue(options.subject, options.locale),
        point: options.point,
        hasPoint: options.point ? 'yes' : 'no',
        count: options.count,
        subjectTag: options.renderSubject,
        pointTag: options.renderPoint,
    };

    return formatIcuMessage<React.ReactNode>(
        options.template,
        options.locale,
        values,
    );
};

import { useEffect, useRef, type RefObject } from 'react';
import { Access, AccessButton } from '@main/component/login/access';
import { notifyOemAuthModalDismissed } from '@main/component/login/authEvents';
import { useIdCardAuthController } from '@main/component/login/useIdCardAuthController';
import { useIdCardProfileViewModel } from '@main/component/login/useIdCardProfileViewModel';
import ProfileModal from '@main/component/login/profile/profile';
import { useTranslateUI as useTranslateMainUI } from '@main/locale';

export default function AuthGate({
    onAuthenticated,
    attemptedSession,
}: {
    onAuthenticated: () => void;
    attemptedSession: RefObject<string | null>;
}) {
    const main = useTranslateMainUI();
    const auth = useIdCardAuthController();
    const {
        authReady,
        sessionUser,
        handleAvatarClick,
        open,
        profileOpen,
        isSubmitting,
    } = auth;
    const cardProfile = useIdCardProfileViewModel({
        sessionUser: auth.sessionUser,
        hasLoggedInBefore: auth.hasLoggedInBefore,
        authReady: auth.authReady,
    });
    const opened = useRef(false);

    useEffect(() => {
        if (!authReady || sessionUser || opened.current) return;
        opened.current = true;
        handleAvatarClick();
    }, [authReady, handleAvatarClick, sessionUser]);

    useEffect(() => {
        if (
            sessionUser &&
            !open &&
            !profileOpen &&
            !isSubmitting &&
            attemptedSession.current !== sessionUser.uid
        ) {
            // The parent retains this guard when a repeated 401 remounts the gate.
            attemptedSession.current = sessionUser.uid;
            onAuthenticated();
        }
    }, [
        sessionUser,
        open,
        profileOpen,
        isSubmitting,
        onAuthenticated,
        attemptedSession,
    ]);

    return (
        <>
            <AccessButton
                label={main('idcard.auth.login')}
                onClick={() => {
                    attemptedSession.current = null;
                    handleAvatarClick();
                }}
            />
            <Access
                open={auth.open}
                setOpen={auth.setOpen}
                onDismiss={notifyOemAuthModalDismissed}
                activeTab={auth.activeTab}
                setActiveTab={auth.setActiveTab}
                resetToken={auth.resetToken}
                resetEmail={auth.resetEmail}
                isSubmitting={auth.isSubmitting}
                authError={auth.authError}
                handleOAuthClick={auth.handleOAuthClick}
                onRequestVerificationCode={auth.handleRequestVerificationCode}
                onRequestPasswordReset={auth.handleRequestPasswordReset}
                onAutoSubmit={auth.handleAutoSubmit}
            />
            <ProfileModal
                profileOpen={auth.profileOpen}
                setProfileOpen={auth.setProfileOpen}
                profileName={auth.profileName}
                setProfileName={auth.setProfileName}
                profileError={auth.profileError}
                isSavingProfile={auth.isSavingProfile}
                cardProfile={cardProfile}
                profileAvatar={auth.profileAvatar}
                handleCloseProfile={auth.handleCloseProfile}
                handleSaveProfile={auth.handleSaveProfile}
                handleLogout={auth.handleLogout}
            />
        </>
    );
}

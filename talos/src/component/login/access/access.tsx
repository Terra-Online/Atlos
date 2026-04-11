import Modal from '@/component/modal/modal';
import DiscordIcon from '@/assets/images/UI/media/discordicon.svg?react';
import LoginIcon from '@/assets/logos/login.svg?react';
import RegisterIcon from '@/assets/logos/register.svg?react';
import { useMemo, useState } from 'react';
import { useTranslateUI } from '@/locale';
import styles from './access.module.scss';

type AuthMode = 'login' | 'register';

interface AccessProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  activeTab: AuthMode;
  setActiveTab: (mode: AuthMode) => void;
  isSubmitting: boolean;
  authError: string | null;
  handleDiscordAuthClick: () => Promise<void>;
}

interface EmailFieldErrors {
  email?: string;
  password?: string;
  verificationCode?: string;
}

const Access = ({
  open,
  setOpen,
  activeTab,
  setActiveTab,
  isSubmitting,
  authError,
  handleDiscordAuthClick,
}: AccessProps) => {
  const t = useTranslateUI();
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [verificationCodeValue, setVerificationCodeValue] = useState('');
  const [emailFieldErrors, setEmailFieldErrors] = useState<EmailFieldErrors>({});

  const isRegisterMode = activeTab === 'register';

  const modalTitle = isRegisterMode
    ? t('idcard.auth.register') || 'Register'
    : t('idcard.auth.login') || 'Login';

  const modalIcon = isRegisterMode ? <RegisterIcon /> : <LoginIcon />;

  const handleModeSwitch = (nextMode: AuthMode) => {
    setActiveTab(nextMode);
    setEmailFieldErrors({});
  };

  const passwordHint = useMemo(() => {
    if (isRegisterMode || emailFieldErrors.password) {
      return null;
    }

    return t('idcard.auth.forgotPW') || 'Forgot password?';
  }, [emailFieldErrors.password, isRegisterMode, t]);

  const handleVerificationCodeChange = (rawValue: string) => {
    const digitsOnly = rawValue.replace(/\D/g, '').slice(0, 6);
    const head = digitsOnly.slice(0, 3);
    const tail = digitsOnly.slice(3, 6);
    setVerificationCodeValue(tail ? `${head}-${tail}` : head);
  };

  return (
    <Modal
      open={open}
      size="m"
      title={modalTitle}
      icon={modalIcon}
      onClose={() => setOpen(false)}
      onChange={setOpen}
      iconScale={0.8}
    >
      <div className={styles.accessAuthModal} data-mode={activeTab}>
        <section className={styles.emailAuthSection}>
          <div className={styles.emailAuthForm}>
            <div className={styles.inputRow}>
              <label htmlFor="access-email" className={styles.prtsIoLabel}>
                <span className={styles.prtsIoItem}>{t('idcard.auth.email') || 'EMAIL:'}</span>
                {emailFieldErrors.email ? (
                  <span className={styles.prtsError} data-text={emailFieldErrors.email}>
                    {emailFieldErrors.email}
                  </span>
                ) : null}
              </label>
              <div className={styles.prtsIoContainer}>
                <input
                  id="access-email"
                  type="email"
                  value={emailValue}
                  onChange={(event) => setEmailValue(event.target.value)}
                  placeholder="ak@ex.talos"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className={styles.inputRow}>
              <label htmlFor="access-password" className={styles.prtsIoLabel}>
                <span className={styles.prtsIoItem}>{t('idcard.auth.password') || 'PASSWORD:'}</span>
                {emailFieldErrors.password ? (
                  <span className={styles.prtsError} data-text={emailFieldErrors.password}>
                    {emailFieldErrors.password}
                  </span>
                ) : passwordHint ? (
                  <span className={styles.prtsHint}>
                    <a
                      href="#"
                      className={styles.prtsHintLink}
                      onClick={(event) => {
                        event.preventDefault();
                      }}
                    >
                      {passwordHint}
                    </a>
                  </span>
                ) : null}
              </label>
              <div className={styles.prtsIoContainer}>
                <input
                  id="access-password"
                  type="password"
                  value={passwordValue}
                  onChange={(event) => setPasswordValue(event.target.value)}
                  placeholder=""
                  autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                />
              </div>
            </div>

            <div
              className={styles.inputRow}
              data-field="verification"
              data-visible={isRegisterMode ? 'true' : 'false'}
              aria-hidden={!isRegisterMode}
            >
              <label htmlFor="access-verification-code" className={styles.prtsIoLabel}>
                <span className={styles.prtsIoItem}>{t('idcard.auth.verification') || 'CODE:'}</span>
                {emailFieldErrors.verificationCode ? (
                  <span className={styles.prtsError} data-text={emailFieldErrors.verificationCode}>
                    {emailFieldErrors.verificationCode}
                  </span>
                ) : (
                  <span className={styles.prtsHint}>
                  </span>
                )}
              </label>
              <div className={styles.prtsIoContainer}>
                <input
                  id="access-verification-code"
                  type="text"
                  value={verificationCodeValue}
                  onChange={(event) => handleVerificationCodeChange(event.target.value)}
                  placeholder="019-624"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{3}-[0-9]{3}"
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </section>

        <div className={styles.lowerSection}>
          <div className={styles.authDivider} aria-hidden="true" />

          <section className={styles.otherAuthSection}>
            <button
              type="button"
              className={styles.discordButton}
              onClick={() => {
                void handleDiscordAuthClick();
              }}
              disabled={isSubmitting}
            >
              <DiscordIcon />
              <span>
                {isSubmitting
                  ? t('idcard.auth.connecting')
                  : t('idcard.auth.discordButton')}
              </span>
            </button>
          </section>

          <p className={styles.authSwitchLine}>
            <span>
              {isRegisterMode
                ? t('idcard.auth.switchToLoginPrefix')
                : t('idcard.auth.switchToRegisterPrefix')}
            </span>
            <button
              type="button"
              className={styles.switchModeButton}
              onClick={() => handleModeSwitch(isRegisterMode ? 'login' : 'register')}
            >
              {isRegisterMode
                ? t('idcard.auth.switchToLoginAction')
                : t('idcard.auth.switchToRegisterAction')}
            </button>
          </p>
        </div>

        {authError && <p className={styles.authError}>{authError}</p>}
      </div>
    </Modal>
  );
};

export default Access;

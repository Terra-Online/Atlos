import Modal from '@/component/modal/modal';
import DiscordIcon from '@/assets/images/UI/media/discordicon.svg?react';
import LoginIcon from '@/assets/logos/login.svg?react';
import RegisterIcon from '@/assets/logos/register.svg?react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslateUI } from '@/locale';
import {
  OTP_COOLDOWN_SECONDS,
  canShowSendVerificationButton,
  formatAuthHint,
  type AuthField,
  type AuthHintCode,
  type AuthMode,
  type AuthValues,
  mapBackendCodeToField,
  resolveAuthMachineNode,
  sanitizeEmailInput,
  sanitizeVerificationCodeInput,
  validateField,
  validateSendVerificationCode,
  validateSubmit,
} from './authState';
import styles from './access.module.scss';

interface AccessProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  activeTab: AuthMode;
  setActiveTab: (mode: AuthMode) => void;
  isSubmitting: boolean;
  authError: string | null;
  handleDiscordAuthClick: () => Promise<void>;
  onAutoSubmit?: (payload: { mode: AuthMode; values: AuthValues }) => void;
}

const INITIAL_TOUCHED_FIELDS: Record<AuthField, boolean> = {
  email: false,
  password: false,
  verificationCode: false,
};

const Access = ({
  open,
  setOpen,
  activeTab,
  setActiveTab,
  isSubmitting,
  authError,
  handleDiscordAuthClick,
  onAutoSubmit,
}: AccessProps) => {
  const t = useTranslateUI();
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [verificationCodeValue, setVerificationCodeValue] = useState('');
  const [fieldHintCodes, setFieldHintCodes] = useState<Partial<Record<AuthField, AuthHintCode>>>({});
  const [touchedFields, setTouchedFields] = useState<Record<AuthField, boolean>>(INITIAL_TOUCHED_FIELDS);
  const [otpCooldownSeconds, setOtpCooldownSeconds] = useState(0);
  const lastAutoSubmittedSignatureRef = useRef<string>('');

  const isRegisterMode = activeTab === 'register';

  const authValues = useMemo<AuthValues>(
    () => ({
      email: emailValue,
      password: passwordValue,
      verificationCode: verificationCodeValue,
    }),
    [emailValue, passwordValue, verificationCodeValue],
  );

  const modalTitle = isRegisterMode
    ? t('idcard.auth.register') || 'Register'
    : t('idcard.auth.login') || 'Login';

  const modalIcon = isRegisterMode ? <RegisterIcon /> : <LoginIcon />;

  const handleModeSwitch = (nextMode: AuthMode) => {
    setActiveTab(nextMode);
    setFieldHintCodes({});
    setTouchedFields(INITIAL_TOUCHED_FIELDS);
  };

  const passwordHint = useMemo(() => {
    if (isRegisterMode || fieldHintCodes.password) {
      return null;
    }

    return t('idcard.auth.forgotPW') || 'Forgot password?';
  }, [fieldHintCodes.password, isRegisterMode, t]);

  const setFieldCode = useCallback((field: AuthField, code: AuthHintCode | null) => {
    setFieldHintCodes((prev) => {
      const next = { ...prev };
      if (code === null) {
        delete next[field];
      } else {
        next[field] = code;
      }
      return next;
    });
  }, []);

  const touchField = useCallback((field: AuthField) => {
    setTouchedFields((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);

  const resolveHintText = useCallback(
    (code: AuthHintCode): string => formatAuthHint(code, (key) => t(`idcard.auth.hints.${key}`)),
    [t],
  );

  const getFieldHint = useCallback(
    (field: AuthField): string | null => {
      const code = fieldHintCodes[field];
      if (!code || !touchedFields[field]) {
        return null;
      }
      return resolveHintText(code);
    },
    [fieldHintCodes, resolveHintText, touchedFields],
  );

  const emailHintText = getFieldHint('email');
  const passwordHintText = getFieldHint('password');
  const verificationHintText = getFieldHint('verificationCode');

  const shouldShowSendVerificationButton = canShowSendVerificationButton(activeTab, authValues);
  const authMachineNode = resolveAuthMachineNode({
    mode: activeTab,
    values: authValues,
    touched: touchedFields,
    hintCodes: fieldHintCodes,
    isSubmitting,
  });

  useEffect(() => {
    if (otpCooldownSeconds <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setOtpCooldownSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [otpCooldownSeconds]);

  useEffect(() => {
    const hasAnyTouchedInput = touchedFields.email || touchedFields.password || touchedFields.verificationCode;
    if (!hasAnyTouchedInput) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const nextCodes: Partial<Record<AuthField, AuthHintCode>> = {};

      (['email', 'password', 'verificationCode'] as AuthField[]).forEach((field) => {
        if (!touchedFields[field]) {
          return;
        }

        const code = validateField(activeTab, field, authValues);
        if (code !== null) {
          nextCodes[field] = code;
        }
      });

      setFieldHintCodes((prev) => ({
        ...prev,
        ...nextCodes,
      }));

      const submitErrors = validateSubmit(activeTab, authValues);
      if (Object.keys(submitErrors).length > 0) {
        return;
      }

      const signature = `${activeTab}|${authValues.email}|${authValues.password}|${authValues.verificationCode}`;
      if (signature === lastAutoSubmittedSignatureRef.current) {
        return;
      }

      lastAutoSubmittedSignatureRef.current = signature;
      onAutoSubmit?.({
        mode: activeTab,
        values: {
          email: authValues.email,
          password: authValues.password,
          verificationCode: authValues.verificationCode,
        },
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [activeTab, authValues, onAutoSubmit, touchedFields]);

  useEffect(() => {
    if (!authError) {
      return;
    }

    const parsedCode = Number.parseInt(authError, 10);
    if (!Number.isFinite(parsedCode)) {
      return;
    }

    const code = parsedCode as AuthHintCode;
    const targetField = mapBackendCodeToField(code);
    if (!targetField) {
      return;
    }

    touchField(targetField);
    setFieldCode(targetField, code);
  }, [authError, setFieldCode, touchField]);

  const handleEmailChange = (rawValue: string) => {
    touchField('email');
    const nextValue = sanitizeEmailInput(rawValue);
    setEmailValue(nextValue);
    setFieldCode('email', null);
  };

  const handlePasswordChange = (rawValue: string) => {
    touchField('password');
    setPasswordValue(rawValue);
    setFieldCode('password', null);
  };

  const handleVerificationCodeChange = (rawValue: string) => {
    touchField('verificationCode');
    setVerificationCodeValue(sanitizeVerificationCodeInput(rawValue));
    setFieldCode('verificationCode', null);
  };

  const handleFieldBlur = (field: AuthField) => {
    if (!touchedFields[field]) {
      return;
    }
    setFieldCode(field, validateField(activeTab, field, authValues));
  };

  const handleRequestVerificationCode = () => {
    touchField('email');

    const emailValidationCode = validateSendVerificationCode(authValues);
    if (emailValidationCode) {
      setFieldCode('email', emailValidationCode);
      return;
    }

    if (otpCooldownSeconds > 0) {
      return;
    }

    setFieldCode('email', null);
    setOtpCooldownSeconds(OTP_COOLDOWN_SECONDS);
  };

  const resendTemplate = t('idcard.auth.resend') || 'Resend ({count})';
  const sendButtonLabel = otpCooldownSeconds > 0
    ? resendTemplate.replace('{count}', String(otpCooldownSeconds))
    : t('idcard.auth.send') || 'Send';

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
      <div className={styles.accessAuthModal} data-mode={activeTab} data-auth-node={authMachineNode}>
        <section className={styles.emailAuthSection}>
          <form className={styles.emailAuthForm} onSubmit={(event) => event.preventDefault()} noValidate>
            <div className={styles.inputRow}>
              <label htmlFor="access-email" className={styles.prtsIoLabel}>
                <span className={styles.prtsIoItem}>{t('idcard.auth.email') || 'EMAIL:'}</span>
                {emailHintText ? (
                  <span className={styles.prtsError} data-text={emailHintText}>
                    {emailHintText}
                  </span>
                ) : null}
              </label>
              <div className={styles.prtsIoContainer}>
                <input
                  id="access-email"
                  type="email"
                  value={emailValue}
                  onChange={(event) => handleEmailChange(event.target.value)}
                  onBlur={() => handleFieldBlur('email')}
                  placeholder="ak@ex.talos"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className={styles.inputRow}>
              <label htmlFor="access-password" className={styles.prtsIoLabel}>
                <span className={styles.prtsIoItem}>{t('idcard.auth.password') || 'PASSWORD:'}</span>
                {passwordHintText ? (
                  <span className={styles.prtsError} data-text={passwordHintText}>
                    {passwordHintText}
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
                  onChange={(event) => handlePasswordChange(event.target.value)}
                  onBlur={() => handleFieldBlur('password')}
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
                {verificationHintText ? (
                  <span className={styles.prtsError} data-text={verificationHintText}>
                    {verificationHintText}
                  </span>
                ) : null}
              </label>
              <div className={styles.verificationInputGroup}>
                <div className={styles.prtsIoContainer}>
                  <input
                    id="access-verification-code"
                    type="text"
                    value={verificationCodeValue}
                    onChange={(event) => handleVerificationCodeChange(event.target.value)}
                    onBlur={() => handleFieldBlur('verificationCode')}
                    placeholder="019-624"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{3}-[0-9]{3}"
                    maxLength={7}
                  />
                </div>
                {shouldShowSendVerificationButton ? (
                  <button
                    type="button"
                    className={styles.sendCodeButton}
                    disabled={otpCooldownSeconds > 0}
                    onClick={handleRequestVerificationCode}
                  >
                    {sendButtonLabel}
                  </button>
                ) : null}
              </div>
            </div>
          </form>
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

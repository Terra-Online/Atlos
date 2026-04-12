import Modal from '@/component/modal/modal';
import { useTranslateUI } from '@/locale';
import type { SessionUser } from '../authTypes';
import './profile.module.scss';

interface ProfileModalProps {
	profileOpen: boolean;
	setProfileOpen: (open: boolean) => void;
	profileName: string;
	setProfileName: (name: string) => void;
	profileError: string | null;
	isSavingProfile: boolean;
	sessionUser: SessionUser | null;
	handleSaveProfile: () => Promise<void>;
	handleLogout: () => Promise<void>;
}

const ProfileModal = ({
	profileOpen,
	setProfileOpen,
	profileName,
	setProfileName,
	profileError,
	isSavingProfile,
	sessionUser,
	handleSaveProfile,
	handleLogout,
}: ProfileModalProps) => {
	const t = useTranslateUI();

	return (
		<Modal
			open={profileOpen}
			size="m"
			title={
				sessionUser?.needsProfileSetup
					? t('idcard.profile.completeTitle') || 'Complete Profile'
					: t('idcard.profile.editTitle') || 'Edit Profile'
			}
			onClose={() => setProfileOpen(false)}
			onChange={setProfileOpen}
		>
			<div className="idcardProfileModal">
				<p className="idcardProfileTitle">{t('idcard.profile.nicknameTitle') || 'Nickname'}</p>
				<p className="idcardProfileHint">
					{t('idcard.profile.nicknameHint') ||
						'UID is assigned once and cannot be changed. Nickname can be updated at any time.'}
				</p>

				<label className="idcardProfileField">
					<span>{t('idcard.profile.nameLabel') || 'Name'}</span>
					<input
						value={profileName}
						onChange={(event) => setProfileName(event.target.value)}
						maxLength={26}
						className="idcardProfileInput"
						placeholder={t('idcard.profile.namePlaceholder') || 'e.g. jacychan'}
					/>
				</label>

				<p className="idcardProfileUid">
					{t('idcard.profile.currentUid') || 'Current UID'}:{' '}
					{sessionUser?.needsProfileSetup
						? t('idcard.profile.uidPending') || 'Will be assigned after first save'
						: sessionUser?.uid}
				</p>

				{profileError && <p className="idcardProfileError">{profileError}</p>}

				<div className="idcardProfileActions">
					{!sessionUser?.needsProfileSetup && (
						<button
							type="button"
							className="idcardProfileLogout"
							onClick={() => {
								void handleLogout();
							}}
							disabled={isSavingProfile}
						>
							{t('idcard.profile.logout') || 'Logout'}
						</button>
					)}
					<button
						type="button"
						className="idcardProfileCancel"
						onClick={() => setProfileOpen(false)}
						disabled={isSavingProfile}
					>
						{t('common.close') || 'Close'}
					</button>
					<button
						type="button"
						className="idcardProfileSave"
						onClick={() => {
							void handleSaveProfile();
						}}
						disabled={isSavingProfile}
					>
						{isSavingProfile
							? t('idcard.profile.saving') || 'Saving...'
							: t('idcard.profile.save') || 'Save'}
					</button>
				</div>
			</div>
		</Modal>
	);
};

export default ProfileModal;

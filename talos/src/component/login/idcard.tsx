import styles from './idcard.module.scss';

const IDCard = ({ username, id }: { username?: string; id?: string }) => {
  return (
    <div className={styles.idCard}>
      <div className={styles.avatarContainer}>
        <div className={styles.avatar}></div>
      </div>
      <div className={styles.bakPic}></div>
      <div className={styles.idCode}></div>
        <span className={styles.usrName}>{username || '陳嘉辭'}</span>
        <span className={styles.usrId}>UID: {id || '100002CI'}</span>
    </div>
  );
};

export default IDCard;
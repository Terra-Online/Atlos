import './idcard.scss'
const IDCard = ({ username, id }) => {
  return (
    <div className="id-card">
      <div className="avatar-container">
        <div className="avatar"></div>
      </div>
      <div className="bakpic"></div>
      <div className="idcode"></div>
        <span className="usrname">{username}</span>
        <span className="usrid">UID: {id}</span>
    </div>
  );
};

export default IDCard;
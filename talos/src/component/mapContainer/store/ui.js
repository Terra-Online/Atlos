// external UI store
import { create } from 'zustand';

const useUI = create((set) => ({
  triggers: {
    t1: true,
    t2: false
  },

  setTrigger: (name, value) => {
    set(state => ({
      triggers: {
        ...state.triggers,
        [name]: value
      }
    }));
  }
}));

export default useUI;
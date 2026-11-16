//! Reuse exact directed proofs inside one immutable World. New coverage,
//! placements or physical facts construct a different World and an empty cache.
use std::collections::{HashMap, VecDeque};
type Key = [[u64; 3]; 2];
#[derive(Debug)]
pub(super) struct Cache<T> {
    paths: HashMap<Key, T>,
    order: VecDeque<Key>,
}
impl<T: Clone> Cache<T> {
    pub fn get(&self, key: &Key) -> Option<T> {
        self.paths.get(key).cloned()
    }
    pub fn insert(&mut self, key: Key, path: T) {
        if self.paths.contains_key(&key) {
            return;
        }
        if self.paths.len() == 4096 {
            self.paths.remove(&self.order.pop_front().unwrap());
        }
        self.order.push_back(key);
        self.paths.insert(key, path);
    }
}

impl<T> Default for Cache<T> {
    fn default() -> Self {
        Self {
            paths: HashMap::new(),
            order: VecDeque::new(),
        }
    }
}

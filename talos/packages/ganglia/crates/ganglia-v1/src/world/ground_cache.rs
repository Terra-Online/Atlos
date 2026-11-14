//! Reuse exact directed proofs inside one immutable World. New coverage,
//! placements or physical facts construct a different World and an empty cache.
use super::GroundPath;
use std::collections::{HashMap, VecDeque};
type Key = [[u64; 3]; 2];
#[derive(Default, Debug)]
pub(super) struct Cache {
    paths: HashMap<Key, Option<GroundPath>>,
    order: VecDeque<Key>,
}
impl Cache {
    pub fn get(&self, key: &Key) -> Option<Option<GroundPath>> {
        self.paths.get(key).cloned()
    }
    pub fn insert(&mut self, key: Key, path: Option<GroundPath>) {
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

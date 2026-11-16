use std::cell::RefCell;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

thread_local! {
    static ACTIVE: RefCell<Option<Arc<AtomicBool>>> = const { RefCell::new(None) };
}

/// Computation checks a task-local token, leaving immutable Worlds free of query
/// state. A libuv thread can serve unrelated engines on later tasks.
pub(crate) fn check() -> Result<(), String> {
    if ACTIVE.with(|active| {
        active
            .borrow()
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::Relaxed))
    }) {
        Err("Native solve aborted".into())
    } else {
        Ok(())
    }
}

#[cfg(any(feature = "napi", test))]
pub(crate) struct Scope(Option<Arc<AtomicBool>>);

#[cfg(any(feature = "napi", test))]
pub(crate) fn enter(flag: Arc<AtomicBool>) -> Scope {
    Scope(ACTIVE.with(|active| active.replace(Some(flag))))
}

#[cfg(any(feature = "napi", test))]
impl Drop for Scope {
    fn drop(&mut self) {
        ACTIVE.with(|active| active.replace(self.0.take()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn task_tokens_do_not_escape_their_scope() {
        let flag = Arc::new(AtomicBool::new(false));
        {
            let _scope = enter(flag.clone());
            assert!(check().is_ok());
            flag.store(true, Ordering::Relaxed);
            assert!(check().is_err());
        }
        assert!(check().is_ok());
    }
}

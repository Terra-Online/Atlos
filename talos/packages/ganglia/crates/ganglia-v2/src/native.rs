use crate::Engine;
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use napi_derive::napi;
use std::sync::{Arc, atomic::Ordering};

#[napi]
pub struct NativeEngine {
    engine: Arc<Engine>,
}
#[napi]
impl NativeEngine {
    #[napi(constructor)]
    pub fn new(input: String) -> Result<Self> {
        Ok(Self {
            engine: Arc::new(Engine::new(&input).map_err(napi::Error::from_reason)?),
        })
    }
    #[napi]
    pub fn stats(&self) -> String {
        self.engine.stats().to_string()
    }
    #[napi]
    pub fn cancel(&self) {
        self.engine.cancel();
    }
    #[napi]
    pub fn solve(&self, query: String) -> AsyncTask<Solve> {
        // Reset before queueing: an abort received while the job waits for a
        // worker must not be erased when that worker eventually starts.
        self.engine.cancelled.store(false, Ordering::Relaxed);
        AsyncTask::new(Solve {
            engine: self.engine.clone(),
            query,
        })
    }
}
pub struct Solve {
    engine: Arc<Engine>,
    query: String,
}
impl Task for Solve {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> Result<String> {
        self.engine
            .solve(&self.query)
            .map(|v| v.to_string())
            .map_err(napi::Error::from_reason)
    }
    fn resolve(&mut self, _env: Env, output: String) -> Result<String> {
        Ok(output)
    }
}

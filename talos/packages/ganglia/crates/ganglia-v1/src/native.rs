use crate::engine::Engine;
use napi::{Env, Task, bindgen_prelude::AsyncTask};
use napi_derive::napi;
use serde_json::Value;
use std::sync::{
    Arc, Mutex, MutexGuard,
    atomic::{AtomicBool, Ordering},
};

fn failure(message: String) -> napi::Error {
    napi::Error::from_reason(message)
}
fn decode(text: &str) -> napi::Result<Value> {
    serde_json::from_str(text).map_err(|error| failure(error.to_string()))
}

/// CPU work runs on libuv, while the host event loop serves IO and cancellation.
/// One task owns the engine at a time; cancellation never waits for that lock.
#[napi]
pub struct NativeEngine {
    inner: Arc<Mutex<Engine>>,
    cancelled: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

pub struct EngineTask {
    inner: Arc<Mutex<Engine>>,
    cancelled: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    request: String,
    start: bool,
}

impl Task for EngineTask {
    type Output = String;
    type JsValue = String;
    fn compute(&mut self) -> napi::Result<String> {
        let _scope = crate::cancel::enter(self.cancelled.clone());
        let mut engine = self
            .inner
            .lock()
            .map_err(|_| failure("Native engine lock poisoned".into()))?;
        let result = (|| {
            crate::cancel::check().map_err(failure)?;
            let request = decode(&self.request)?;
            crate::cancel::check().map_err(failure)?;
            let value = if self.start {
                engine.start(request)
            } else {
                engine.resume(request)
            }
            .map_err(failure)?;
            crate::cancel::check().map_err(failure)?;
            Ok(value.to_string())
        })();
        if result.is_err() {
            let _ = engine.cancel();
        }
        result
    }
    fn resolve(&mut self, _env: Env, output: String) -> napi::Result<String> {
        if self.cancelled.load(Ordering::Relaxed) {
            if let Ok(mut engine) = self.inner.try_lock() {
                let _ = engine.cancel();
            }
            Err(failure("Native solve aborted".into()))
        } else {
            Ok(output)
        }
    }
    fn finally(self, _env: Env) -> napi::Result<()> {
        self.running.store(false, Ordering::Release);
        Ok(())
    }
}

impl NativeEngine {
    fn lock(&self) -> napi::Result<MutexGuard<'_, Engine>> {
        self.inner
            .try_lock()
            .map_err(|_| failure("Native engine is busy".into()))
    }
    fn task(&self, request: String, start: bool) -> napi::Result<AsyncTask<EngineTask>> {
        if self
            .running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(failure("Native engine is busy".into()));
        }
        self.cancelled.store(false, Ordering::Relaxed);
        Ok(AsyncTask::new(EngineTask {
            inner: self.inner.clone(),
            cancelled: self.cancelled.clone(),
            running: self.running.clone(),
            request,
            start,
        }))
    }
}

#[napi]
impl NativeEngine {
    #[napi(constructor)]
    pub fn new(config: String, input: String) -> napi::Result<Self> {
        Ok(Self {
            inner: Arc::new(Mutex::new(
                Engine::new(decode(&config)?, decode(&input)?).map_err(failure)?,
            )),
            cancelled: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
        })
    }
    #[napi]
    pub fn start(&self, query: String) -> napi::Result<AsyncTask<EngineTask>> {
        self.task(query, true)
    }
    #[napi]
    pub fn resume(&self, response: String) -> napi::Result<AsyncTask<EngineTask>> {
        self.task(response, false)
    }
    #[napi]
    pub fn close(&self) -> napi::Result<()> {
        self.lock()?.close();
        Ok(())
    }
    #[napi]
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
        if let Ok(mut engine) = self.inner.try_lock() {
            let _ = engine.cancel();
        }
    }
    #[napi]
    pub fn catalog_phase(&self, phase: String) -> napi::Result<()> {
        let action = match phase.as_str() {
            "disabled" => "clear",
            "training" => "train",
            "frozen" => "freeze",
            _ => return Err(failure("Invalid catalog phase".into())),
        };
        self.lock()?.catalog(action).map(|_| ()).map_err(failure)
    }
    #[napi]
    pub fn catalog_stats(&self) -> napi::Result<String> {
        self.lock()?
            .catalog("stats")
            .map(|value| value.to_string())
            .map_err(failure)
    }
}

use crate::engine::Engine;
use napi_derive::napi;
use serde_json::Value;

fn failure(message: String) -> napi::Error {
    napi::Error::from_reason(message)
}

fn decode(text: &str) -> napi::Result<Value> {
    serde_json::from_str(text).map_err(|error| failure(error.to_string()))
}

/// Native calls perform bounded synchronous computation. The engine yields load
/// effects for the JavaScript host to fulfill without a blocking callback.
#[napi]
pub struct NativeEngine {
    inner: Engine,
}

#[napi]
impl NativeEngine {
    #[napi(constructor)]
    pub fn new(config: String, input: String) -> napi::Result<Self> {
        Ok(Self {
            inner: Engine::new(decode(&config)?, decode(&input)?).map_err(failure)?,
        })
    }

    #[napi]
    pub fn start(&mut self, query: String) -> napi::Result<String> {
        self.inner
            .start(decode(&query)?)
            .map(|value| value.to_string())
            .map_err(failure)
    }

    #[napi]
    pub fn resume(&mut self, response: String) -> napi::Result<String> {
        self.inner
            .resume(decode(&response)?)
            .map(|value| value.to_string())
            .map_err(failure)
    }

    #[napi]
    pub fn close(&mut self) {
        self.inner.close();
    }

    #[napi]
    pub fn cancel(&mut self) {
        // A host abort can arrive before start(), or after a direct solve has
        // already completed. Both leave no suspended work to cancel.
        let _ = self.inner.cancel();
    }

    #[napi]
    pub fn catalog_phase(&mut self, phase: String) -> napi::Result<()> {
        let action = match phase.as_str() {
            "disabled" => "clear",
            "training" => "train",
            "frozen" => "freeze",
            _ => return Err(failure("Invalid catalog phase".into())),
        };
        self.inner.catalog(action).map(|_| ()).map_err(failure)
    }

    #[napi]
    pub fn catalog_stats(&mut self) -> napi::Result<String> {
        self.inner
            .catalog("stats")
            .map(|value| value.to_string())
            .map_err(failure)
    }
}

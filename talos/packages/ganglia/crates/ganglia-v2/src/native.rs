use crate::{
    Engine,
    types::{Input, Surface},
};
use napi::{
    Env, Result, Task,
    bindgen_prelude::{AsyncTask, Float64Array},
};
use napi_derive::napi;
use std::{
    sync::{Arc, atomic::Ordering},
    time::Instant,
};

#[napi]
pub struct NativeEngine {
    engine: Arc<Engine>,
}
#[napi]
impl NativeEngine {
    #[napi(constructor)]
    pub fn new(
        input: String,
        surfaces: Vec<String>,
        positions: Float64Array,
        indices: Float64Array,
    ) -> Result<Self> {
        let started = Instant::now();
        let mut input: Input = serde_json::from_str(&input)
            .map_err(|error| napi::Error::from_reason(error.to_string()))?;
        for chunk in surfaces {
            input.physical.ground.surfaces.extend(
                serde_json::from_str::<Vec<Surface>>(&chunk)
                    .map_err(|error| napi::Error::from_reason(error.to_string()))?,
            );
        }
        // JSON used to reject non-finite coordinates and non-integer indices.
        // Validate before casting so binary transport cannot silently repair
        // malformed geometry through truncation or integer saturation.
        if positions.iter().any(|value| !value.is_finite()) {
            return Err(napi::Error::from_reason("Invalid collision positions"));
        }
        let vertex_count = positions.len() / 3;
        if indices.iter().any(|value| {
            !value.is_finite()
                || *value < 0.
                || value.fract() != 0.
                || *value >= vertex_count as f64
        }) {
            return Err(napi::Error::from_reason("Invalid collision indices"));
        }
        input.physical.collision.positions = positions.to_vec();
        input.physical.collision.indices = indices.iter().map(|value| *value as usize).collect();
        Ok(Self {
            engine: Arc::new(Engine::from_input(input, started).map_err(napi::Error::from_reason)?),
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

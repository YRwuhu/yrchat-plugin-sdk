//! Runtime, protocol types, and WASM exports for YRChat plugins.

use std::cell::RefCell;
use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct PluginRequest {
    pub operation: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HostResult {
    pub ok: bool,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub error: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginError {
    pub message: String,
}

impl PluginError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl<T: Into<String>> From<T> for PluginError {
    fn from(value: T) -> Self {
        Self::new(value)
    }
}

pub enum PluginResponse<C> {
    Complete(Value),
    Effect {
        service: String,
        request: Value,
        continuation: C,
    },
    Error(PluginError),
}

impl<C> PluginResponse<C> {
    pub fn complete(value: impl Into<Value>) -> Self {
        Self::Complete(value.into())
    }

    pub fn effect(service: impl Into<String>, request: Value, continuation: C) -> Self {
        Self::Effect {
            service: service.into(),
            request,
            continuation,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self::Error(PluginError::new(message))
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WireResponse {
    Complete { value: Value },
    Effect { effect: HostEffect },
    Error { message: String },
}

#[derive(Debug, Serialize)]
pub struct HostEffect {
    pub effect_id: u64,
    pub service: String,
    pub request: Value,
}

pub trait Plugin: Default {
    type Continuation: Serialize + DeserializeOwned;

    fn handle(&mut self, operation: &str, payload: Value) -> PluginResponse<Self::Continuation>;

    fn resume(
        &mut self,
        continuation: Self::Continuation,
        result: HostResult,
    ) -> PluginResponse<Self::Continuation>;
}

#[derive(Deserialize)]
struct ResumePayload {
    effect_id: u64,
    result: HostResult,
}

pub struct Runtime<P: Plugin> {
    plugin: P,
    pending: BTreeMap<u64, P::Continuation>,
    next_effect_id: u64,
}

impl<P: Plugin> Default for Runtime<P> {
    fn default() -> Self {
        Self {
            plugin: P::default(),
            pending: BTreeMap::new(),
            next_effect_id: 1,
        }
    }
}

impl<P: Plugin> Runtime<P> {
    pub fn dispatch(&mut self, request: PluginRequest) -> WireResponse {
        let response = if request.operation == "__resume" {
            let resume = match serde_json::from_value::<ResumePayload>(request.payload) {
                Ok(resume) => resume,
                Err(error) => {
                    return WireResponse::Error {
                        message: format!("Invalid host resume payload: {error}"),
                    }
                }
            };
            let Some(continuation) = self.pending.remove(&resume.effect_id) else {
                return WireResponse::Error {
                    message: format!("Unknown or completed effect ID: {}", resume.effect_id),
                };
            };
            self.plugin.resume(continuation, resume.result)
        } else {
            self.plugin.handle(&request.operation, request.payload)
        };
        self.materialize(response)
    }

    fn materialize(&mut self, response: PluginResponse<P::Continuation>) -> WireResponse {
        match response {
            PluginResponse::Complete(value) => WireResponse::Complete { value },
            PluginResponse::Error(error) => WireResponse::Error {
                message: error.message,
            },
            PluginResponse::Effect {
                service,
                request,
                continuation,
            } => {
                let effect_id = self.next_effect_id;
                self.next_effect_id = self.next_effect_id.wrapping_add(1).max(1);
                self.pending.insert(effect_id, continuation);
                WireResponse::Effect {
                    effect: HostEffect {
                        effect_id,
                        service,
                        request,
                    },
                }
            }
        }
    }
}

pub fn handle_runtime<P: Plugin>(
    runtime: &'static std::thread::LocalKey<RefCell<Runtime<P>>>,
    pointer: u32,
    len: u32,
) -> u64 {
    let input = unsafe { std::slice::from_raw_parts(pointer as *const u8, len as usize) };
    let output = match serde_json::from_slice::<PluginRequest>(input) {
        Ok(request) => runtime.with(|runtime| runtime.borrow_mut().dispatch(request)),
        Err(error) => WireResponse::Error {
            message: format!("Invalid plugin request: {error}"),
        },
    };
    let bytes = serde_json::to_vec(&output).unwrap_or_else(|error| {
        format!(r#"{{"kind":"error","message":"Response serialization failed: {error}"}}"#)
            .into_bytes()
    });
    let output_len = bytes.len() as u32;
    let output_pointer = allocate(output_len);
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), output_pointer as *mut u8, bytes.len());
    }
    ((output_len as u64) << 32) | output_pointer as u64
}

pub fn allocate(len: u32) -> u32 {
    if len == 0 {
        return 0;
    }
    let layout = std::alloc::Layout::array::<u8>(len as usize).expect("valid allocation layout");
    unsafe { std::alloc::alloc(layout) as u32 }
}

/// # Safety
///
/// `pointer` must reference an allocation returned by [`allocate`] with exactly `len` bytes.
pub unsafe fn deallocate(pointer: u32, len: u32) {
    if pointer == 0 || len == 0 {
        return;
    }
    let layout = std::alloc::Layout::array::<u8>(len as usize).expect("valid allocation layout");
    std::alloc::dealloc(pointer as *mut u8, layout);
}

#[macro_export]
macro_rules! export_plugin {
    ($plugin:ty) => {
        std::thread_local! {
            static YRCHAT_PLUGIN_RUNTIME: std::cell::RefCell<$crate::Runtime<$plugin>> =
                std::cell::RefCell::new($crate::Runtime::default());
        }

        #[no_mangle]
        pub extern "C" fn alloc(len: u32) -> u32 {
            $crate::allocate(len)
        }

        #[no_mangle]
        pub unsafe extern "C" fn dealloc(pointer: u32, len: u32) {
            $crate::deallocate(pointer, len);
        }

        #[no_mangle]
        pub extern "C" fn plugin_handle(pointer: u32, len: u32) -> u64 {
            $crate::handle_runtime(&YRCHAT_PLUGIN_RUNTIME, pointer, len)
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Default)]
    struct TestPlugin;

    impl Plugin for TestPlugin {
        type Continuation = String;

        fn handle(&mut self, operation: &str, payload: Value) -> PluginResponse<String> {
            PluginResponse::effect(operation, payload, operation.to_string())
        }

        fn resume(&mut self, continuation: String, result: HostResult) -> PluginResponse<String> {
            PluginResponse::complete(json!({ "continuation": continuation, "value": result.value }))
        }
    }

    #[test]
    fn resumes_concurrent_effects_out_of_order() {
        let mut runtime = Runtime::<TestPlugin>::default();
        let first = runtime.dispatch(PluginRequest {
            operation: "first".into(),
            payload: json!({}),
        });
        let second = runtime.dispatch(PluginRequest {
            operation: "second".into(),
            payload: json!({}),
        });
        let first_id = match first {
            WireResponse::Effect { effect } => effect.effect_id,
            _ => panic!(),
        };
        let second_id = match second {
            WireResponse::Effect { effect } => effect.effect_id,
            _ => panic!(),
        };
        let resumed = runtime.dispatch(PluginRequest {
            operation: "__resume".into(),
            payload: json!({ "effect_id": second_id, "result": { "ok": true, "value": 2 } }),
        });
        assert!(
            matches!(resumed, WireResponse::Complete { value } if value["continuation"] == "second")
        );
        let resumed = runtime.dispatch(PluginRequest {
            operation: "__resume".into(),
            payload: json!({ "effect_id": first_id, "result": { "ok": true, "value": 1 } }),
        });
        assert!(
            matches!(resumed, WireResponse::Complete { value } if value["continuation"] == "first")
        );
    }

    #[test]
    fn rejects_reused_effect_ids() {
        let mut runtime = Runtime::<TestPlugin>::default();
        let response = runtime.dispatch(PluginRequest {
            operation: "once".into(),
            payload: json!({}),
        });
        let id = match response {
            WireResponse::Effect { effect } => effect.effect_id,
            _ => panic!(),
        };
        let payload = json!({ "effect_id": id, "result": { "ok": true } });
        let _ = runtime.dispatch(PluginRequest {
            operation: "__resume".into(),
            payload: payload.clone(),
        });
        assert!(matches!(
            runtime.dispatch(PluginRequest {
                operation: "__resume".into(),
                payload
            }),
            WireResponse::Error { .. }
        ));
    }
}

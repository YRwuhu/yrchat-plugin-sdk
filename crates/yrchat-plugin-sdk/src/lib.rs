//! Typed Component Model runtime and generated WIT exports for YRChat plugins.

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

wit_bindgen::generate!({
    world: "yrchat-plugin",
    path: "../../wit",
    pub_export_macro: true,
    default_bindings_module: "$crate",
});

pub use exports::yrchat::plugin::guest::{Guest, HostResult, Invocation, Response};
pub use yrchat::plugin::protocol::{
    AiChatRequest, AiVisionRequest, CharacterEmotionRequest, CharacterProfileRequest, Effect,
    HostRequest, NetworkRequest,
};

pub enum PluginResponse<C> {
    Complete(Value),
    Effect {
        request: HostRequest,
        continuation: C,
    },
    Error(String),
}

impl<C> PluginResponse<C> {
    pub fn complete(value: impl Into<Value>) -> Self {
        Self::Complete(value.into())
    }

    pub fn effect(request: HostRequest, continuation: C) -> Self {
        Self::Effect {
            request,
            continuation,
        }
    }

    pub fn ai_chat(request: AiChatRequest, continuation: C) -> Self {
        Self::effect(HostRequest::AiChat(request), continuation)
    }

    pub fn ai_vision(request: AiVisionRequest, continuation: C) -> Self {
        Self::effect(HostRequest::AiVision(request), continuation)
    }

    pub fn character_profile(request: CharacterProfileRequest, continuation: C) -> Self {
        Self::effect(HostRequest::CharacterProfile(request), continuation)
    }

    pub fn character_emotion(request: CharacterEmotionRequest, continuation: C) -> Self {
        Self::effect(HostRequest::CharacterEmotion(request), continuation)
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self::Error(message.into())
    }
}

pub trait Plugin: Default {
    type Continuation;

    fn handle(&mut self, operation: &str, payload: Value) -> PluginResponse<Self::Continuation>;

    fn resume(
        &mut self,
        continuation: Self::Continuation,
        result: PluginHostResult,
    ) -> PluginResponse<Self::Continuation>;
}

#[derive(Debug, Clone)]
pub struct PluginHostResult {
    pub ok: bool,
    pub value: Value,
    pub error: String,
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
    pub fn invoke(&mut self, request: Invocation) -> Response {
        let payload = match from_cbor(&request.payload) {
            Ok(payload) => payload,
            Err(error) => return Response::Error(error),
        };
        let response = self.plugin.handle(&request.operation, payload);
        self.materialize(response)
    }

    pub fn resume(&mut self, effect_id: u64, result: HostResult) -> Response {
        let Some(continuation) = self.pending.remove(&effect_id) else {
            return Response::Error(format!("Unknown or completed effect ID: {effect_id}"));
        };
        let result = match result {
            HostResult::Ok(bytes) => match from_cbor(&bytes) {
                Ok(value) => PluginHostResult {
                    ok: true,
                    value,
                    error: String::new(),
                },
                Err(error) => return Response::Error(error),
            },
            HostResult::Error(error) => PluginHostResult {
                ok: false,
                value: Value::Null,
                error,
            },
        };
        let response = self.plugin.resume(continuation, result);
        self.materialize(response)
    }

    fn materialize(&mut self, response: PluginResponse<P::Continuation>) -> Response {
        match response {
            PluginResponse::Complete(value) => match to_cbor(&value) {
                Ok(bytes) => Response::Complete(bytes),
                Err(error) => Response::Error(error),
            },
            PluginResponse::Error(message) => Response::Error(message),
            PluginResponse::Effect {
                request,
                continuation,
            } => {
                let id = self.next_effect_id;
                self.next_effect_id = self.next_effect_id.wrapping_add(1).max(1);
                self.pending.insert(id, continuation);
                Response::Effect(Effect { id, request })
            }
        }
    }
}

pub fn from_cbor<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    ciborium::from_reader(bytes).map_err(|error| format!("Invalid CBOR payload: {error}"))
}

pub fn to_cbor<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    ciborium::into_writer(value, &mut bytes)
        .map_err(|error| format!("Failed to encode CBOR payload: {error}"))?;
    Ok(bytes)
}

#[macro_export]
macro_rules! export_plugin {
    ($plugin:ty) => {
        struct YrchatGuest;

        static mut YRCHAT_PLUGIN_RUNTIME: Option<$crate::Runtime<$plugin>> = None;

        fn yrchat_plugin_runtime() -> &'static mut $crate::Runtime<$plugin> {
            unsafe { YRCHAT_PLUGIN_RUNTIME.get_or_insert_with($crate::Runtime::default) }
        }

        impl $crate::Guest for YrchatGuest {
            fn invoke(request: $crate::Invocation) -> $crate::Response {
                yrchat_plugin_runtime().invoke(request)
            }

            fn resume(effect_id: u64, result: $crate::HostResult) -> $crate::Response {
                yrchat_plugin_runtime().resume(effect_id, result)
            }
        }

        $crate::export!(YrchatGuest);
    };
}

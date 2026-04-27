use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum RuntimeRoute {
    LocalHttp {
        endpoint: String,
    },
    #[non_exhaustive]
    Stdio {
        identity: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
#[serde(rename_all = "snake_case")]
enum RuntimeRouteWire {
    LocalHttp { endpoint: String },
    Stdio { identity: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeRouteError {
    message: String,
}

impl RuntimeRouteError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for RuntimeRouteError {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for RuntimeRouteError {}

impl Serialize for RuntimeRoute {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        RuntimeRouteWire::from(self).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for RuntimeRoute {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = RuntimeRouteWire::deserialize(deserializer)?;
        Self::try_from(wire).map_err(serde::de::Error::custom)
    }
}

impl From<&RuntimeRoute> for RuntimeRouteWire {
    fn from(route: &RuntimeRoute) -> Self {
        match route {
            RuntimeRoute::LocalHttp { endpoint } => RuntimeRouteWire::LocalHttp {
                endpoint: endpoint.clone(),
            },
            RuntimeRoute::Stdio { identity } => RuntimeRouteWire::Stdio {
                identity: identity.clone(),
            },
        }
    }
}

impl TryFrom<RuntimeRouteWire> for RuntimeRoute {
    type Error = RuntimeRouteError;

    fn try_from(route: RuntimeRouteWire) -> Result<Self, Self::Error> {
        match route {
            RuntimeRouteWire::LocalHttp { endpoint } => Ok(Self::LocalHttp { endpoint }),
            RuntimeRouteWire::Stdio { identity } => Self::stdio(identity),
        }
    }
}

impl RuntimeRoute {
    pub fn stdio(identity: impl Into<String>) -> Result<Self, RuntimeRouteError> {
        let identity = identity.into().trim().to_string();
        if identity.is_empty() {
            return Err(RuntimeRouteError::new(
                "Runtime stdio route identity is required.",
            ));
        }

        Ok(Self::Stdio { identity })
    }

    pub fn local_http_port(&self) -> Option<u16> {
        match self {
            Self::LocalHttp { endpoint } => Url::parse(endpoint).ok()?.port(),
            Self::Stdio { .. } => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeRoute;

    #[test]
    fn local_http_route_port_supports_paths() {
        let route = RuntimeRoute::LocalHttp {
            endpoint: "http://127.0.0.1:4321/api/runtime".to_string(),
        };

        assert_eq!(route.local_http_port(), Some(4321));
    }

    #[test]
    fn local_http_route_port_rejects_invalid_endpoints() {
        let route = RuntimeRoute::LocalHttp {
            endpoint: "127.0.0.1:4321".to_string(),
        };

        assert_eq!(route.local_http_port(), None);
    }

    #[test]
    fn stdio_route_serializes_without_endpoint_fields() {
        let json = serde_json::to_value(RuntimeRoute::stdio("runtime-stdio").unwrap())
            .expect("route should serialize");

        assert_eq!(json["type"], "stdio");
        assert_eq!(json["identity"], "runtime-stdio");
        assert!(json.get("endpoint").is_none());
        assert!(json.get("port").is_none());
    }

    #[test]
    fn stdio_route_deserializes_and_trims_identity() {
        let route: RuntimeRoute = serde_json::from_value(serde_json::json!({
            "type": "stdio",
            "identity": " runtime-stdio "
        }))
        .expect("stdio route should deserialize");

        assert_eq!(
            route,
            RuntimeRoute::Stdio {
                identity: "runtime-stdio".to_string()
            }
        );
    }

    #[test]
    fn stdio_route_rejects_missing_blank_and_unknown_fields() {
        for payload in [
            serde_json::json!({ "type": "stdio" }),
            serde_json::json!({ "type": "stdio", "identity": "   " }),
            serde_json::json!({ "type": "stdio", "identity": "runtime-stdio", "unexpected": true }),
            serde_json::json!({
                "type": "stdio",
                "identity": "runtime-stdio",
                "endpoint": "http://127.0.0.1:4444"
            }),
            serde_json::json!({ "type": "websocket", "identity": "runtime-stdio" }),
        ] {
            let result = serde_json::from_value::<RuntimeRoute>(payload);
            assert!(result.is_err(), "invalid stdio route should fail");
        }
    }

    #[test]
    fn stdio_route_has_no_http_port() {
        assert_eq!(
            RuntimeRoute::stdio("runtime-stdio")
                .unwrap()
                .local_http_port(),
            None
        );
    }
}

use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum RuntimeRoute {
    LocalHttp { endpoint: String },
    Stdio,
}

impl RuntimeRoute {
    pub fn local_http_port(&self) -> Option<u16> {
        match self {
            Self::LocalHttp { endpoint } => Url::parse(endpoint).ok()?.port(),
            Self::Stdio => None,
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
        let json = serde_json::to_value(RuntimeRoute::Stdio).expect("route should serialize");

        assert_eq!(json["type"], "stdio");
        assert!(json.get("endpoint").is_none());
    }

    #[test]
    fn stdio_route_has_no_http_port() {
        assert_eq!(RuntimeRoute::Stdio.local_http_port(), None);
    }
}

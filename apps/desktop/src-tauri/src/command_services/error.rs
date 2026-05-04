use std::fmt;

pub(crate) type CommandServiceResult<T> = Result<T, CommandServiceError>;

#[derive(Debug)]
pub(crate) enum CommandServiceError {
    InvalidRequest(String),
    Internal(anyhow::Error),
}

impl CommandServiceError {
    pub(crate) fn invalid_request(message: impl Into<String>) -> Self {
        Self::InvalidRequest(message.into())
    }

    pub(crate) fn internal(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }

    pub(crate) fn to_tauri_error(&self) -> String {
        match self {
            Self::InvalidRequest(message) => message.clone(),
            Self::Internal(error) => format!("{error:#}"),
        }
    }
}

impl fmt::Display for CommandServiceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(message) => formatter.write_str(message),
            Self::Internal(error) => write!(formatter, "{error:#}"),
        }
    }
}

impl std::error::Error for CommandServiceError {}

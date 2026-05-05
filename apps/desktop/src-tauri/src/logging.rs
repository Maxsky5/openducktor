use std::fmt;
use std::io::IsTerminal;
use std::sync::OnceLock;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

const ANSI_RESET: &str = "\u{001b}[0m";
const ANSI_DIM: &str = "\u{001b}[2m";
const ANSI_BLUE: &str = "\u{001b}[34m";
const ANSI_GREEN: &str = "\u{001b}[32m";
const ANSI_ORANGE: &str = "\u{001b}[33m";
const ANSI_RED: &str = "\u{001b}[31m";

static TRACING_INITIALIZED: OnceLock<()> = OnceLock::new();

struct HumanLogFormatter {
    use_ansi: bool,
}

#[derive(Default)]
struct HumanLogVisitor {
    message: Option<String>,
    fields: Vec<String>,
}

impl HumanLogFormatter {
    fn timestamp(&self) -> String {
        chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false)
    }

    fn level(&self, level: &Level) -> String {
        let label = level.as_str();
        if !self.use_ansi {
            return label.to_string();
        }
        let color = match *level {
            Level::INFO => ANSI_BLUE,
            Level::WARN => ANSI_ORANGE,
            Level::ERROR => ANSI_RED,
            Level::DEBUG | Level::TRACE => ANSI_DIM,
        };
        format!("{color}{label}{ANSI_RESET}")
    }

    fn message(&self, level: &Level, message: String) -> String {
        if !self.use_ansi {
            return message;
        }
        let color = match *level {
            Level::WARN => Some(ANSI_ORANGE),
            Level::ERROR => Some(ANSI_RED),
            Level::INFO if is_success_log_message(message.as_str()) => Some(ANSI_GREEN),
            _ => None,
        };
        match color {
            Some(color) => format!("{color}{message}{ANSI_RESET}"),
            None => message,
        }
    }
}

impl HumanLogVisitor {
    fn record_value(&mut self, field: &Field, value: String) {
        if field.name() == "message" {
            self.message = Some(value);
            return;
        }
        self.fields.push(format!("{}={value}", field.name()));
    }
}

impl Visit for HumanLogVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.record_value(field, format!("{value:?}"));
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.record_value(field, value.to_string());
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.record_value(field, value.to_string());
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.record_value(field, value.to_string());
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.record_value(field, value.to_string());
    }
}

impl<S, N> FormatEvent<S, N> for HumanLogFormatter
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let metadata = event.metadata();
        let mut visitor = HumanLogVisitor::default();
        event.record(&mut visitor);
        let message = visitor
            .message
            .unwrap_or_else(|| metadata.target().to_string());
        let fields = if visitor.fields.is_empty() {
            String::new()
        } else {
            format!(" ({})", visitor.fields.join(" "))
        };
        let timestamp = if self.use_ansi {
            format!("{ANSI_DIM}{}{ANSI_RESET}", self.timestamp())
        } else {
            self.timestamp()
        };
        writeln!(
            writer,
            "{timestamp}  {} {}{fields}",
            self.level(metadata.level()),
            self.message(metadata.level(), message)
        )
    }
}

fn is_success_log_message(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains(" is ready")
        || message.contains(" is listening")
        || message.contains(" stopped")
        || message.contains("shutdown complete")
        || message.contains("web is ready")
}

pub(crate) fn init_tracing_subscriber() {
    TRACING_INITIALIZED.get_or_init(|| {
        let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
        let force_color = std::env::var("FORCE_COLOR")
            .ok()
            .map(|value| {
                let trimmed = value.trim();
                !trimmed.is_empty() && trimmed != "0"
            })
            .unwrap_or(false);
        let use_ansi = std::env::var_os("NO_COLOR").is_none()
            && (force_color || std::io::stderr().is_terminal());
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(false)
            .with_ansi(use_ansi)
            .event_format(HumanLogFormatter { use_ansi })
            .finish();
        if let Err(error) = tracing::subscriber::set_global_default(subscriber) {
            eprintln!("OpenDucktor warning: failed to initialize tracing subscriber: {error:#}");
        }
    });
}

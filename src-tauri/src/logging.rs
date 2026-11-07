use std::fmt::Debug;
use std::path::{Path, PathBuf};
use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

const LOG_DIR: &str = "logs";
const LOG_PREFIX: &str = "null-notes";
const LOG_SUFFIX: &str = "log";
const KEEP_DAYS: usize = 14;
const FILTER_ENV: &str = "NULLNOTES_LOG";
const DEFAULT_FILTER: &str = "warn,null_notes_lib=info";

#[derive(Default)]
struct MessageVisitor {
    message: String,
    fields: Vec<String>,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        if field.name() == "message" {
            self.message = format!("{value:?}");
        } else {
            self.fields.push(format!("{}={value:?}", field.name()));
        }
    }
}

/// Feeds `error`-level events into `errors.log`, which the error-log dialog reads.
struct ErrorLogLayer {
    dir: PathBuf,
}

impl<S: Subscriber> Layer<S> for ErrorLogLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let context = format!("{} {}", event.metadata().target(), visitor.fields.join(" "));
        crate::commands::error_log::append_entry_sync(
            &self.dir,
            "backend",
            &visitor.message,
            Some(context.trim()),
        );
    }
}

/// Daily-rotating local log file under `<app-data>/logs`. The returned guard
/// flushes the background writer on drop, so keep it alive for the whole run.
pub fn init(data_dir: &Path) -> Option<WorkerGuard> {
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix(LOG_PREFIX)
        .filename_suffix(LOG_SUFFIX)
        .max_log_files(KEEP_DAYS)
        .build(data_dir.join(LOG_DIR))
        .ok()?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let filter =
        EnvFilter::try_from_env(FILTER_ENV).unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(writer)
                .with_ansi(false)
                .with_filter(filter),
        )
        .with(
            ErrorLogLayer {
                dir: data_dir.to_path_buf(),
            }
            .with_filter(LevelFilter::ERROR),
        )
        .try_init()
        .ok()?;
    Some(guard)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_events_reach_errors_log_and_info_stays_in_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let guard = init(dir.path()).unwrap();

        tracing::info!("routine");
        tracing::error!(path = "a.md", "save failed");
        drop(guard);

        let errors = std::fs::read_to_string(dir.path().join("errors.log")).unwrap();
        assert!(errors.contains("save failed") && errors.contains("a.md"));
        assert!(!errors.contains("routine"));

        let log_file = std::fs::read_dir(dir.path().join(LOG_DIR))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let logged = std::fs::read_to_string(log_file).unwrap();
        assert!(logged.contains("routine") && logged.contains("save failed"));
    }
}

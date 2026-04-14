use crate::{as_error, run_service_blocking, AppState};
use tauri::State;

#[tauri::command]
pub async fn filesystem_list_directory(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<host_domain::DirectoryListing, String> {
    let service = state.service.clone();
    as_error(
        run_service_blocking("filesystem_list_directory", move || {
            service
                .filesystem_list_directory(path.as_deref())
                .map_err(anyhow::Error::from)
        })
        .await,
    )
}

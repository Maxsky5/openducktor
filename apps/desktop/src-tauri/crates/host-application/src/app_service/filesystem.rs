use super::AppService;
use host_domain::DirectoryListing;
use host_infra_system::{list_directory, FilesystemListDirectoryError};

impl AppService {
    pub fn filesystem_list_directory(
        &self,
        path: Option<&str>,
    ) -> Result<DirectoryListing, FilesystemListDirectoryError> {
        list_directory(path)
    }
}

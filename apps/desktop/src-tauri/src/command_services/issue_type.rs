use host_domain::IssueType;

pub(crate) fn parse_issue_type(value: &str, field_name: &str) -> Result<IssueType, String> {
    IssueType::from_cli_value(value).ok_or_else(|| {
        format!("Invalid {field_name}: '{value}'. Allowed values: task, feature, bug, epic.")
    })
}

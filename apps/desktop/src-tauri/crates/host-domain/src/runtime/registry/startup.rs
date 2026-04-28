use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStartupReadinessConfig {
    pub timeout_ms: u64,
    pub connect_timeout_ms: u64,
    pub initial_retry_delay_ms: u64,
    pub max_retry_delay_ms: u64,
    pub child_check_interval_ms: u64,
}

impl Default for RuntimeStartupReadinessConfig {
    fn default() -> Self {
        Self {
            timeout_ms: 15_000,
            connect_timeout_ms: 250,
            initial_retry_delay_ms: 25,
            max_retry_delay_ms: 250,
            child_check_interval_ms: 75,
        }
    }
}

impl RuntimeStartupReadinessConfig {
    pub fn normalize(&mut self) {
        self.timeout_ms = self.timeout_ms.clamp(15_000, 120_000);
        self.connect_timeout_ms = self.connect_timeout_ms.clamp(25, 10_000);
        self.initial_retry_delay_ms = self.initial_retry_delay_ms.clamp(5, 5_000);
        self.max_retry_delay_ms = self.max_retry_delay_ms.clamp(10, 10_000);
        self.child_check_interval_ms = self.child_check_interval_ms.clamp(10, 2_000);
        if self.max_retry_delay_ms < self.initial_retry_delay_ms {
            self.max_retry_delay_ms = self.initial_retry_delay_ms;
        }
    }
}

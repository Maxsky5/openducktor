use super::*;

impl AppService {
    pub(super) fn enrich_task(&self, task: TaskCard, all_tasks: &[TaskCard]) -> TaskCard {
        let mut enriched = task;
        enriched.available_actions = derive_available_actions(&enriched, all_tasks);
        enriched.agent_workflows = derive_agent_workflows(&enriched);
        enriched
    }

    pub(super) fn enrich_tasks(&self, tasks: Vec<TaskCard>) -> Vec<TaskCard> {
        let snapshot = tasks.clone();
        tasks
            .into_iter()
            .map(|task| self.enrich_task(task, &snapshot))
            .collect()
    }
}

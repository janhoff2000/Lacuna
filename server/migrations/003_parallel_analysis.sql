DROP INDEX one_active_task;
CREATE INDEX active_tasks_by_run_stage ON tasks(run_id,stage,status,updated_at);

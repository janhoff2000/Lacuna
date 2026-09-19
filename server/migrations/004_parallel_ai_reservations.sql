DROP INDEX one_ai_in_flight;
CREATE INDEX ai_in_flight_by_run ON ai_requests(run_id,status);

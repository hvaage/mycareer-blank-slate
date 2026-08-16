alter table ai.model_runs drop constraint if exists model_runs_status_check;
alter table ai.model_runs add constraint model_runs_status_check
  check (status = any (array['queued','running','succeeded','failed','cancelled','configuration_error']));

alter table ai.model_runs drop constraint if exists model_runs_outcome_check;
alter table ai.model_runs add constraint model_runs_outcome_check
  check (outcome is null or outcome = any (array['ok','provider_error','timeout','invalid_output','cancelled','configuration_error']));

alter table ai.model_runs drop constraint if exists model_runs_terminal_finished;
alter table ai.model_runs add constraint model_runs_terminal_finished
  check ((status = any (array['succeeded','failed','cancelled','configuration_error'])) = (finished_at is not null));

comment on constraint model_runs_status_check on ai.model_runs is
  'configuration_error: kallet var ugyldig for modellprofilen. Terminal. Ingen retry, ingen API-request.';
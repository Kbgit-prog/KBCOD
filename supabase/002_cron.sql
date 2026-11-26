-- Déclencheur de la file KB COD : appel HTTPS chaque minute (pg_cron + pg_net, offre gratuite).
-- Secret partagé et URL lus dans Supabase Vault ; sans secret, aucun appel n'est envoyé.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION kbcod.cron_tick(maint boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  secret text;
  base text;
BEGIN
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'kbcod_cron_secret';
  SELECT decrypted_secret INTO base FROM vault.decrypted_secrets WHERE name = 'kbcod_app_url';
  IF secret IS NULL OR base IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := base || '/cron/jobs' || CASE WHEN maint THEN '?maintenance=1' ELSE '' END,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END $$;
REVOKE ALL ON FUNCTION kbcod.cron_tick(boolean) FROM PUBLIC, anon, authenticated, kbcod_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'kbcod_app_url') THEN
    PERFORM vault.create_secret('https://kbcod-manager.vercel.app', 'kbcod_app_url', 'URL publique de KB COD Manager');
  END IF;
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('kbcod-jobs', 'kbcod-maintenance');
SELECT cron.schedule('kbcod-jobs', '* * * * *', 'select kbcod.cron_tick(false)');
SELECT cron.schedule('kbcod-maintenance', '17 3 * * *', 'select kbcod.cron_tick(true)');

-- Étape réservée au propriétaire : enregistrer le secret partagé (même valeur que CRON_SECRET dans Vercel)
-- SELECT vault.create_secret('<CRON_SECRET>', 'kbcod_cron_secret', 'Secret cron KB COD');

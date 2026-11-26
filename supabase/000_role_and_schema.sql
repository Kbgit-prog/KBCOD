-- KB COD Manager — préparation d'un projet Supabase (exécuté en tant que « postgres »).
-- Crée un rôle applicatif dédié et le schéma isolé « kbcod » (non exposé par l'API REST Supabase).
-- Appliqué le 26/11/2026 sur le projet plysnvrltuzwzgxjnxed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kbcod_app') THEN
    CREATE ROLE kbcod_app NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT kbcod_app TO postgres;
CREATE SCHEMA IF NOT EXISTS kbcod AUTHORIZATION kbcod_app;
REVOKE ALL ON SCHEMA kbcod FROM PUBLIC;
REVOKE ALL ON SCHEMA kbcod FROM anon, authenticated;
GRANT USAGE ON SCHEMA extensions TO kbcod_app;
ALTER ROLE kbcod_app SET search_path = kbcod, extensions, public;
ALTER ROLE kbcod_app CONNECTION LIMIT 20;

-- Étape réservée au propriétaire (le mot de passe ne doit jamais être commité) :
-- ALTER ROLE kbcod_app WITH LOGIN PASSWORD '<DB_PASSWORD>';

-- Ensuite, appliquer migrations/001_init.sql en tant que kbcod_app :
--   SET ROLE kbcod_app;  \i migrations/001_init.sql   (ou npm run migrate avec DATABASE_URL du rôle)

-- Script de nettoyage des comics - Phase 1 (Filtrage strict)
-- Retire: Compilations, Magazines, Adaptations films, Licensed/Kids
-- Impact estimé: -455 entrées (-5.1%)

-- Étape 1: Voir combien de comics seront supprimés
SELECT
  COUNT(*) as total_a_supprimer,
  CASE
    WHEN title ILIKE '%masterwork%' OR title ILIKE '%essential%' OR title ILIKE '%omnibus%'
         OR title ILIKE '%epic collection%' OR title ILIKE '%showcase presents%'
         OR title ILIKE '%archives%' OR title ILIKE '%ultimate collection%'
         OR title ILIKE '%platinum%' THEN 'Compilation/Réimpression'
    WHEN title ILIKE '%magazine%' OR title ILIKE '%digest%' THEN 'Magazine/Digest'
    WHEN title ILIKE '%movie%' OR title ILIKE '%adaptation%' OR title ILIKE '%motion picture%'
         OR title ILIKE '%official comic%' THEN 'Adaptation film'
    WHEN title ILIKE 'disney%' OR title ILIKE '%alf%' OR title ILIKE 'dennis the menace%'
         OR title ILIKE 'star trek%' THEN 'Licensed/Kids'
  END as categorie
FROM books
WHERE type = 'comic'
AND (
  -- Compilations/Réimpressions
  title ILIKE '%masterwork%'
  OR title ILIKE '%essential%'
  OR title ILIKE '%omnibus%'
  OR title ILIKE '%epic collection%'
  OR title ILIKE '%showcase presents%'
  OR title ILIKE '%archives%'
  OR title ILIKE '%ultimate collection%'
  OR title ILIKE '%platinum%'
  -- Magazines/Digests
  OR title ILIKE '%magazine%'
  OR title ILIKE '%digest%'
  -- Adaptations films
  OR title ILIKE '%movie%'
  OR title ILIKE '%adaptation%'
  OR title ILIKE '%motion picture%'
  OR title ILIKE '%official comic%'
  -- Licensed/Kids
  OR title ILIKE 'disney%'
  OR title ILIKE '%alf%'
  OR title ILIKE 'dennis the menace%'
  OR title ILIKE 'star trek%'
)
GROUP BY categorie;

-- Étape 2: Aperçu des comics qui seront supprimés (20 exemples)
SELECT
  id,
  title,
  release_year,
  CASE
    WHEN title ILIKE '%masterwork%' OR title ILIKE '%essential%' OR title ILIKE '%omnibus%'
         OR title ILIKE '%epic collection%' OR title ILIKE '%showcase presents%'
         OR title ILIKE '%archives%' OR title ILIKE '%ultimate collection%'
         OR title ILIKE '%platinum%' THEN 'Compilation'
    WHEN title ILIKE '%magazine%' OR title ILIKE '%digest%' THEN 'Magazine'
    WHEN title ILIKE '%movie%' OR title ILIKE '%adaptation%' OR title ILIKE '%motion picture%'
         OR title ILIKE '%official comic%' THEN 'Film'
    WHEN title ILIKE 'disney%' OR title ILIKE '%alf%' OR title ILIKE 'dennis the menace%'
         OR title ILIKE 'star trek%' THEN 'Licensed'
  END as raison
FROM books
WHERE type = 'comic'
AND (
  title ILIKE '%masterwork%' OR title ILIKE '%essential%' OR title ILIKE '%omnibus%'
  OR title ILIKE '%epic collection%' OR title ILIKE '%showcase presents%'
  OR title ILIKE '%archives%' OR title ILIKE '%ultimate collection%'
  OR title ILIKE '%platinum%'
  OR title ILIKE '%magazine%' OR title ILIKE '%digest%'
  OR title ILIKE '%movie%' OR title ILIKE '%adaptation%' OR title ILIKE '%motion picture%'
  OR title ILIKE '%official comic%'
  OR title ILIKE 'disney%' OR title ILIKE '%alf%'
  OR title ILIKE 'dennis the menace%' OR title ILIKE 'star trek%'
)
ORDER BY release_year DESC
LIMIT 20;

-- Étape 3: SUPPRESSION (décommenter pour exécuter)
-- BEGIN;

-- DELETE FROM books
-- WHERE type = 'comic'
-- AND (
--   -- Compilations/Réimpressions
--   title ILIKE '%masterwork%'
--   OR title ILIKE '%essential%'
--   OR title ILIKE '%omnibus%'
--   OR title ILIKE '%epic collection%'
--   OR title ILIKE '%showcase presents%'
--   OR title ILIKE '%archives%'
--   OR title ILIKE '%ultimate collection%'
--   OR title ILIKE '%platinum%'
--   -- Magazines/Digests
--   OR title ILIKE '%magazine%'
--   OR title ILIKE '%digest%'
--   -- Adaptations films
--   OR title ILIKE '%movie%'
--   OR title ILIKE '%adaptation%'
--   OR title ILIKE '%motion picture%'
--   OR title ILIKE '%official comic%'
--   -- Licensed/Kids
--   OR title ILIKE 'disney%'
--   OR title ILIKE '%alf%'
--   OR title ILIKE 'dennis the menace%'
--   OR title ILIKE 'star trek%'
-- );

-- COMMIT;

-- Étape 4: Vérification après suppression
-- SELECT
--   COUNT(*) as total_comics_restants,
--   MIN(release_year) as annee_min,
--   MAX(release_year) as annee_max
-- FROM books
-- WHERE type = 'comic';

# Idées encore ouvertes

Revue du 13/10/2026 : code actuel et navigation sur ordinateur / téléphone, en session locale isolée avec des repas fictifs. Les points terminés sont retirés ; les identifiants restants sont conservés. Les propositions ci-dessous ne valent pas décision d'implémentation.

## Usage et navigation

- **P-01 · Accès rapide aux conseils.** Les conseils du jour existent sous le journal. Évaluer un résumé cliquable près du bilan, sans refaire le moteur de recommandations.
- **P-02 · Recherche globale (Ctrl + K).** Trouver un aliment, un nutriment, une date ou une action depuis un même champ.
- **P-04 · Graphiques en plein écran.** Donner plus de place au nuage, à la carte ACP et aux tendances, surtout sur téléphone ; export d'image en option.
- **P-06 · Vue semaine.** Voir sept jours côte à côte avec leurs apports et leurs jours manquants. L'agrégat « Semaine » existe déjà dans les tendances, mais affiche une moyenne quotidienne, pas ce bilan.
- **P-09 · Alléger les analyses.** Le catalogue est déjà renommé et les analyses sont dans Stats → Aliments. Clarifier encore « Explorer visuel » / « Comparer » et l'accès à l'ACP ; garder les outils avancés dans des vues dédiées. La suppression de la matrice n'est pas décidée.
- **U-03 · Tendance → journée.** Au clic sur un point journalier dans Stats, proposer « Voir cette journée » puis ouvrir la date dans l'historique. Définir séparément le comportement des points semaine/mois.

## Calculs et données

- **P-03 · Limites dans les moyennes.** Dans Stats → Couverture moyenne, signaler les dépassements de seuils de prudence connus pour les nutriments « à couvrir ». Le bilan du jour distingue déjà ces seuils ; dépasser 100 % d'un objectif ne suffit pas à qualifier un excès.
- **P-05 · Traçabilité des chiffres restants.** L'énergie et le soleil ont déjà leur détail. Compléter au besoin les cibles et scores de recommandations : formule, entrées utilisées, étapes et limites accessibles au clic.
- **P-07 · Cuivre.** Ajouter le nutriment après vérification de la couverture des aliments, des références et des limites. Distinguer inconnu de zéro ; un rapprochement avec le zinc reste à discuter.
- **P-08 · Vitamine A détaillée.** Garder le total `vitA`, et conserver rétinol / bêta-carotène séparément lorsque les sources le permettent ; expliciter conversion et données manquantes.

## À confirmer à l'usage

- **C-02 · Reconnexions sur téléphone.** Le signalement reste ouvert, sans reproduction pendant cet audit. Relever navigateur, installation PWA, délai et erreur d'authentification avant de choisir une correction ; l'ancienne explication par partage du mot de passe n'était pas un diagnostic établi.
- **C-05 · Doublons par contenu.** La détection utilise encore le nom. Envisager la proximité nutritionnelle seulement si des doublons réels lui échappent, sans fusion automatique.

## Nouvelles propositions à discuter

- **U-01 · Période vide.** Reproduit avec un journal neuf : Stats affiche toutes les couvertures à 0 % malgré « 0 jour enregistré ». Remplacer ces valeurs par un état « aucune donnée » et un accès à la saisie, pour ne pas faire passer l'absence de données pour un apport nul.
- **U-02 · Découverte du chat sur mobile.** À 390 × 844, l'encart initial recouvre les contrôles de tendance ; le chat demande pourtant de configurer un moteur. Préférer une invitation compacte, affichée une fois dans un emplacement libre, avec un accès à la configuration si nécessaire.

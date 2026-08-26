# Idées & défauts — FoodRecorder

**Comment lire ce fichier.** Quatre sections, dans l'ordre où l'on s'en sert :

| Section | Ce qu'on y trouve | Préfixe |
|---|---|---|
| 1. Bugs | Défauts **reproduits au navigateur**, avec la mesure et la cause | `B-xx` |
| 2. Frictions | Rien de cassé, mais l'usage coince | `U-xx` |
| 3. Perspectives | Réorganisations, autres angles — à trancher, pas à appliquer | `P-xx` |
| 4. Chantiers | Décidés, pas encore faits (repris de l'ancien fichier) | `C-xx` |

Chaque entrée : **Constaté** (le fait mesuré) → **Cause / Où** → **Piste** (parfois plusieurs, au choix).
Les entrées terminées sont **supprimées**, pas cochées : l'historique est dans git.

> Session d'audit du 22/08/2026 : app pilotée dans Chrome (1440×950 et 390×844), jeu de test de
> 226 repas sur 70 jours + 38 pesées, plus un passage à état vide. Les onze bugs et les dix frictions
> qui en sont sortis sont traités (sections 1 et 2 vides) ; restent les perspectives et les chantiers.

---

## 1. Bugs

*Aucun bug ouvert.*

## 2. Frictions d'usage

*Aucune friction ouverte.* Les dix frictions relevées le 22/08/2026 ont été traitées — le détail est
dans git. Une seule a été **écartée sans correction** : U-07 (l'icône 🔇 / 🔊 pour « ne pas compter ce
jour »). Sur une case de calendrier de 40 px, aucun libellé en toutes lettres ne tient, et le geste à
un clic vaut mieux que la métaphore parfaite ; le panneau du jour, lui, le dit déjà en clair.

---

## 3. Perspectives

Rien ici n'est un défaut : ce sont des angles différents, à garder ou à jeter.

### P-01 · Renverser l'écran d'accueil : « ce qui cloche » au lieu de « tout »

L'app sait déjà, aujourd'hui, quels nutriments sont en carence, lesquels sont en excès, et quels aliments
les corrigeraient (`recommend.ts`, `guide.ts`). Ce savoir est rangé dans deux onglets qu'il faut aller
ouvrir. L'écran d'accueil, lui, ouvre sur les calories et les macros, les 38 cartes neutres repliées
dessous (et triables par urgence) — mais il ne dit toujours pas ce qui cloche, il attend qu'on regarde.

Un accueil qui dirait « il te manque surtout de l'oméga 3 et de la vitamine D ; du saumon ce soir règle
les deux » utiliserait ce qui existe déjà. Le mur reste dessous pour qui veut vérifier.

**Ce qu'il faut trancher** : veut-on une app qui **montre** (position actuelle : neutre, l'utilisateur
juge) ou une app qui **conseille** ? Le README revendique la première. Un accueil qui conseille peut se
contenter de **pointer** — « 3 nutriments en carence », cliquable — sans rien dicter.

### P-02 · Une recherche globale (Ctrl + K)

Sept onglets, des dizaines de panneaux, 40 nutriments, 148 aliments. Une palette de commandes qui
répondrait à « vitamine D », « saumon », « 12 août », « exporter » en menant directement au bon endroit
ferait gagner plus que n'importe quelle réorganisation de menus. Le socle est là : aliments, nutriments
et dates sont déjà tous indexables.

### P-03 · Signaler l'excès autant que le manque

**Constaté.** Dans « Couverture moyenne », la vitamine K1 à **265 %** et la vitamine B3 à **100 %** sont
**de la même couleur verte** : la barre sature visuellement à 100 %, au-delà rien ne change.

Pour K1 c'est sans conséquence. Le principe ne l'est pas : une app qui affiche l'écart aux objectifs
devrait distinguer « atteint » de « largement dépassé », ne serait-ce que pour les nutriments à plafond
(fer, zinc, sélénium, vitamine A). Il existe déjà des nutriments « à limiter », avec plafond et barre
d'excès — AG saturés, AG trans, sodium, alcool — mais aucun de ceux-là.

### P-04 · Un mode « analyse » plein écran

Le nuage, l'ACP et la tendance ont gagné la largeur étendue (1 200 px sur les onglets concernés) et la
frontière de Pareto porte désormais des noms, mais ils restent bardés de contrôles au-dessus, et le
téléphone n'a rien gagné. Un bouton « ⤢ » qui ouvre le graphe seul, sur toute la fenêtre, contrôles en
surimpression, donnerait la place qui manque encore — et une image exportable pour le README.

### P-05 · La preuve du calcul, en un clic

L'app avance des chiffres construits (TDEE, cibles, statut vitamine D, score de recommandation) et les
explique en texte. Le pont Claude Code archive déjà chaque appel LLM dans `response/`. Il manque le
pendant côté calcul : un « d'où sort ce chiffre ? » qui déplie la chaîne (formule retenue → entrées →
étapes → résultat). C'est cohérent avec la ligne du projet — dire ce qui est établi et ce qui ne l'est
pas — et ça vaut mieux qu'un paragraphe d'explication figé.

*(À rapprocher de B-06 : deux chiffres de calories qui divergent de 12 kcal se seraient expliqués tout
seuls avec ce mécanisme.)*

### P-06 · Ce qui manque vraiment : la vue « semaine »

Il y a le jour (saisie) et la période (moyennes sur 7/30/90 jours). Entre les deux, rien. Or c'est la
semaine qui se pilote : « j'ai été bas en protéines lundi et mardi, je rattrape jeudi ». Une vue à sept
colonnes, nutriment par nutriment, avec le cumul de la semaine face à sept fois l'objectif, dirait
quelque chose qu'aucune moyenne à 30 jours ne dit.

---

## 4. Chantiers décidés, pas encore faits

### C-01 · Métabolisme observé (déduit des données réelles)

Estimer le métabolisme à partir des kcal réellement mangées et de la variation de poids sur une période
réglable, puis proposer d'appliquer les nouveaux objectifs.

**Vérifié le 22/08/2026 : toujours pas fait.** Le commit `5915636` a bâti le calcul **prédictif** (du
corps vers la dépense : BMR + NEAT + sport + TEF → TDEE, [energy.ts](web/src/nutrition/energy.ts)), qui
est l'inverse de cette idée. Rien ne remonte des données réelles vers le métabolisme observé.

Les deux briques existent déjà dans [WeightChart.tsx](web/src/ui/WeightChart.tsx) mais ne sont **jamais
croisées numériquement** : les kcal/jour y sont superposées à la courbe de poids (visuel seulement), et
une pente de poids y est calculée (pour l'ETA d'objectif, pas pour en déduire une dépense). Le bouton
« appliquer les nouveaux objectifs » n'existe pas. À noter :
[guide.ts:73](web/src/nutrition/guide.ts#L73) conseille déjà de « corriger ce chiffre avec la balance
sur 3-4 semaines » — sans donner l'outil pour le faire.

**Tranché** : les jours sans saisie ne sont **pas** comptés comme des jours à 0 kcal (un seul suffit à
fausser la moyenne). On ne calcule que sur les jours réellement saisis, et on **refuse d'afficher un
résultat sous ~80 % de couverture** sur la période, en disant combien de jours manquent.

**Reste à décider** : ce que fait le bouton « appliquer » (un correctif personnel daté et annulable
ajouté à la dépense calculée ? une recalibration des postes ? l'écrasement direct de la cible ?), et où
loger l'écran (panneau « Dépense énergétique », où les deux chiffres se confrontent, ou onglet Poids, où
vivent les données).

### C-02 · Reconnexions trop fréquentes sur téléphone

Le téléphone redemande le mot de passe. Cause probable : le compte Supabase Auth est **partagé entre
appareils** (un seul mot de passe par profil), et Supabase fait tourner le refresh token à chaque
rafraîchissement — si l'ordi rafraîchit pendant que le téléphone détient encore l'ancien jeton, le
téléphone se fait rejeter. À iOS Safari s'ajoute la purge du `localStorage` après ~7 jours sans ouvrir
le site.

Trois pistes, à combiner :
- Dashboard Supabase (Authentication → Sessions) : vérifier/augmenter la durée de session et le
  « refresh token reuse interval » (fenêtre de tolérance après rotation).
- Utiliser l'app en PWA installée (« ajouter à l'écran d'accueil ») plutôt qu'un onglet Safari.
- Demander `navigator.storage.persist()` au démarrage, pour réduire le risque d'éviction.

### C-03 · Un LLM qui se promène dans les données de l'app

Un endroit où discuter avec un modèle qui peut **aller chercher les données de l'app** pour répondre.
Idée complexe, mais qui vaut le coup. Ouverture possible par un bouton de chat présent partout (en bas à
droite ?) — l'UX reste à trouver.

### C-04 · Autres fournisseurs de modèles

Ajouter d'autres clés API : modèles open source, OpenAI, voire Codex CLI si c'est faisable sur le modèle
du pont Claude Code.
- gemeini, mistral aussi avec version free tier (pourquoi pas open router)

### C-05 · Fusion de doublons : rapprocher aussi par le contenu ?

La détection actuelle est par similarité de nom (`findDuplicates`). À voir à l'usage s'il faut aussi
rapprocher par proximité nutritionnelle.

### C-06 · Relecture IA en masse — écartée pour l'instant

Relire tous les « à vérifier » d'un coup : une fiche complète fait 39 valeurs, donc un appel long par
aliment. À reconsidérer si la relecture une par une devient fastidieuse.

### C-07 · Regarder ce que font les autres (Cronometer, Yazio…)

**À éclaircir avant de lancer quoi que ce soit** : ce qu'on en attend concrètement — une note comparative
écrite, fonctionnalité par fonctionnalité ? un focus sur un aspect précis (saisie, graphes, base de
données) ?


- renommer banque d'aliments : et memem reflechir à reoragnieser les comparer explorateur visuel (a renommé ?) sortir des des element et ce que LES acp doivent etre avec comparer ? est ce qu'on ne supprimerait pas matrice de correlation ?
est ce que dans stats ? mieux vaut des panels long ou faire beaucoup plus de panle courrts reflexion dans telphone et ordi (attetion dans le futur le nb de features peut encore augmenter)


- [ ] CLique sur un jours dans le graph dans stats mettre un petit menu voulez vous voir ce jour dans histoirique (ou texte similaire) et tu peux confirmer ca t'envoie dans histoirique sur ce jour


- [ ] variables "prix" pour 100g à ajouter pour la frontière de pareto dans la banque ca peut être sympa
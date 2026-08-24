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
> 226 repas sur 70 jours + 38 pesées, plus un passage à état vide — d'où viennent les frictions
> ci-dessous.

---

## 1. Bugs

*Aucun bug ouvert.*

## 2. Frictions d'usage

### U-01 · L'écran d'accueil est un mur de 38 cartes à zéro

**Constaté.** Onglet « Aujourd'hui » : **38 cartes de nutriments** sous le champ de saisie — 1 908 px
de haut à 390 px de large, 949 px à 1 440. À l'installation ce sont 38 cartes affichant `0 g · 0 %`.
C'est la toute première chose que voit quelqu'un qui ouvre l'app — et à 8 h du matin, c'est aussi ce
que voit l'utilisateur quotidien.

**Piste.** Le mur reste utile, mais pas **par défaut** ni **en entier**. Trois options :
- **Replier** : macros + les 4 à 6 nutriments qui posent problème aujourd'hui, « voir les 38 » dessous.
- **Trier par urgence** plutôt que par famille : ce qui est en carence en haut, ce qui est réglé en bas.


---> OUI pouvoir trier, de base replier pouvoir deplier (tout ou juste macros peut etre ?) 
---> pareil les repas pouvoir déplier ou non, le mode replier pourrait montrer en très court les repas mais sans le details de ce qu'il y a dedans et dans un vue plus collés sérré 

### U 01 b
similaires dans stats, testons plusieurs UI mais je pense que les valeur cliquables nutriments qui se mettent sur le graph devraient prendre moins de place (surtout que y a 2 fois) : Mon idée c'est les nutriment en petit sur les cotés du graph pas en dessous : attention sur telephone jsp comment faire 
et pour la liste avec echelle jsp exactement comment reduire l longueur car on veut voir l'echelle (peut être pouvoir déplier ou non jsp genre un voir plus il te mets que les 3 que tu manques le plus et tu cliques si tu veux tout voird)


### U-02 · L'onglet « Profil » fait 5 857 px et mélange sept sujets

**Constaté.** Dans l'ordre : profil & objectif → dépense énergétique → **profil & synchro cloud** →
dicter une pesée → nouvelle pesée → évolution → historique. L'historique des pesées à lui seul fait
**3 058 px pour 38 lignes**, sans pagination ni repli, et chaque ligne tient sur deux lignes de texte
dense (IMC, MB Harris-Benedict, MB Mifflin, TMA…). À deux ans de pesées, c'est ingérable.

**Pistes.**
- L'historique replié par défaut, ou paginé, ou limité aux 10 dernières avec « tout voir ».
- Alléger la ligne : la date, le poids, la masse grasse ; le reste au dépli.
- **La synchro cloud n'a rien à faire ici** — c'est un réglage, pas une donnée corporelle.
- Question de fond : « Profil » (le corps, les objectifs) et « Poids » (les mesures) sont deux choses.
  Elles ont été fusionnées ; il n'est pas sûr que ça tienne à l'usage.

--> proposition : synchro cloud en haut de reglages, et on renomme tout en poids (sachant que nouvelle pesée mesure faut le mettre plus haut)

### U-03 · Nutriments : 1 800 px de curseurs avant d'atteindre les panneaux utiles

**Constaté.** « Comprendre & régler chaque nutriment » aligne **37 curseurs identiques** (plus 5
curseurs de groupe), presque tous à ×1. Ils sont posés entre les recommandations (en haut) et les
deux panneaux les plus lus — « Vitamine D : carence ? » et « Rapports optimaux » — qu'il faut aller
chercher tout en bas.

**Piste.** Replier le bloc derrière un « Régler l'importance des nutriments (3 modifiés) », et remonter
la vitamine D et les rapports. Le compteur de modifications suffit à signaler que le réglage existe.

- [ ] pouvoir changer dans nutriments tout les ajr où optimalité (mettre une option revenir au conseillé) : comme protéines dans profil 
et d'ailleurs mettre en valeur brut ou en fonction du pdc selon le nutriment pour ce qui est mesure comme ca souvent (prot, lipides, peut etre des micronutriment jsp)

### U-04 · Le nuage de points n'étiquette aucun aliment — pas même la frontière de Pareto

**Constaté.** 39 aliments, aucun nom affiché ; il faut survoler chaque point. Or **la frontière de
Pareto ne compte que peu de points**, bien espacés, et c'est la raison d'être de la vue : elle est présentée
comme la réponse à « qu'est-ce qui maximise X en minimisant Y ? », et la réponse est huit ronds anonymes.

**Piste.** Étiqueter **les seuls points de la frontière** (avec évitement des collisions, cf. B-11).
**Alternative** : une petite liste ordonnée sous le graphe — « la frontière, dans l'ordre : Épinards →
Brocoli → Cabillaud → … » — qui a l'avantage d'être lisible au téléphone, là où le nuage ne l'est pas.

### U-05 · La légende des catégories est loin du graphe, et 11 couleurs se ressemblent

**Constaté.** Dans « Explorer visuel », la légende est dans un **panneau séparé, sous le graphe**
(~150 px plus bas) : l'œil fait l'aller-retour à chaque point. Et onze catégories se partagent une
palette où Fruits, Viandes et Sucré/snacks sont trois rouges/roses voisins.

**Piste.** Légende collée au graphe (en surimpression dans un coin, ou juste au-dessus) ; et distinguer
par la **forme** autant que par la couleur (rond / carré / triangle), ce qui règle aussi le daltonisme.

### U-06 · L'historique n'existe qu'un mois à la fois

**Constaté.** L'onglet annonce « 64 jour(s) enregistré(s) au total » mais n'en montre que 31 : il faut
cliquer `‹` pour remonter. La page fait **865 px** sur un écran de 950 — le tiers inférieur est vide.

**Piste.** Une **heatmap continue façon contributions GitHub** (une case = un jour, 12 mois d'un coup,
couleur = écart à l'objectif). Elle tient dans la place déjà vide, elle donne les régularités qu'un mois
isolé ne montre pas (les week-ends, les vacances, l'arrêt de trois semaines), et le calendrier mensuel
reste en dessous pour le détail.

### U-07 · 🔇 / 🔊 pour « compter ou non ce jour »

Une icône de haut-parleur, dans un journal alimentaire, pour dire « ce jour est mal rempli, ne le compte
pas dans les moyennes ». La métaphore vient du code (`mutedDays`) et n'a pas de sens pour qui lit
l'écran — la légende doit d'ailleurs l'expliquer en toutes lettres.

**Piste.** Le mot compte plus que l'icône ici :
« ne pas compter ce jour ».

### U-08 · 786 px de contenu utile sur 1 440 px d'écran

**Constaté.** `.app` est plafonné à ~786 px : sur un écran d'ordinateur, 654 px sont perdus. C'est le
bon choix pour la saisie et les formulaires. Ça l'est beaucoup moins pour le nuage de points, la carte
ACP, le comparateur et la tendance — précisément les vues qui font l'intérêt du projet, et qui se
battent aujourd'hui pour de la place (cf. B-11).

**Piste.** Une largeur par onglet plutôt qu'une largeur globale : 786 px partout, ~1 200 px sur
Stats / Banque / Nutriments. **Alternative** : un bouton « élargir » sur les panneaux graphiques.
ATTENTION telephone


### U-12 · Un panneau vide de 120 px pour dire « choisissez deux aliments »

Dans « Comparer », tant que rien n'est sélectionné, un panneau pleine largeur affiche une phrase
centrée. La place serait mieux employée par deux ou trois **comparaisons suggérées** tirées des aliments
réellement mangés (« Saumon vs Cabillaud », « Tofu vs Steak haché ») : ça montre à quoi sert l'écran,
ce qu'une phrase ne fait pas.

---

## 3. Perspectives

Rien ici n'est un défaut : ce sont des angles différents, à garder ou à jeter.

### P-01 · Renverser l'écran d'accueil : « ce qui cloche » au lieu de « tout »

L'app sait déjà, aujourd'hui, quels nutriments sont en carence, lesquels sont en excès, et quels aliments
les corrigeraient (`recommend.ts`, `guide.ts`). Ce savoir est rangé dans deux onglets qu'il faut aller
ouvrir. L'écran d'accueil, lui, affiche 38 cartes neutres.

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

Le nuage, l'ACP et la tendance sont serrés dans 786 px (U-08) et bardés de contrôles au-dessus. Un
bouton « ⤢ » qui ouvre le graphe seul, sur toute la fenêtre, contrôles en surimpression, résoudrait
B-11 et U-04 d'un coup — et donnerait une image exportable pour le README.

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


- [ ] CLique sur un jours dans le graph dans stats mettre un petit emnu voulez vous voir ce jour dans histoirique (ou texte similaire) et tu peux confirmer ca t'envoie dans histoirique sur ce jour
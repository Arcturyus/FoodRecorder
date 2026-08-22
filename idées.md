# À FAIRE


- [x] Le système de mathcing c'est trop chiant ca marche rarement (il faut vraimetn que si y a un doute l'ia refait un nouveau élément c'est pas normal qu'escalope de poulet il me sorte cuise de poulet limite faut supprimer le matching tout court si c'est pas parfait)
  → Réglé par le commit `edea66b`. « filet », « cuisse » et « aile » ne sont plus des mots de
  décor autour de « poulet » mais trois aliments distincts (165 / 215 / 290 kcal) : un mot de la
  requête absent de la cible fait chuter le score (`nutrition/match.ts`). En dessous de
  `STRONG_DB_MATCH` (0,9, cf. `nutrition/compute.ts`), c'est l'estimation de l'IA qui prime et non
  la base — donc « en cas de doute, un nouvel élément », comme demandé. Le fuzzy plein texte
  survit au durcissement, pour ne pas payer un appel IA sur une simple coquille (« cuise »).
  Testé cas par cas dans `tests/match.test.ts`, « escalope de poulet » compris.

- [ ] Reconnexions trop fréquentes sur téléphone (redemande le mot de passe). Cause probable : le compte Supabase Auth est **partagé entre appareils** (un seul mot de passe par profil, cf. modèle d'auth), et Supabase fait tourner le refresh token à chaque rafraîchissement — si l'ordi rafraîchit pendant que le téléphone détient encore l'ancien jeton, le téléphone se fait rejeter. À iOS Safari s'ajoute la purge du localStorage après ~7 jours sans ouvrir le site. Trois pistes, à combiner :
  - Dashboard Supabase (Authentication → Sessions) : vérifier/augmenter la durée de session et le « refresh token reuse interval » (fenêtre de tolérance après rotation).
  - Utiliser l'app en PWA installée sur téléphone (« ajouter à l'écran d'accueil ») plutôt qu'un onglet Safari classique — stockage moins sujet à purge.
  - Demander `navigator.storage.persist()` au démarrage de l'app pour réduire le risque d'éviction du localStorage.

- [ ] On avait parlé d'un endroit ou tu parles avec un LLM mais il peut prendre des données de l'app se baladait sur l'app et recup tes données pour repondre et chat avec toi : idéee complexe mais ca serait bien 
(peut être se lance via un bouton chat présent partout en bas à droite par exemple jsp à voir l'ux)

- [ ] Estimation des metabolisme par rapport à la quantité de kcal mangés et la perte de poids ou gain  associés sur une période donnée reglable,
et possibliité d'automatiquement faire les changements pour mettre les nouveaux objectifs

  **Vérifié le 22/08/2026 : PAS fait.** Le commit `5915636` a bâti le calcul **prédictif**
  (du corps vers la dépense : BMR + NEAT + sport + TEF → TDEE, cf. `nutrition/energy.ts`), qui est
  l'inverse de cette idée. Rien ne remonte des données réelles vers le métabolisme observé.

  Les deux briques existent déjà dans `ui/WeightChart.tsx` mais ne sont **jamais croisées
  numériquement** : les kcal/jour y sont superposées à la courbe de poids (visuel seulement), et
  une pente de poids y est calculée (pour l'ETA d'objectif, pas pour en déduire une dépense). Le
  bouton « appliquer les nouveaux objectifs » n'existe pas. À noter : `nutrition/guide.ts:73`
  conseille déjà à l'utilisateur de « corriger ce chiffre avec la balance sur 3-4 semaines » —
  sans lui donner l'outil pour le faire.

  **Question de conception déjà tranchée** (reste à implémenter) : les jours sans saisie ne
  doivent pas être comptés comme des jours à 0 kcal (un seul suffit à fausser la moyenne). On ne
  calcule que sur les jours réellement saisis, et on **refuse d'afficher un résultat sous ~80 %
  de couverture** sur la période, en disant combien de jours manquent.

  **Restent à décider :** ce que fait le bouton « appliquer » (un correctif personnel daté et
  annulable ajouté à la dépense calculée ? une recalibration des postes ? l'écrasement direct de
  la cible ?) et où loger l'écran (panneau « Dépense énergétique », où les deux chiffres se
  confrontent, ou onglet Poids, où vivent les données).

- [x] Quand tu as qu'un graph affiché dans stats mais aussi les quantités pas que l'echelle du % par rapport à l'objectif. (et fais en sorte que de base sur la page on voit que calories par et prot et kcal)

  **Fait** (`ui/Stats.tsx`). À **une seule série**, un second axe apparaît à droite en unité
  réelle (g / mg / kcal, ou « :1 » pour un rapport), unité rappelée en haut. La ligne cible
  annonce en plus la valeur visée (« cible 100 % · 2 310 kcal »), les graduations de d3 ne
  tombant pas forcément dessus. Au-delà d'une série l'axe droit disparaît et la marge se
  referme : à plusieurs unités, aucune graduation en quantité n'est commune — c'est justement
  la raison d'être de l'axe en %.

  Aucun recalcul de données : la cible étant fixe par série, l'axe droit est le même quadrillage
  converti (`valeur = pct × objectif / 100`), donc les deux lectures ne peuvent pas diverger.

  **Défaut de la page : `['kcal']`**, les calories seules — et non plus calories + protéines.
  Une seule courbe au démarrage, c'est aussi l'axe des quantités visible d'emblée.

  Vérifié au navigateur (Chrome piloté) : chip « Calories » seul actif au chargement, axe droit
  gradué 0 / 1 155 / 2 310 / 3 465 pour une cible à 2 310, aucun débordement du viewBox (fin
  652,9 sur 680) ni chevauchement avec le label de cible, et disparition propre de l'axe après
  ajout des protéines.

- [x] Seitan / Tofu léger / Flocons d'avoine  quantité : verifie qu'il sont dans la bdd de base car c'est les element haut en prot vegetales souvent cités
et possibilités de les voir dans les graphiques en cochant "ajouté des aliments jamais mangés mais présents dans la bdd" notamment sur les pareto

  **Fait.** Les flocons d'avoine y étaient déjà ; **tofu ferme, tofu soyeux, seitan et tempeh**
  ont été ajoutés au catalogue (`nutrition/foods.ts`). Ils sont classés en `feculent` avec les
  légumineuses — l'app n'a pas de catégorie « protéines végétales », et en créer une toucherait
  les 4 prompts d'extraction ; le tofu y détonne (2 g de glucides), à rouvrir si ça gêne les
  stats par catégorie. « Tofu léger » est un alias du **soyeux** (55 kcal) et non du ferme (144) :
  les confondre triplerait les calories d'une portion, c'est testé.

  **La case à cocher existe** (`ui/Foods.tsx`) : « Ajouter les aliments du catalogue jamais
  mangés », dans Classement / Explorer visuel / Comparer. Trois décisions :
  - Pas dans la « Liste » : c'est l'écran d'édition de SES aliments, y mêler du catalogue non
    consommé inviterait à modifier des fiches sans rapport avec son historique.
  - Le curseur « mangé au moins N jours » ne s'applique qu'à la banque : un aliment de catalogue
    est à 0 jour par construction, le filtrer le ferait disparaître dès le premier cran.
  - Les non-mangés sont **traçables à l'œil** : points en pointillés et remplissage pâle sur le
    nuage/Pareto, badge « jamais mangé » dans le classement et le comparateur, entrée de légende
    dédiée. Sans ça, une frontière de Pareto ne dirait plus si elle est faite de ce qu'on mange
    ou de ce qu'on pourrait manger. Ils ne comptent toujours dans aucune statistique.

- [x] 
1 681	Mifflin-St Jeor
Référence sans composition corporelle : l'équation recommandée par l'Academy of Nutrition and Dietetics.
1 706	Harris-Benedict révisée (Roza & Shizgal, 1984)
Correction de la formule de 1919. Bonne, mais surestime encore ~5 % en moyenne.
1 677	Cunningham (masse maigre)retenue
La plus juste chez les personnes entraînées — à condition que le % de masse grasse le soit aussi.
1 525	Katch-McArdle (masse maigre)
Même logique que Cunningham, résultat systématiquement ~130 kcal plus bas.
vu qu'on parle des 4 autant pouvoir choisir celle des 4 qu'on prend même si de base c'est Cunningham si masse maigre connu

  **Fait.** Les quatre formules étaient déjà calculées et affichées dans le tableau comparatif,
  mais le sélecteur n'en proposait que trois entrées dont deux équivalentes (`auto` retombait sur
  Cunningham dès que la masse maigre était connue) — soit **2 résultats distincts** seulement.
  `BmrFormula` s'ouvre aux quatre clés et la sélection passe par `resolveBmrKey`
  (`nutrition/energy.ts`) ; le sélecteur d'`ui/EnergyPanel.tsx` les liste toutes.

  - **`auto` reste le défaut** et garde son sens : Cunningham si masse maigre connue, Mifflin sinon.
  - Les deux formules à masse maigre restent **listées mais désactivées** quand la masse grasse
    est inconnue, avec la mention « masse grasse requise » : les masquer ferait croire qu'elles
    n'existent pas, juste après un tableau qui explique qu'elles sont les plus justes.
  - **Repli explicite** si la masse grasse disparaît après coup (pesée supprimée, profil vidé) :
    les cibles basculent sur Mifflin, un avertissement le dit, et le choix enregistré est conservé
    pour le jour où la mesure revient — plutôt qu'un panneau en erreur ou un choix effacé en silence.
  - `ffm`, l'ancien nom de Cunningham, est traduit à la lecture : les profils déjà enregistrés et
    la synchro entre appareils ne changent pas de comportement.
  - 11 tests ajoutés dans `tests/energy.test.ts` (dont : les quatre donnent bien quatre valeurs
    distinctes, et Katch tombe ~130 kcal sous Cunningham).

- [x] Rendre visible le traitement de la file : un texte dans l'onglet Jour disant ce que la CLI est en train de mâcher (nombre de photos/dictées en cours, nombre déjà traitées), qui repart de zéro quand on quitte « Aujourd'hui » et qu'on y revient.
  → `sync/queueStatus.ts` (état publié par le poller) + `ui/QueueStatus.tsx` (bandeau en tête de `DayView`).

  **Décidé :**
  - Visible **sur l'ordi ET sur le téléphone**. L'ordi (qui a le pont) affiche « en cours : photo 2/3 » ; le téléphone, qui ne peut pas savoir si l'ordi mouline ou est éteint, affiche seulement « 2 photos en attente de traitement par l'ordinateur ».
  - « validé » = **traité par la CLI** (`processed: true`, entrée écrite dans le journal). Pas de relecture manuelle à confirmer — ce serait un champ de plus sur les entrées et une UI dédiée.
  - Les **échecs sont comptés à part**, avec leur motif : `poller.ts` connaît déjà l'erreur (cf. `payload.error`) mais la jette dans des `catch` muets.
  - Mise en œuvre : store éphémère (non persisté, hors backup JSON), les 4 `fetchPending*` regroupés en tête de tick pour connaître le total d'emblée, un `countPending()` pour les appareils sans pont, et le tick accéléré à ~8 s tant que la file n'est pas vide (30 s sinon, sans quoi le bandeau du téléphone a une demi-minute de retard).

- [x] Ajoute dans le prompt le fait de reduire les quantité automatiquement pour certains nourriture ou l'on mange pas tout (exmeple cuisse de poulet faut compter que le user a donné le poids total mais faut enlever les os)
  → `PARTIE_COMESTIBLE_PROMPT` (`extraction/schema.ts`), injecté dans les 4 prompts des IA fortes (texte + photo, API Claude et pont Claude Code) + une ligne condensée pour l'IA locale. On ne retire que l'immangeable (os, arêtes, coquilles, noyaux…), jamais ce qui se mange couramment (peau du poulet, du saumon, des fruits) ; quand c'est discutable (peau), l'IA émet deux items séparés chair / peau pour que l'utilisateur supprime celui qu'il n'a pas mangé. La quantité nette passe en `estimation: true` avec fourchette, même si le poids brut était précis.

- [x] Purge les photos de supabase une fois qu'elles ont bien été traités (gagne des données ?)

- [x] On supprime la banque d'aliments en brut. À la place : un aliment entre dans la banque quand il **revient** (1 ou 2 fois, à décider), ou en tout cas tout est décrit par le LLM. La banque ne sert plus qu'aux stats — et du coup ça peut être cool d'y ajouter de nouveaux éléments.

- [x] dans "Ajout manuel rapide" rechercher dans la base + les aliments déjà mangés (+ préciser la dernière fois qu'on les a mangés lorsque l'on ajoute par ex)

**Ce qui a été décidé et fait** (cf. `nutrition/bank.ts`) :
- Le **matching** garde une fixture : les 148 restent en *catalogue de référence*, hors stats, à piocher. Le mode « règles » hors ligne continue donc de fonctionner, et ajouter « une pomme » ne coûte aucun appel LLM.
- Le **coût LLM n'augmente pas** : le pipeline en 2 passes existait déjà (`matchFood` local gratuit, puis `verifyMatches` uniquement sur les douteux, en un seul appel groupé). Seul le traitement du verdict a changé.
- **Entrée dès la 1re occurrence**, avec badge « à vérifier ». Le filtre des stats se fait après coup, au curseur « mangé au moins N jours » (jours distincts).
- **Estimations divergentes** : les valeurs sont **figées à la première fois**, éditables, et toute correction est rétroactive sur l'historique. Sinon le même plat vaudrait deux valeurs et les courbes ne voudraient plus rien dire.
- **Explorer / Comparer / ACP** : état vide explicite tant que la banque l'est ; la migration la remplit d'emblée avec tout l'historique.
- **Migration** : les aliments du catalogue réellement mangés sont copiés **en gardant leur id** (aucune référence cassée), les overrides sont absorbés, les estimations IA jusque-là enfermées dans les items deviennent de vrais aliments. Les 148 jamais mangés ne sont pas repris.

- [x] Entretien de la banque par IA : reclassement groupé des catégories (un appel pour des dizaines d'aliments), et relecture d'une fiche sous forme de **discussion** — on peut objecter (« les miennes sont à l'huile ») et l'IA révise ou maintient son avis. Le prompt inclut la consommation réelle (fréquence, portion moyenne). Seul appel multi-tours de l'app ; le pont Claude Code reçoit l'historique aplati en texte.

- [ ] Fusion de doublons : la détection est par similarité de nom (`findDuplicates`). Voir à l'usage s'il faut aussi rapprocher par proximité nutritionnelle.
- [ ] Relecture IA en masse (tous les « à vérifier » d'un coup) : écartée pour l'instant — une fiche complète fait 39 valeurs, donc un appel long par aliment. À reconsidérer si la relecture une par une devient fastidieuse.

## 4. Inspiration

- [ ] Analyse de l'app Cronometer, pour y prendre de bonnes idées ou des choses à ne pas faire.
ou autre concurrent : Yazio...

**À éclaircir :** ce qu'on en attend concrètement — une note comparative écrite (fonctionnalité par fonctionnalité) ? un focus sur un aspect précis (saisie, graphes, base de données) ?

---
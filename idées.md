# À FAIRE


- [ ] Le système de mathcing c'est trop chiant ca marche rarement (il faut vraimetn que si y a un doute l'ia refait un nouveau élément c'est pas normal qu'escalope de poulet il me sorte cuise de poulet limite faut supprimer le matching tout court si c'est pas parfait)

- [ ] Reconnexions trop fréquentes sur téléphone (redemande le mot de passe). Cause probable : le compte Supabase Auth est **partagé entre appareils** (un seul mot de passe par profil, cf. modèle d'auth), et Supabase fait tourner le refresh token à chaque rafraîchissement — si l'ordi rafraîchit pendant que le téléphone détient encore l'ancien jeton, le téléphone se fait rejeter. À iOS Safari s'ajoute la purge du localStorage après ~7 jours sans ouvrir le site. Trois pistes, à combiner :
  - Dashboard Supabase (Authentication → Sessions) : vérifier/augmenter la durée de session et le « refresh token reuse interval » (fenêtre de tolérance après rotation).
  - Utiliser l'app en PWA installée sur téléphone (« ajouter à l'écran d'accueil ») plutôt qu'un onglet Safari classique — stockage moins sujet à purge.
  - Demander `navigator.storage.persist()` au démarrage de l'app pour réduire le risque d'éviction du localStorage.

- [ ] On avait parlé d'un endroit ou tu parles avec un LLM mais il peut prendre des données de l'app se baladait sur l'app et recup tes données pour repondre et chat avec toi : idéee complexe mais ca serait bien 
(peut être se lance via un bouton chat présent partout en bas à droite par exemple jsp à voir l'ux)

- [ ] Estimation des metabolisme par rapport à la quantité de kcal mangés et la perte de poids ou gain  associés sur une période donnée reglable,
et possibliité d'automatiquement faire les changements pour mettre les nouveaux objectifs

- [ ] Quand tu as qu'un graph affiché dans stats mais aussi les quantités pas que l'echelle du % par rapport à l'objectif. (et fais en sorte que de base sur la page on voit que calories par et prot et kcal)

- Seitan / Tofu léger / Flocons d'avoine  quantité : verifie qu'il sont dans la bdd de base car c'est les element haut en prot vegetales souvent cités
et possibilités de les voir dans les graphiques en cochant "ajouté des aliments jamais mangés mais présents dans la bdd" notamment sur les pareto

- [ ] 
1 681	Mifflin-St Jeor
Référence sans composition corporelle : l'équation recommandée par l'Academy of Nutrition and Dietetics.
1 706	Harris-Benedict révisée (Roza & Shizgal, 1984)
Correction de la formule de 1919. Bonne, mais surestime encore ~5 % en moyenne.
1 677	Cunningham (masse maigre)retenue
La plus juste chez les personnes entraînées — à condition que le % de masse grasse le soit aussi.
1 525	Katch-McArdle (masse maigre)
Même logique que Cunningham, résultat systématiquement ~130 kcal plus bas.
vu qu'on parle des 4 autant pouvoir choisir celle des 4 qu'on prend même si de base c'est Cunningham si masse maigre connu

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
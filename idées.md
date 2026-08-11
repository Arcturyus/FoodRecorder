# À FAIRE


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

**À éclaircir :** ce qu'on en attend concrètement — une note comparative écrite (fonctionnalité par fonctionnalité) ? un focus sur un aspect précis (saisie, graphes, base de données) ?

---
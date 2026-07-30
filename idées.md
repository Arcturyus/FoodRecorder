# À FAIRE

## 1. Base de données : fer & graisses saturées détaillées

- [ ] Fer : si homme, besoin de base à 8 mg (on gérera le cas femme + règles une autre fois — le besoin change selon la période du cycle).
- [ ] Séparer les acides gras saturés, qui ne se comportent pas tous pareil (longueur de chaîne carbonée) :
  - **Acide stéarique (C18:0) — « le neutre »** : chocolat noir (beurre de cacao), une partie de la viande. Le foie le convertit vite en acide oléique (mono-insaturé, comme l'huile d'olive) : il ne fait pas monter le LDL.
  - **Acide palmitique (C16:0) et myristique (C14:0) — « à limiter »** : beurre, crème, fromage, huile de palme, viande grasse. En excès : LDL en hausse, plaques artérielles à long terme.

**À éclaircir avant de coder :**
- Quelle source pour la répartition C18:0 / C16:0 / C14:0 des ~150 aliments de la banque ? (Ciqual la donne pour une partie seulement — faut-il estimer le reste par catégorie, ou ne remplir que les aliments à fort impact : beurre, fromages, viandes, huile de palme, chocolat ?)
- Faut-il une cible chiffrée pour le stéarique, ou juste le **sortir du plafond** des AG saturés (le plafond ne portant plus que sur C16:0 + C14:0) ? Un excès de C18:0 reste probablement non souhaitable — quel seuil ?
- Affichage : 3 nouvelles lignes de nutriments, ou une ligne « AG saturés » dépliable en sous-détail (comme les oméga 3 ALA/EPA/DHA) ?
- Le fer à 8 mg change les cibles existantes : on garde l'AJR à 8 et l'optimal plus haut, ou les deux à 8 ?

## 2. Banque d'aliments : ne plus la maintenir en brut

- [ ] On supprime la banque d'aliments en brut. À la place : un aliment entre dans la banque quand il **revient** (1 ou 2 fois, à décider), ou en tout cas tout est décrit par le LLM. La banque ne sert plus qu'aux stats — et du coup ça peut être cool d'y ajouter de nouveaux éléments.

**À éclaircir avant de coder (brainstorm demandé) :**
- Que devient le **matching** (`match.ts`) si la banque est vide au départ : tout passe par le LLM à chaque repas, y compris hors ligne ? Que fait-on quand le LLM n'est pas joignable (téléphone sans pont) ?
- Seuil d'entrée dans la banque : 1re ou 2e occurrence ? Et si les deux descriptions LLM divergent (valeurs différentes pour le même aliment), laquelle gagne — la dernière, la moyenne, la plus « confiante » ?
- Que deviennent les modes qui vivent de la banque (Explorer / Comparer / ACP) pendant la période où elle est presque vide ?
- Migration : que fait-on des 148 aliments actuels et des entrées de journal qui les référencent ?
- Coût : un appel LLM par aliment jamais vu, ça se compte comment sur un mois ?

## 3. Diagnostic : photo/texte qui n'arrivent pas via le pont Claude Code

- [ ] Parfois le système en pont Claude Code sur téléphone prend bien une photo mais je reçois une erreur — la photo ne passe peut-être pas sur Supabase ? Que voir ? Faisons un diagnostic (le texte aussi). Est-ce que Supabase peut bloquer ? Message de confirmation que c'est bien en attente sur Supabase.

**À éclaircir avant de coder :**
- Le message d'erreur exact reçu sur le téléphone (le code affiche déjà poids · dimensions · poids d'origine, et distingue « échec d'analyse » de « échec d'envoi ») — lequel des deux apparaît ?
- Piste n°1 à écarter : limite de taille d'une ligne Supabase (le base64 d'une photo réduite ~1024 px fait ~150-300 Ko) et politiques RLS de `sync_queue`.
- Faut-il un écran « file d'attente » (lignes en attente, envoyées, traitées) plutôt que des messages fugaces ? Ce serait aussi la réponse au « message de confirmation ».

## 4. Poids : analyse de l'évolution

- [ ] Moyenne mobile réglable comme dans Stats, appliquée aussi aux kcal mangées superposées. Quand la moyenne mobile est active : n'afficher **que** les moyennes mobiles, pour ne pas surcharger le graphe.

**À éclaircir avant de coder :**
- L'agrégat Jour / Semaine / Mois vient d'être ajouté à Stats et à Ma consommation : on le met aussi sur la courbe de poids (auquel cas moyenne mobile *et* agrégat cohabitent, comme dans Stats), ou la moyenne mobile suffit ici ?
- Les kcal superposées : moyenne des jours enregistrés uniquement, ou 0 pour les jours vides ?

## 5. Inspiration

- [ ] Analyse de l'app Cronometer, pour y prendre de bonnes idées ou des choses à ne pas faire.

**À éclaircir :** ce qu'on en attend concrètement — une note comparative écrite (fonctionnalité par fonctionnalité) ? un focus sur un aspect précis (saisie, graphes, base de données) ?

---

# VALIDÉ / FAIT

- [x] **Conseils du jour — proposer d'autres aliments** : bouton « ⟳ Autres n/4 » sur chaque rangée de suggestions (macros et micronutriments). 4 pages sont préparées d'avance, sans doublon, et la garantie « au moins un aliment déjà mangé » porte sur la page visible.
- [x] **Ma consommation — d'où vient ce nutriment ?** : mode « Par nutriment » (sélecteur + classement des aliments contributeurs, part en %, quantité, détail jour par jour).
- [x] **Agrégat par semaine / mois** : sélecteur Jour / Semaine / Mois sur la « Tendance comparée » de Stats (moyennes PAR JOUR du groupe, donc comparables à la cible journalière ; la fenêtre de moyenne mobile suit l'unité) et sur les graphes de détail de Ma consommation.
- [x] **Poids : dictée adaptée au téléphone + synchro** : bloc « Dicter une pesée » repris sur le modèle d'« Aujourd'hui » (zone de saisie pleine largeur, boutons tactiles 46 px) ; si le pont Claude Code n'est pas joignable, la dictée part en **file d'attente Supabase** (kind `weight`, avec retry/backoff) et l'ordinateur l'analyse, enregistre la pesée et la republie (`weight-entry`) pour les autres appareils — avec message de confirmation « envoyée sur Supabase (en attente) ».
- [x] Les conseils du jour faisaient surtout micro : deux sections désormais, une pour combler les macros avec les calories restantes (priorité kcal et protéines), une comme avant.
- [x] Ajouter des notes libres sur un jour (Aujourd'hui + calendrier de l'historique).
- [x] Sous-estimation DHA/EPA ou surestimation du besoin : 2 portions de 100 g de poisson gras par semaine ≈ 3-4 g/semaine ≈ 450-570 mg/jour — la recommandation est couverte, pas besoin de saumon quotidien.
- [x] Bug de dictée sur Chrome Android : répétition du texte (« 250g 25025050 de skyr ski »).
- [x] Système pour ne pas compter certains jours dans les moyennes (mute sur le calendrier). Les jours vides sont mutés automatiquement ; si c'était un jeûne, on peut les démuter.
- [x] La créatine est optionnelle (3 g pas nécessaires, obtenables surtout par complément) → a donné les **poids d'importance** par nutriment/groupe : on recommande ce qui manque, pondéré par la gravité du manque (manquer d'oméga 3 est plus grave que de créatine).
- [x] Ordre des menus : Poids et Guide au fond.
- [~] **Comparaison d'aliments avec l'explorateur visuel** (rework des substituts/compléments, ACP plus visuelle) :
  - [x] Écarts : sens inversé (A à gauche / B à droite) + en-têtes de côté
  - [x] Nutriments choisis indépendamment par graphe (sélecteur replié + retrait au clic sur le libellé)
  - [x] ACP interactive : zoom/pan/pincement + boutons +/−/reset + surlignage par recherche
  - [x] Écarts : quantité brute + % AJR au bout de la barre (du côté du plus riche) — un ×50 sur une trace reste une trace
  - [x] Substituts = similarité cosinus en % (profil/forme, indép. concentration) ; compléments = cosinus manque↔richesse en % (spécifique, plus « toujours épinards »)
  - [x] Échelle robuste p95 (au lieu du max) pour substituts/compléments — moins sensible aux outliers
  - [x] Détail du score au clic (ⓘ) : nutriments qui portent la similarité / comblent les manques
  - [x] Substituts + ACP : tous les nutriments par défaut
  - [x] ACP : clic sur un point → menu « mettre en A / mettre en B » (zone de tap élargie pour mobile ; capture pointeur retirée pour que le clic passe)
  - [x] Interprétation ACP « sans erreur » : avertissement variance faible + estompage par qualité (cos² en ACP, fidélité des distances en MDS) + valeur au survol. Reste éventuel : explications au survol des flèches.
  - [x] Notebook de révision ACP externe (`analysis/pca_course.ipynb`) : reproduit la carte (PC1 23 % + PC2 17 %, = app), loadings PC1-4, scree, biplot, cos², réponse « aliments au centre sauf épinards » + section t-SNE/MDS
  - [x] Carte : sélecteur de projection ACP / t-SNE / MDS (embed.ts en TS pur ; flèches+variance limitées à l'ACP) + dézoom débloqué (ZOOM_MIN 0.2)

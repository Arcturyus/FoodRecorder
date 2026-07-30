


- [x] Les conseils du jour font surout micro là, ca serait bien deux sections : une avec des aliments pour combler tes macros avec tes calories restantes avec prio kcal et prot, et une comme là


- [ ] micro changement bdd : fer si H mettre un besoin à 8mg de base (on gerera femme avec regles uen autre fois car je crois selon t'es dans tes regles ou non c'est plus), 
 Les graisses saturées ne se comportent pas toutes de la même manière dans le corps. La différence se fait au niveau de la longueur de leur chaîne de carbone. les indiqués en plus en détails si possibles séparer bons et mauvais saturé (sachant qu'il y a quand même des limites pour les deux je suppose trop de C18:0 doit quand même pas être le mieux)

    L'acide stéarique (C18:0) - "Le Neutre" : C'est celui du chocolat noir (beurre de cacao) et d'une petite partie de la viande. Pourquoi est-il différent ? Parce que ton foie le convertit très rapidement en acide oléique (une graisse mono-insaturée, la même que dans l'huile d'olive !). Résultat : il ne fait pas monter le mauvais cholestérol (LDL).

    L'acide palmitique (C16:0) et myristique (C14:0) - "Ceux à limiter" : On les trouve surtout dans le beurre, la crème, le fromage, l'huile de palme et la viande grasse. Ce sont eux qui, consommés en excès, s'accumulent, font grimper le LDL et favorisent les plaques dans les artères à long terme.

- [ ] dans la sections recommandation sdu jour mettre une autre aliments si les 5 proposés dans la section ne le sont pas il en repropose d'autres 
- [ ] dans ma consommation, ajoute un graph ou on selectionne un nutriment et il montre les aliments qui contribuent les plus parmi notre consommation à ce nutriment et à quel point 

- [ ] Toutes les dates (notamment stats) pouvoir mettre un agregat par semaines, mois 


- [ ] on supprime la banque d'aliments en brut, mais plutôt on ajoute dans la banque un aliment qui revient (1 ou 2 fois jsp encore), ou en tout cas tout est decrit par le LLM, la banque sert que au stats (et donc ca peut etre cool de rajoouter de nouveaux éléments)
(a brainstorm)


- [ ] ERREUR : parfois le système en pont claude code sur tel prend bien une photo mais je recois une erreur la photo ne passe peut être pas sur supabase ? que voir ? faisons un diagnostic, et d'aillerus texte aussi là
est ce que supabse peut bloquer ? message de confirmation que c'est bien sur supabase en attente

- [ ] Pour le poids suis les changements dans aujourd'hui, le dictée n'est pas adaptée au telephone (trop petite zone de texte) + ce n'est pas synchronisée par supabase, plus mise en attente supabase non fonctionnel

- pour l'analyse poids evolution : mettre moyenne mobile regable comme dans stats et surtout cette moyenne mobile s'applique aussi aux kcal mangés superposés (et dans ce cas ou moyenne mobile oui : tu affiches que les moyennes mobiles pour pas surchargés le graph)

- analyse de l'app Cronometer pour y prendre de bonnes inspi ou choses à pas faire

- [x] sous etimation DHA EPA ou alors surestimation du besoin non ?
"Donc 2 portions de 100 g de poisson gras par semaine ≈ 3–4 g/semaine ≈ 450–570 mg/jour en moyenne. La recommandation est couverte. Pas besoin de saumon quotidien."
- ajouter la possibilité de rajouter des notes quelquonque sur un jour (aujourd'hui + calendrier") j'aimerais par ex mettre pour le 24/07/2026 mettre " J'ai eu un coup de soleil torse et dos"

- [x] bug sur mon tel de vocal sur chrome il repte plein de fois ce que je dis (exemple : "250g 25025050 de skyr ski")

- [x] Un système pour ne pas compter certains jour dans les moyennes, une sorte de mute sur le calendrier on peut mute entièrement des jours (par exemple parce qu'on sait qu'on a mal rempli).
Les jours vident sont automatiquement mute sur le calendrier (il indiquent probablement un non remplissage ce jour là, et si c'est en fait un jeûne tu peux demute)

- [x] La créatine est optionel : pas nécessaire d'avoir 3g en vérité et obtenable que par complément donc trop de conseil
--> Tout ceci me donne pour idée d'ajouter des poids d'importance de chaque élements, ou de groupes d'élements pour que ce soit plus simple. Notamment pour les recommandations : il faut recommander comme là ce qui est peu obtenue par le user, mais aussi plus certains (si t'es en manque d'omega 3 plus grave qu'en manque de créatine)


- [x] Ordre des menus : mettre poids et guide au fond
- [~] Comparaison d'aliments avec l'explorer visuel : rework comment faire les subsitutus, les compléments ? actuellement comment est le score. ACP beaucoup plus visuelle : zoom possibles, ... ensuite ecart nutriments inverser le sens car là c'est pas clair (les barres partent cote de l'autre aliments), radar et même ecart plus pouvoir choisir des nutriments à enlever rajouter tout en restant UI non surchargé
Interprétation ACP revoir comment bien l'interpréter sans erreur...
  - [x] Écarts : sens inversé (A à gauche / B à droite) + en-têtes de côté
  - [x] Nutriments choisis indépendamment par graphe (sélecteur replié + retrait au clic sur le libellé)
  - [x] ACP interactive : zoom/pan/pincement + boutons +/−/reset + surlignage par recherche
  - [x] Écarts : quantité brute + % AJR au bout de la barre (du côté du plus riche) — un ×50 sur une trace reste une trace
  - [x] Substituts = similarité cosinus en % (profil/forme, indep. concentration) ; compléments = cosinus manque↔richesse en % (spécifique, plus « toujours épinards »)
  - [x] Échelle robuste p95 (au lieu du max) pour substituts/compléments — moins sensible aux outliers
  - [x] Détail du score au clic (ⓘ) : nutriments qui portent la similarité / comblent les manques
  - [x] Substituts + ACP : tous les nutriments par défaut
  - [x] ACP : clic sur un point → menu « mettre en A / mettre en B » (zone de tap élargie pour mobile ; capture pointeur retirée pour que le clic passe)
  - [x] Interprétation ACP « sans erreur » : avertissement variance faible + estompage par qualité (cos² en ACP, fidélité des distances en MDS) + valeur au survol. Reste éventuel : explications au survol des flèches.
  - [x] Notebook de révision ACP externe (`analysis/pca_course.ipynb`) : reproduit la carte (PC1 23 % + PC2 17 %, = app), loadings PC1-4, scree, biplot, cos², réponse « aliments au centre sauf épinards » + section t-SNE/MDS
  - [x] Carte : sélecteur de projection ACP / t-SNE / MDS (embed.ts en TS pur ; flèches+variance limitées à l'ACP) + dézoom débloqué (ZOOM_MIN 0.2)
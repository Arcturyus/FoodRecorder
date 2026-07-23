
- [ ] ERREUR : parfois le système en pont claude code sur tel prend bien une photo mais je recois une erreur la photo ne passe peut être pas sur supabase ? que voir ? faisons un diagnostic, et d'aillerus texte aussi là
est ce que supabse peut bloquer ? message de confirmation que c'est bien sur supabase en attente
- [ ] sous etimation DHA EPA ou alors surestimation du besoin non ?
"Donc 2 portions de 100 g de poisson gras par semaine ≈ 3–4 g/semaine ≈ 450–570 mg/jour en moyenne. La recommandation est couverte. Pas besoin de saumon quotidien."

- [ ] bug sur mon tel de vocal sur chrome il repte plein de fois ce que je dis (exemple : "250g 25025050 de skyr ski")

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
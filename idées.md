
- [x] Un système dans stats qui te recommande les suppléments les plus utiles, mon idée actuel c'est juste de pouvoir decocher une case avec suppléments, decocher les moyennes, courbes dans stats seraient afficher sans compter les suppélements
- [x] Recherche dans l'historique : « quand ai-je mangé du saumon ? » / fréquence d'un aliment sur la période.
- [x] des stats sur la fréquence d'un aliments, une partie les aliments les plus mangés on voit des graphs dessus
- [x] ajout collagène (et donc relire TOUTES la bdd pour mettre collagène (mais du coup c'est prot dont collagène comme il y a lipides dont AG saturée))
- [x] dictée soleil il doit bien comprendre les cas annexes (exemple tu pars quelque part mais y abeaucoup d'interieur entrecoupe de plein de 5 min de soleil) et pourvoir te mettre plusieurs sorties en une dictée
- [x] Faire en sorte que les IA fortes (API ou pont claude code) estime en priorité (en gros tu peux renvoyer le match mais le LLM juge si c'est exactement pareil, s'il juge que non il estime les quantités pour chaque éléments)
- [x] Système de sauvergarde automatique : enregistre un json à la première connexion de la journée (seulement si npm run dev comme ca dans le dossier foodrecorder/save) dans un dossier ici ou à la limite propose en grand à la première connexion
- [x] Ajouter le soleil à supabase pont claude code comme une bouffe
- [x] faire que le soleil il valide automatiquement comme la nourriture après une dictée puis valider, claude code renvoie automatiquement le bon (au pire on modifie après permettre cette modification)

- [(plus tard) (à braistorm les techno, comment faire, ...)] Plus tard un système de sauvergarde complet : tout passse par supabase et connecte entre différents navigateur: peut être faire des profils de personnes (simple tu is je suis romain et tous les romain sont connéctés à la même bdd, autre utilisateur possible)

- [x] erreur souvent le LLM considères des unités bizarres rajoute dans le prompt de souvent choisir en g (ou mg, micro g selon macro micro nutriment) moins les autres unités

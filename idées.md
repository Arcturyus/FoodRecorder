

- [x] Vinaigre dans la banque + saisie en mg / µg (notamment compléments : « 300 mg de magnésium » = 300 mg élément).
      → Ajout vinaigre (vin/cidre), balsamique, vinaigrette. Nouvelles unités mg et µg (masse littérale). Les
        compléments mono-élément (magnésium, zinc, vitamine C, vitamine D3) sont modélisés en « élément pur » :
        une dose en mg/µg compte 1:1 la quantité élémentaire de l'étiquette. L'ajout manuel pré-remplit la bonne
        unité/dose ; la dictée comprend « 300 mg de magnésium » et « 25 microgrammes de vitamine D ».
- [x] Soleil v2 : remplissage ultra-rapide (chips + slider), phototype, crème solaire, formule détaillée, dictée, ajout dans l'historique.
      → Créneaux horaires en un clic (Matin 8 h → Fin d'après-midi 17 h) + heure précise, durée au slider (5–240 min),
        ciel / peau / phototype (clair par défaut) en chips, crème SPF 50 (posée une fois, moyennement appliquée).
        Formule affichée « Gain = 1,7 × f_durée × f_saison × f_heure × f_ciel × f_peau × f_phéno × f_crème » avec la
        valeur de chaque facteur au survol. Dictée dédiée (« 30 min au soleil ce midi en t-shirt, sans crème ») qui
        pré-remplit le formulaire via les 4 moteurs. Soleil ajoutable sur un jour passé (éditeur de jour, Historique).
- [x] Stats : section « Vitamine D : carence ? » — flux moyen (soleil + alimentation) pondéré récence sur ~4 semaines,
      3 zones (< 8 carence / 8–15 gris / ≥ 15 suffisant), tendance ↑↓→. Ex. « 9 µg/j (↓ en baisse) → apport faible ».
      Le lissage long (demi-vie 21 j) évite les oscillations autour des seuils.
- [x] Soleil : pas un aliment — section à part en bas de l'onglet Aujourd'hui (ciel nuageux/ensoleillé, heure de sortie, durée, peau découverte) → gain de vitamine D estimé (France) ajouté au bilan du jour.
      → Section « ☀️ Soleil (vitamine D) » sous les repas : modèle saisonnier France (quasi nul nov–fév),
        fenêtre horaire UVB (~10 h–17 h), facteurs ciel et peau, rendements décroissants + plafond journalier.
        Le gain apparaît dans la tuile Vitamine D du bilan (et dans « Principaux apports » comme ☀️ Soleil).
- [x] Rework graphes Poids : courbes des valeurs calculées (IMC, masse musculaire squelettique, métabolismes HB/MSJ × activité).
      → Onglet Poids : chips Poids / Masse grasse / Eau / Masse musculaire / IMC / Métabolismes / Autres.
        Masse musculaire en kg par défaut (% × poids, avec la part squelettique × 0,9 en pointillés),
        bascule binaire kg ↔ %. Métabolismes : HB + MSJ + balance sur le même graphe (cases à cocher)
        avec bascule Basal ↔ × multiplicateur d'activité (1,55). « Autres » regroupe les métriques
        secondaires : masse osseuse (axe gauche) + graisse viscérale (axe droit) — extensible.
- [x] lorsque gros modèle hesite il pourrait choisir mixte entre 2 (par exemple choix fromage blancc 0% ou 3% ou skyr et ca met automatiquement le plus mangé les derniers jours)
      → Quand plusieurs aliments ont des scores de matching très proches (écart ≤ 0,12), l'app choisit celui
        le plus mangé sur les 14 derniers jours (fréquence dans le journal). Le prompt de l'API Claude demande
        aussi au modèle de rester générique (« fromage blanc ») quand la phrase ne tranche pas, pour laisser
        l'habitude décider. L'aliment écarté reste proposé en alternative dans l'édition.
- [x] AJoute la possibilité d'envoyer une photo de ton repas à coté de dicté, pour que le modèle LLM estime les aliments et leur quantité en texte puis renvoie les json associés pour ajouter comme l'audio dicté
      → Existait en mode API Claude (cf. « Version photo » plus bas), mais invisible en mode « Pont Claude
        Code ». Désormais le bouton « 📷 Photo d'un repas » est disponible dans les DEUX modes : via le pont,
        l'image est écrite en fichier temporaire local et le CLI Claude (multimodal) la lit directement —
        même JSON, même ajout au journal + résumé « ✓ Compris » que la dictée. Toujours masqué en règles /
        IA locale (pas de vision).
- [x] Croiser poids et alimentation : superposer sur la courbe de poids la moyenne kcal des jours précédents pour voir l'effet du déficit/surplus.
      → Onglet Poids, courbe « Poids » : case « Superposer kcal mangées » = courbe orange en pointillés
        (moyenne des 7 jours précédents, axe kcal à droite) par-dessus la courbe de poids.
- [x] Moyenne mobile 7 j sur la courbe de poids pour lisser les fluctuations d'eau (le poids brut varie de ±1 kg d'un jour à l'autre).
      → Courbe verte lissée (moyenne glissante sur 7 jours), activée par défaut, désactivable d'une case.
        Disponible sur toutes les métriques (poids, masse grasse…).
- [x] Objectif de poids (ex. 68 kg à 19 % max) affiché en ligne cible sur le graphique, avec estimation de la date d'atteinte au rythme actuel.
      → Champ « Objectif (kg) » au-dessus du graphe : ligne cible rouge en pointillés + estimation de la date
        d'atteinte au rythme actuel (pente de la moyenne mobile sur les 30 derniers jours, affichée en kg/sem).
        Gère les cas « objectif atteint », « pas en voie de l'atteindre » et « à plus de 3 ans ».
- [ (plus tard)] TDEE réel : estimer les calories de maintien à partir de la pente de poids + kcal mangées, et proposer d'ajuster les cibles automatiquement.

- [x] Dicter la date dans une pesée (« hier matin 68 kg ») et pas seulement les mesures. mais attention bien compréhensible et changebale par le user (possible aussi à faire dans historique audio sur un jour deja selectionné)
      → L'extraction comprend « hier », « avant-hier », « il y a N jours », « lundi (dernier) », et l'heure
        (« matin » → 08:00, « midi », « soir », « à 7h30 »), dans les 4 moteurs (le parseur à règles complète
        le LLM s'il oublie la date). Le formulaire est pré-rempli avec la date comprise, affichée en toutes
        lettres dans le statut (« date comprise : jeudi 9 juillet ») et toujours modifiable avant d'enregistrer.
        Garde-fou : jamais de date dans le futur.
- [x] Distinguer sur la courbe les pesées non à jeun / habillées (point creux ou grisé) car moins comparables.
      → Point creux gris (au lieu d'un point plein bleu) pour toute pesée non à jeun ou habillée, légende sous
        le graphe et mention « ⚠ non à jeun / habillé » dans le tooltip.
- [x] Comparer HB vs MSJ vs métabolisme machine sur un même graphe multi-courbes.
      → Nouveau bouton « Métabolismes (HB / MSJ / balance) » dans l'onglet Poids : 3 courbes superposées
        (Harris-Benedict bleu, Mifflin-St Jeor vert, valeur de la balance orange) avec légende et tooltip.
- [x] Export / sauvegarde des données (JSON ou CSV) et ré-import, pour ne pas dépendre du localStorage d'un seul navigateur.
      → Réglages > « Données & sauvegarde » : export JSON complet (journal, pesées, aliments perso, overrides,
        repas favoris, profil, constantes — sans la clé API) ré-importable tel quel (confirmation avant
        remplacement), + exports CSV du journal (une ligne par aliment) et des pesées (séparateur « ; »,
        BOM UTF-8 pour Excel FR).
- [x] Repas favoris / récurrents : enregistrer un repas type (« petit-déj habituel ») et l'ajouter en un clic ou à la voix.
      → Bouton « ☆ Favori » sur chaque entrée du journal (nom au choix). Panneau « Repas favoris » sur l'onglet
        Aujourd'hui : « + Ajouter » en un clic (valeurs recalculées avec la banque à jour). À la voix : dicter
        le nom du favori (« petit-déj habituel ») l'ajoute directement, sans passer par l'extraction.
- [x] Dupliquer un jour ou un repas passé vers aujourd'hui (beaucoup de journées se ressemblent).
      → Bouton « ⧉ Auj. » sur toute entrée d'un jour passé (recopie le repas sur aujourd'hui), et bouton
        « ⧉ Dupliquer ce jour → aujourd'hui » dans Historique > éditeur de jour (recopie tous les repas du jour).
- [(plus tard)] PWA installable sur téléphone (icône, offline) — l'app est déjà 100 % locale, il manque juste le manifest + service worker.
- [(plus tard)] Recherche dans l'historique : « quand ai-je mangé du saumon ? » / fréquence d'un aliment sur la période.








- [x] faire dans historique des graphiques poussés interactif d3 pour comprendre ce qu'il peut être ameliorer, la moyenne de chaque micro/macro... sur les x dernier jours
      → Onglet « Historique » refait : période au choix (7/14/30/90 j), courbe d3 interactive du nutriment
        sélectionné (survol = crosshair + tooltip jour/valeur/% objectif, lignes objectif et moyenne), et
        « Moyenne par jour vs objectifs » : une barre par macro/micro (repères AJR + optimal) triée du moins
        couvert au mieux couvert pour voir en un coup d'œil quoi améliorer. Clic sur un nutriment = sa courbe.
        Les nutriments « à limiter » (sodium, AG saturés) sont à part, plus bas = mieux.
- [x] système pour modifier un jour passé (si on a oublié, qu'on remplit le lendemain, ou erreur à corriger sur hier)
      → Historique > « ✏️ Modifier un jour » (ou clic sur un jour de la liste) : sélecteur de date + raccourcis
        Hier/Avant-hier, entrées du jour éditables (aliments, quantités, suppression), ajout manuel qui enregistre
        directement sur ce jour. Et sur chaque entrée en mode « Modifier » : champ « Jour de l'entrée » pour la
        déplacer vers un autre jour (repas saisi le lendemain).
- [x] Système de sauvergarde à ameliorer
      → Couvert par « Export / sauvegarde des données » ci-dessus (Réglages > Données & sauvegarde).
- [x] Pouvoir modifier le texte reconnu par l'audi (car il n'est pas de grande qualité) avant d'appuyer sur " proccess les aliments" ou jsp le nom exact de ce bouton qui envoie au LLM
      → La dictée (Whisper OU reconnaissance native) ne fait plus l'extraction automatiquement : elle remplit
        le champ texte. On relit / corrige, puis on clique « Ajouter » (le bouton qui envoie au LLM/parseur).
- [x] reflexion comment faire un meilleur speech to text parce que là c'est vraimetn pas fou (peut être adapté au tel mais bon...) peut être sur ordi il y a mieux de possible ?
      → Ajout d'un 2e moteur STT dans Réglages : « Reconnaissance native » (Web Speech API du navigateur,
        souvent Google sur Chrome/Android). Nettement plus précis que Whisper tiny/base, temps réel, aucun
        téléchargement. Sélectionné par défaut si dispo ; repli sur Whisper (100 % local) sinon / sur Firefox.
        Contrepartie : selon le navigateur l'audio peut transiter par un service en ligne (pas garanti local).

- [(plus tard) ]  le telephone stocke les données texte après l'audio et tu peux envoyer à un llm sur ordi au moment ou tu l'as
- [x] Version photo : l'idée pourrait etre de mttre un audio ou une phto deux moyens de convertir en aliments
(photo dispo que si gros modèle API je pe pense)
      → Onglet « Aujourd'hui » : en mode « API Claude », bouton « 📷 Photo d'un repas » (prise de vue mobile ou
        fichier). L'image est envoyée à l'API vision de Claude (extractImageWithAnthropic) qui identifie les
        aliments et estime les quantités (toujours estimation=true). Réservé au mode cloud (gros modèle multimodal) ;
        masqué en règles / IA locale.
- [x] quick fix audio : affiche ce que le LLM a compris lorsque tu mets x aliments ajoutés (être concis par ex les 10/15 premieres lettre de l'aliment et la quantité pour chaque aliments)
      → Après chaque enregistrement (voix, texte ou photo), le statut affiche un résumé concis de ce qui a été
        compris : « ✓ Compris (3) : riz 1 bol · poulet 150 g · yaourt natur… 1 piece ». Nom tronqué à ~14
        caractères + quantité + unité, séparés par « · », pour vérification immédiate avant édition.
- [x] Lipides sepres en MOno, poly, omega 6, omega 9 tous ces rajouts
      → Nutriments détaillés : AG mono-insaturés, AG poly-insaturés, oméga 6 et oméga 9 (en plus des AG saturés et oméga 3).
        Ajoutés au type Nutrients, aux AJR (mono 35 g, poly 15 g, oméga 6 10 g, oméga 9 20 g) et renseignés sur tous les
        aliments gras. Se propagent automatiquement au bilan du jour, au classement par nutriment et à l'explorateur visuel.
- [x] Bug chargement du modèle sur les chiffres de % : "Modèle STT : progress 4439%"
      → transformers.js renvoie déjà `progress` en pourcentage (0–100) ; whisper.ts le normalisait mal. Corrigé en fraction
        0–1 (Math.min(1, progress/100)), cohérent avec le contrat SttProgressCallback. L'affichage montre bien 0→100 %.
- [x] possibilités de mttre une API key, ou modèle open source ou autre
      → Réglages > « Moteur d'extraction » : 3 modes — Règles (par défaut, local), IA locale open source (WebLLM/WebGPU),
        API Claude (champ clé API + choix du modèle Opus 4.8 / Sonnet 5 / Haiku 4.5). Repli automatique sur le parseur si l'API échoue.
- [x] Pouvoir remplir à la main les aliments que tu as mangé les grammes (un pue plus app classiques (mais être rapide))
      → Onglet « Aujourd'hui » > « Ajout manuel rapide » : recherche d'aliment, quantité + unité (grammes par défaut),
        aperçu kcal en direct, ajout immédiat au journal (Entrée pour valider).
- [x] ajoute d'un ecran stat : cherche dans la base les aliments les plus riches en xxx choix parmi marco micro, plein d'autres choix pour trouver les aliments
      → Onglet « Banque » > mode « Classement par nutriment » : menu déroulant (kcal + 22 macros/micros),
        top 30 des aliments les plus riches pour 100 g, barre relative + % de l'AJR.
- [x] ajout du visuel par rapport aux AJR micro et macro et kcals (pour vitamines C vitamine D augmente large mais JAR et OPtimuax pas que pour c'est deux là mais c'est ce ou moi je sais que opti != ajr)
      → Réglages > « Profil & objectifs » (sexe / poids / activité, défaut homme sportif 70 kg) calcule
        deux niveaux de cibles : AJR (référence) et optimal (protéines par kg, vitamines C et D relevées large).
        Onglet « Aujourd'hui » : chaque nutriment a une barre vers l'objectif optimal avec un repère sur l'AJR.
      fais pour un sportif homme de 70 kgs de base mais tu peux cheanger les besoins- [x] Ajouter dans la base des éléments bruts / compléments (sel, vitamines, magnésium, zinc, créatine…) + emmental râpé
      → Nouvelle catégorie « Compléments & assaisonnements » dans la banque : sel, poivre, créatine (monohydrate),
        protéine en poudre (whey), spiruline, levure maltée, et compléments magnésium / zinc / vitamine C / vitamine D3 /
        oméga 3. Nouvelles unités « pincée » et « dose » (+ gélule/comprimé/capsule/goutte → pièce, dosette/scoop/mesure → dose)
        reconnues à la voix et dans les 4 moteurs d'extraction. Compléments exclus du « Classement par nutriment » et de
        l'explorateur visuel (sinon un comprimé pur écrase tous les vrais aliments). Emmental : alias « emmental râpé / rapé »
        ajoutés (le râpé matchait déjà via « fromage râpé »).
- [x] Objectif perte de poids / prise de muscle dans les réglages (sans prendre trop de place)
      → Réglages > « Profil & objectifs » : 4e menu déroulant compact « Objectif » (Maintien / Perte de poids / Prise de
        muscle). Perte = déficit ~20 % sur les calories + protéines relevées (+0,4 g/kg) pour préserver le muscle ;
        Muscle = surplus ~10 % + protéines relevées (+0,3 g/kg). Se répercute sur les cibles « optimales » (kcal et protéines)
        de l'onglet « Aujourd'hui ». L'AJR de référence reste inchangé.

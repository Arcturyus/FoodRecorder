# À FAIRE


- [ ] Purge les photos de supabase une fois qu'elles ont bien été traités (gagne des données ?)

- [ ] On supprime la banque d'aliments en brut. À la place : un aliment entre dans la banque quand il **revient** (1 ou 2 fois, à décider), ou en tout cas tout est décrit par le LLM. La banque ne sert plus qu'aux stats — et du coup ça peut être cool d'y ajouter de nouveaux éléments.

dans "Ajout manuel rapide" rechercher dans la base + les aliments déjà mangés (+ préciser la dernière fois qu'on les a mangés lorsque l'on ajoute par ex)

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

## 4. Inspiration

- [ ] Analyse de l'app Cronometer, pour y prendre de bonnes idées ou des choses à ne pas faire.

**À éclaircir :** ce qu'on en attend concrètement — une note comparative écrite (fonctionnalité par fonctionnalité) ? un focus sur un aspect précis (saisie, graphes, base de données) ?

---
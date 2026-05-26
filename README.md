# SOMA — Guide de déploiement
> Assistant IA conçu par **NGG**

## Structure du projet
```
soma/
├── index.html          ← Interface principale
├── style.css           ← Design system
├── app.js              ← Logique JS + appels LLM
├── manifest.json       ← Config PWA
├── sw.js               ← Service Worker (cache)
├── logo.png            ← Logo SOMA
├── firebase.json       ← Config Firebase Hosting
└── functions/
    ├── index.js        ← Cloud Function (backend LLM)
    └── package.json
```

---

## 1. Obtenir les clés API gratuites

| Service | URL | Limite gratuite |
|---------|-----|----------------|
| **Groq** (LLaMA 3.3 70B) | https://console.groq.com | 14 400 req/jour |
| **Google Gemini** 2.0 Flash | https://aistudio.google.com | 1 500 req/jour |
| **Mistral Small** | https://console.mistral.ai | 500 req/jour |

---

## 2. Option A — Utilisation locale (sans Firebase)

1. Placer tous les fichiers dans un dossier
2. Ouvrir `index.html` dans un navigateur
3. Cliquer sur l'avatar (coin haut droit) → entrer vos clés API
4. Les clés sont sauvegardées localement (localStorage)

> **Note :** Pour tester en local avec le Service Worker, utiliser un serveur HTTP :
> ```bash
> npx serve .
> # ou
> python -m http.server 8080
> ```

---

## 3. Option B — GitHub Pages

```bash
# 1. Créer un repo GitHub nommé "soma"
# 2. Pousser tous les fichiers (sauf functions/)
git init
git add index.html style.css app.js manifest.json sw.js logo.png
git commit -m "SOMA v1.0.0"
git remote add origin https://github.com/VOTRE_USER/soma.git
git push -u origin main

# 3. Activer GitHub Pages : Settings → Pages → Source: main branch
# URL : https://VOTRE_USER.github.io/soma/
```

---

## 4. Option C — Firebase Hosting + Functions (recommandé)

### 4a. Installer Firebase CLI
```bash
npm install -g firebase-tools
firebase login
```

### 4b. Initialiser le projet
```bash
firebase init
# Sélectionner : Hosting + Functions + Firestore
# Public directory : . (point)
# Single page app : Yes
```

### 4c. Configurer les clés API (côté serveur)
```bash
firebase functions:config:set \
  soma.groq_key="gsk_VOTRE_CLE_GROQ" \
  soma.gemini_key="AIza_VOTRE_CLE_GEMINI" \
  soma.mistral_key="VOTRE_CLE_MISTRAL"
```

### 4d. Installer les dépendances des functions
```bash
cd functions
npm install
cd ..
```

### 4e. Déployer
```bash
firebase deploy
# URL : https://VOTRE_PROJECT.web.app
```

### 4f. Récupérer l'URL de la Function et la configurer
Après déploiement, l'URL ressemble à :
`https://us-central1-VOTRE_PROJECT.cloudfunctions.net/chat`

Dans l'app SOMA → avatar → "URL Firebase Function" → coller l'URL.

---

## 5. Règles Firestore (firestore.rules)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /conversations/{doc} {
      allow read, write: if request.auth != null;
    }
    match /soma_quotas/{doc} {
      allow read, write: if false; // Functions only
    }
  }
}
```

---

## 6. Ajouter un nouveau LLM (plug-and-play)

Dans `functions/index.js`, décommenter la section "APIs EXTERNES FUTURES" et ajouter la clé :
```bash
firebase functions:config:set soma.openrouter_key="sk-or-..."
```

Dans `app.js`, décommenter `callOpenRouter()` et l'ajouter au switch de `callLLM()`.

---

## 7. Variables d'environnement (développement local)

Créer `functions/.env.local` :
```
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
MISTRAL_API_KEY=...
```

---

*SOMA v1.0.0 — Conçu par NGG*

/* ═══════════════════════════════════════════════
   SOMA — app.js
   Logique principale : chat, LLMs, Firebase, UI
   Auteur : NGG
   ═══════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────────
   1. CONFIGURATION & ÉTAT GLOBAL
────────────────────────────────────────────── */

const SOMA = {
  version: '1.0.0',

  // Clés API (chargées depuis localStorage)
  keys: {
    groq:     '',
    gemini:   '',
    mistral:  '',
    firebase: ''   // URL de la Firebase Function
  },

  // Modèles disponibles
  models: {
    groq:    { name: 'LLaMA 3.3 70B',     provider: 'Groq',       color: '#10B981' },
    gemini:  { name: 'Gemini 2.0 Flash',  provider: 'Google',     color: '#FACC15' },
    mistral: { name: 'Mistral Small',     provider: 'Mistral AI', color: '#1E3A8A' },
    auto:    { name: 'Auto Mix',          provider: 'SOMA',       color: '#10B981' }
  },

  // État courant
  state: {
    currentModel:   'auto',       // modèle sélectionné
    isLoading:      false,        // requête en cours
    conversations:  [],           // historique local [{id, title, messages}]
    activeConvId:   null,         // conversation active
    attachedFile:   null,         // { name, base64, type, isImage }
    groqCallsToday: 0,            // compteur reset chaque jour
    lastGroqReset:  null,
  },

  // Compteurs journaliers (limites gratuites)
  limits: {
    groq:    14400,
    gemini:  1500,
    mistral: 500
  }
};

/* ──────────────────────────────────────────────
   2. INITIALISATION AU CHARGEMENT
────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadConversations();
  bindEvents();
  renderSidebar();
  autoResizeTextarea();

  // Afficher modal config si aucune clé n'est configurée
  if (!SOMA.keys.groq && !SOMA.keys.gemini && !SOMA.keys.mistral && !SOMA.keys.firebase) {
    setTimeout(() => openModal(), 800);
  }
});

/* ──────────────────────────────────────────────
   3. CHARGEMENT / SAUVEGARDE CONFIG (localStorage)
────────────────────────────────────────────── */

function loadConfig() {
  const saved = localStorage.getItem('soma_config');
  if (saved) {
    try {
      const cfg = JSON.parse(saved);
      SOMA.keys.groq     = cfg.groq     || '';
      SOMA.keys.gemini   = cfg.gemini   || '';
      SOMA.keys.mistral  = cfg.mistral  || '';
      SOMA.keys.firebase = cfg.firebase || '';
    } catch(e) { console.warn('Config invalide'); }
  }

  // Compteurs journaliers
  const counters = localStorage.getItem('soma_counters');
  if (counters) {
    try {
      const c = JSON.parse(counters);
      const today = new Date().toDateString();
      if (c.date === today) {
        SOMA.state.groqCallsToday = c.groq || 0;
      }
    } catch(e) {}
  }
}

function saveConfig() {
  localStorage.setItem('soma_config', JSON.stringify({
    groq:     SOMA.keys.groq,
    gemini:   SOMA.keys.gemini,
    mistral:  SOMA.keys.mistral,
    firebase: SOMA.keys.firebase
  }));
}

function saveCounters() {
  localStorage.setItem('soma_counters', JSON.stringify({
    date: new Date().toDateString(),
    groq: SOMA.state.groqCallsToday
  }));
}

/* ──────────────────────────────────────────────
   4. GESTION DES CONVERSATIONS
────────────────────────────────────────────── */

function loadConversations() {
  const saved = localStorage.getItem('soma_conversations');
  if (saved) {
    try { SOMA.state.conversations = JSON.parse(saved); }
    catch(e) { SOMA.state.conversations = []; }
  }
  // Activer la dernière conversation ou créer une nouvelle
  if (SOMA.state.conversations.length > 0) {
    SOMA.state.activeConvId = SOMA.state.conversations[0].id;
    renderMessages();
  }
}

function saveConversations() {
  // Garder max 50 conversations
  if (SOMA.state.conversations.length > 50) {
    SOMA.state.conversations = SOMA.state.conversations.slice(0, 50);
  }
  localStorage.setItem('soma_conversations', JSON.stringify(SOMA.state.conversations));
}

function newConversation() {
  SOMA.state.activeConvId = null;
  SOMA.state.attachedFile = null;
  showWelcome();
  clearFilePreview();
  document.getElementById('user-input').value = '';
  updateSendBtn();
  closeSidebar();
}

function getActiveConv() {
  if (!SOMA.state.activeConvId) return null;
  return SOMA.state.conversations.find(c => c.id === SOMA.state.activeConvId) || null;
}

function createConversation(firstMessage) {
  const id    = 'conv_' + Date.now();
  const title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '…' : '');
  const conv  = { id, title, messages: [], createdAt: Date.now() };
  SOMA.state.conversations.unshift(conv);
  SOMA.state.activeConvId = id;
  return conv;
}

function addMessageToConv(role, content, model) {
  let conv = getActiveConv();
  if (!conv) conv = createConversation(content);
  conv.messages.push({ role, content, model, ts: Date.now() });
  saveConversations();
  renderSidebar();
  return conv;
}

/* ──────────────────────────────────────────────
   5. ROUTING INTELLIGENT DES MODÈLES
────────────────────────────────────────────── */

/**
 * Choisit automatiquement le meilleur LLM selon :
 * - présence d'image/PDF → Gemini (vision)
 * - quota Groq disponible → Groq LLaMA (primaire)
 * - sinon Mistral (backup)
 * - sinon Firebase Function (si configurée)
 */
function resolveModel(hasFile) {
  const model = SOMA.state.currentModel;

  // Modèle manuel sélectionné (pas auto)
  if (model !== 'auto') return model;

  // Fichier joint → Gemini pour la vision
  if (hasFile && SOMA.keys.gemini) return 'gemini';

  // Groq disponible et quota OK
  if (SOMA.keys.groq && SOMA.state.groqCallsToday < SOMA.limits.groq) return 'groq';

  // Mistral backup
  if (SOMA.keys.mistral) return 'mistral';

  // Firebase Function (LLM côté serveur)
  if (SOMA.keys.firebase) return 'firebase';

  // Gemini en dernier recours texte
  if (SOMA.keys.gemini) return 'gemini';

  return null; // Aucune clé configurée
}

/* ──────────────────────────────────────────────
   6. APPELS AUX APIs LLM
────────────────────────────────────────────── */

/**
 * Entrée principale — reçoit les messages et dispatche vers le bon LLM
 * @param {Array}  messages  - historique [{role, content}]
 * @param {Object} fileData  - { base64, type, isImage } ou null
 * @returns {Promise<{text, model}>}
 */
async function callLLM(messages, fileData = null) {
  const resolved = resolveModel(!!fileData);

  if (!resolved) {
    throw new Error('Aucune clé API configurée. Cliquez sur ⚙️ pour ajouter vos clés.');
  }

  switch (resolved) {
    case 'groq':     return callGroq(messages);
    case 'gemini':   return callGemini(messages, fileData);
    case 'mistral':  return callMistral(messages);
    case 'firebase': return callFirebase(messages, fileData);
    default:         throw new Error('Modèle inconnu : ' + resolved);
  }
}

/* ── 6a. GROQ (LLaMA 3.3 70B) ── */
async function callGroq(messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SOMA.keys.groq}`
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    formatMessagesOpenAI(messages),
      max_tokens:  2048,
      temperature: 0.7,
      stream:      false
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  SOMA.state.groqCallsToday++;
  saveCounters();

  return {
    text:  data.choices[0].message.content,
    model: 'groq'
  };
}

/* ── 6b. GOOGLE GEMINI 2.0 Flash ── */
async function callGemini(messages, fileData) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${SOMA.keys.gemini}`;

  // Construction des parts (texte + image optionnelle)
  const parts = [];

  if (fileData?.isImage && fileData.base64) {
    parts.push({
      inline_data: {
        mime_type: fileData.type,
        data:      fileData.base64
      }
    });
  }

  // Dernier message utilisateur
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  parts.push({ text: lastUserMsg?.content || '' });

  // Historique (sans le dernier message)
  const history = messages.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = {
    contents: [
      ...history,
      { role: 'user', parts }
    ],
    generationConfig: {
      maxOutputTokens: 2048,
      temperature:     0.7
    }
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return { text, model: 'gemini' };
}

/* ── 6c. MISTRAL SMALL ── */
async function callMistral(messages) {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SOMA.keys.mistral}`
    },
    body: JSON.stringify({
      model:       'mistral-small-latest',
      messages:    formatMessagesOpenAI(messages),
      max_tokens:  2048,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Mistral: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return {
    text:  data.choices[0].message.content,
    model: 'mistral'
  };
}

/* ── 6d. FIREBASE FUNCTION (LLM côté serveur) ── */
async function callFirebase(messages, fileData) {
  const res = await fetch(SOMA.keys.firebase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: formatMessagesOpenAI(messages),
      file:     fileData ? { base64: fileData.base64, type: fileData.type } : null
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Firebase: ${err.error || res.statusText}`);
  }

  const data = await res.json();
  return { text: data.text || data.content || '', model: 'firebase' };
}

/* ── Formatage messages pour APIs OpenAI-compatibles ── */
function formatMessagesOpenAI(messages) {
  const system = {
    role:    'system',
    content: `Tu es SOMA, un assistant IA intelligent et bienveillant créé par NGG. 
Tu réponds de manière claire, précise et utile en français par défaut (sauf si l'utilisateur écrit dans une autre langue).
Tu es capable d'analyser des documents, d'écrire du code, d'expliquer des concepts complexes et d'aider dans toutes les tâches.`
  };
  return [system, ...messages.map(m => ({ role: m.role, content: m.content }))];
}

/* ──────────────────────────────────────────────
   7. GESTION DES MESSAGES & UI
────────────────────────────────────────────── */

async function sendMessage() {
  const input   = document.getElementById('user-input');
  const text    = input.value.trim();
  const file    = SOMA.state.attachedFile;

  if ((!text && !file) || SOMA.state.isLoading) return;

  // Vérifier qu'au moins une clé est configurée
  const hasKey = SOMA.keys.groq || SOMA.keys.gemini || SOMA.keys.mistral || SOMA.keys.firebase;
  if (!hasKey) {
    showToast('⚙️ Configurez d\'abord vos clés API');
    openModal();
    return;
  }

  const userContent = text || (file ? `[Fichier joint : ${file.name}]` : '');

  // Afficher la zone de chat
  showChat();

  // Ajouter message utilisateur à l'état
  addMessageToConv('user', userContent, null);

  // Afficher la bulle utilisateur
  appendUserBubble(userContent, file);

  // Réinitialiser l'input
  input.value = '';
  input.style.height = 'auto';
  clearFilePreview();
  updateSendBtn();
  updateCharCount(0);

  // Afficher l'indicateur de frappe
  const typingId = showTyping();

  SOMA.state.isLoading = true;
  updateSendBtn();

  try {
    // Récupérer l'historique de la conversation (sans le tout dernier qui vient d'être ajouté)
    const conv     = getActiveConv();
    const history  = conv ? conv.messages.slice(0, -1) : [];
    const messages = [...history, { role: 'user', content: userContent }];

    // Appel au LLM
    const result = await callLLM(messages, file);

    // Supprimer le typing indicator
    removeTyping(typingId);

    // Ajouter la réponse à l'état
    addMessageToConv('assistant', result.text, result.model);

    // Afficher la bulle IA
    appendAIBubble(result.text, result.model);

  } catch (err) {
    removeTyping(typingId);
    console.error('Erreur LLM:', err);
    appendErrorBubble(err.message);
  } finally {
    SOMA.state.isLoading = false;
    updateSendBtn();
    scrollToBottom();
  }
}

/* ── Affichage bulle utilisateur ── */
function appendUserBubble(text, file) {
  const list = document.getElementById('messages-list');
  const group = document.createElement('div');
  group.className = 'message-group msg-user';

  let imgHtml = '';
  if (file?.isImage && file.base64) {
    imgHtml = `<img src="data:${file.type};base64,${file.base64}" class="attached-image" alt="Image jointe" />`;
  } else if (file) {
    imgHtml = `<div style="font-size:12px;color:#94A3B8;margin-bottom:4px">📎 ${escapeHtml(file.name)}</div>`;
  }

  group.innerHTML = `
    <div class="bubble">
      ${imgHtml}
      ${text ? `<span>${escapeHtml(text)}</span>` : ''}
    </div>`;
  list.appendChild(group);
  scrollToBottom();
}

/* ── Affichage bulle IA ── */
function appendAIBubble(text, modelKey) {
  const list  = document.getElementById('messages-list');
  const model = SOMA.models[modelKey] || { name: modelKey, color: '#10B981' };

  const group = document.createElement('div');
  group.className = 'message-group msg-ai';
  group.innerHTML = `
    <div class="ai-avatar">S</div>
    <div>
      <div class="bubble">${renderMarkdown(text)}</div>
      <div class="model-tag" style="color:${model.color}">● ${model.name} · ${model.provider}</div>
    </div>`;
  list.appendChild(group);
  scrollToBottom();
}

/* ── Affichage bulle erreur ── */
function appendErrorBubble(message) {
  const list  = document.getElementById('messages-list');
  const group = document.createElement('div');
  group.className = 'message-group msg-ai msg-error';
  group.innerHTML = `
    <div class="ai-avatar" style="background:#EF4444">!</div>
    <div class="bubble">⚠️ ${escapeHtml(message)}</div>`;
  list.appendChild(group);
  scrollToBottom();
}

/* ── Typing indicator ── */
function showTyping() {
  const id   = 'typing_' + Date.now();
  const list = document.getElementById('messages-list');
  const el   = document.createElement('div');
  el.id        = id;
  el.className = 'message-group msg-ai typing-indicator';
  el.innerHTML = `
    <div class="ai-avatar">S</div>
    <div class="bubble">
      <span class="dot-typing"></span>
      <span class="dot-typing"></span>
      <span class="dot-typing"></span>
    </div>`;
  list.appendChild(el);
  scrollToBottom();
  return id;
}

function removeTyping(id) {
  document.getElementById(id)?.remove();
}

/* ── Re-render tous les messages d'une conversation ── */
function renderMessages() {
  const conv = getActiveConv();
  if (!conv || conv.messages.length === 0) { showWelcome(); return; }

  showChat();
  const list = document.getElementById('messages-list');
  list.innerHTML = '';

  conv.messages.forEach(msg => {
    if (msg.role === 'user') {
      appendUserBubble(msg.content, null);
    } else {
      appendAIBubble(msg.content, msg.model || 'groq');
    }
  });
}

/* ──────────────────────────────────────────────
   8. GESTION DES FICHIERS
────────────────────────────────────────────── */

function handleFileInput(e) {
  const file = e.target.files[0];
  if (!file) return;

  const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo
  if (file.size > MAX_SIZE) {
    showToast('❌ Fichier trop volumineux (max 10 Mo)');
    return;
  }

  const isImage = file.type.startsWith('image/');
  const isPDF   = file.type === 'application/pdf';

  if (!isImage && !isPDF) {
    showToast('❌ Format non supporté (image ou PDF uniquement)');
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    // Extraire le base64 pur (sans le préfixe data:...)
    const base64 = ev.target.result.split(',')[1];
    SOMA.state.attachedFile = {
      name:    file.name,
      base64,
      type:    file.type,
      isImage
    };
    showFilePreview(file.name);
    updateSendBtn();

    // Si image jointe → passer automatiquement en Gemini si disponible
    if (isImage && SOMA.state.currentModel === 'auto' && SOMA.keys.gemini) {
      showToast('📷 Mode Vision activé (Gemini)');
    }
  };
  reader.readAsDataURL(file);

  // Reset l'input pour permettre de re-choisir le même fichier
  e.target.value = '';
}

function showFilePreview(name) {
  const preview = document.getElementById('file-preview');
  const nameEl  = document.getElementById('file-name-display');
  nameEl.textContent = '📎 ' + name;
  preview.style.display = 'block';
}

function clearFilePreview() {
  SOMA.state.attachedFile = null;
  document.getElementById('file-preview').style.display = 'none';
  document.getElementById('file-name-display').textContent = '';
}

/* ──────────────────────────────────────────────
   9. SIDEBAR & NAVIGATION
────────────────────────────────────────────── */

function renderSidebar() {
  const list = document.getElementById('sidebar-list');
  list.innerHTML = '';

  if (SOMA.state.conversations.length === 0) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-3);padding:12px;text-align:center">Aucune conversation</div>';
    return;
  }

  SOMA.state.conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (conv.id === SOMA.state.activeConvId ? ' active' : '');
    item.textContent = conv.title || 'Nouvelle conversation';
    item.addEventListener('click', () => {
      SOMA.state.activeConvId = conv.id;
      renderMessages();
      renderSidebar();
      closeSidebar();
    });
    list.appendChild(item);
  });
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

/* ──────────────────────────────────────────────
   10. MODAL CONFIGURATION
────────────────────────────────────────────── */

function openModal() {
  // Pré-remplir les champs
  document.getElementById('groq-key').value    = SOMA.keys.groq;
  document.getElementById('gemini-key').value  = SOMA.keys.gemini;
  document.getElementById('mistral-key').value = SOMA.keys.mistral;
  document.getElementById('firebase-url').value = SOMA.keys.firebase;
  document.getElementById('modal-config').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-config').style.display = 'none';
}

function saveModalConfig() {
  SOMA.keys.groq     = document.getElementById('groq-key').value.trim();
  SOMA.keys.gemini   = document.getElementById('gemini-key').value.trim();
  SOMA.keys.mistral  = document.getElementById('mistral-key').value.trim();
  SOMA.keys.firebase = document.getElementById('firebase-url').value.trim();
  saveConfig();
  closeModal();
  showToast('✅ Configuration enregistrée');
}

/* ──────────────────────────────────────────────
   11. SÉLECTEUR DE MODÈLE
────────────────────────────────────────────── */

function initModelSelector() {
  const current  = document.getElementById('model-current');
  const dropdown = document.getElementById('model-dropdown');
  const dot      = document.getElementById('model-dot');
  const label    = document.getElementById('model-label');

  current.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.querySelectorAll('.model-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const modelKey   = btn.dataset.model;
      const modelLabel = btn.dataset.label;
      const modelColor = btn.dataset.color;

      SOMA.state.currentModel = modelKey;
      label.textContent = modelLabel;
      dot.style.background = modelColor;

      // Marquer actif
      document.querySelectorAll('.model-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      dropdown.classList.remove('open');
    });
  });

  // Fermer en cliquant ailleurs
  document.addEventListener('click', () => dropdown.classList.remove('open'));
}

/* ──────────────────────────────────────────────
   12. UI HELPERS
────────────────────────────────────────────── */

function showWelcome() {
  document.getElementById('welcome-screen').style.display  = 'flex';
  document.getElementById('chat-container').style.display  = 'none';
}

function showChat() {
  document.getElementById('welcome-screen').style.display  = 'none';
  document.getElementById('chat-container').style.display  = 'block';
}

function scrollToBottom() {
  const main = document.getElementById('main');
  requestAnimationFrame(() => {
    main.scrollTo({ top: main.scrollHeight, behavior: 'smooth' });
  });
}

function updateSendBtn() {
  const btn   = document.getElementById('btn-send');
  const input = document.getElementById('user-input');
  const hasText = input.value.trim().length > 0;
  const hasFile = !!SOMA.state.attachedFile;
  btn.disabled = (!hasText && !hasFile) || SOMA.state.isLoading;
}

function updateCharCount(len) {
  const el = document.getElementById('char-count');
  el.textContent = `${len} / 8000`;
  el.className   = 'char-count' + (len > 7000 ? ' danger' : len > 6000 ? ' warn' : '');
}

function autoResizeTextarea() {
  const ta = document.getElementById('user-input');
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
    updateCharCount(ta.value.length);
    updateSendBtn();
  });
}

function showToast(message) {
  // Supprimer un toast existant
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className   = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
    return marked.parse(text);
  }
  // Fallback basique si marked non chargé
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ──────────────────────────────────────────────
   13. THÈME SOMBRE / CLAIR
────────────────────────────────────────────── */

function initTheme() {
  const saved = localStorage.getItem('soma_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

function toggleTheme() {
  const current = document.body.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('soma_theme', theme);
  const sun  = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (theme === 'dark') {
    sun.style.display  = 'none';
    moon.style.display = 'block';
  } else {
    sun.style.display  = 'block';
    moon.style.display = 'none';
  }
}

/* ──────────────────────────────────────────────
   14. BINDING DES ÉVÉNEMENTS
────────────────────────────────────────────── */

function bindEvents() {
  // Thème
  initTheme();
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Sélecteur modèle
  initModelSelector();

  // Sidebar
  document.getElementById('btn-sidebar').addEventListener('click', openSidebar);
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
  document.getElementById('btn-new-conv').addEventListener('click', newConversation);

  // Nouvelle conversation (bouton header)
  document.getElementById('btn-new-chat').addEventListener('click', newConversation);

  // Envoyer message
  document.getElementById('btn-send').addEventListener('click', sendMessage);
  document.getElementById('user-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Fichier
  document.getElementById('file-input').addEventListener('change', handleFileInput);
  document.getElementById('btn-remove-file').addEventListener('click', () => {
    clearFilePreview();
    updateSendBtn();
  });

  // Modal config — ouvrir via clic sur avatar
  document.getElementById('btn-user').addEventListener('click', openModal);
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-config').addEventListener('click', closeModal);
  document.getElementById('btn-save-config').addEventListener('click', saveModalConfig);

  // Fermer modal en cliquant sur l'overlay
  document.getElementById('modal-config').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-config')) closeModal();
  });

  // Suggestions d'accueil
  document.querySelectorAll('.suggestion-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      document.getElementById('user-input').value = prompt;
      updateSendBtn();
      updateCharCount(prompt.length);
      document.getElementById('user-input').focus();
      sendMessage();
    });
  });
}

/* ──────────────────────────────────────────────
   15. ESPACE POUR APIS EXTERNES FUTURES
   (décommenter et adapter selon besoin)
────────────────────────────────────────────── */

/*
// Exemple : OpenRouter (agrégateur gratuit)
async function callOpenRouter(messages) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SOMA.keys.openrouter}`,
      'HTTP-Referer':  window.location.href
    },
    body: JSON.stringify({
      model:    'meta-llama/llama-3.3-70b-instruct:free',
      messages: formatMessagesOpenAI(messages)
    })
  });
  const data = await res.json();
  return { text: data.choices[0].message.content, model: 'openrouter' };
}

// Exemple : API externe personnalisée
async function callCustomAPI(messages) {
  const res = await fetch('https://votre-api.com/v1/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': SOMA.keys.custom },
    body: JSON.stringify({ messages, context: 'SOMA assistant' })
  });
  const data = await res.json();
  return { text: data.response, model: 'custom' };
}
*/

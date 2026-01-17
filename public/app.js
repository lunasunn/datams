/* global io */
'use strict';

const STORAGE_KEY_KEY = 'minichat.key';
const STORAGE_KEY_FALLBACK_NICK = 'minichat.nick_fallback';
const MAX_MESSAGE_LENGTH = 800;

// i18n
const I18N = {
  ru: {
    settings: 'Настройки',
    shop: 'Магазин',
    online: 'online',
    offline: 'offline',
    balance: '#',
    you: 'ты',
    msgPlaceholder: 'сообщение...',
    send: 'отпр',
    title: 'Настройки',
    shopTitle: 'Магазин',
    shopBalance: 'Баланс: #{balance}',
    shopBuy: 'Купить',
    shopActivate: 'Активировать',
    shopActive: 'Активно',
    shopNoFunds: 'Недостаточно баланса.',
    shopClose: 'закрыть',
    key: 'Ключ',
    keyHint: 'Вставь ключ, чтобы загрузить аккаунт. Иначе используется твой текущий.',
    nick: 'Ник',
    lang: 'Язык',
    avatar: 'Аватар (PNG)',
    avatarHint: 'Выберите PNG, размер ограничен, файл не выбран.',
    avatarHintSelected: 'Выберите PNG, размер ограничен, выбран: {name}.',
    avatarChoose: 'Выбрать файл',
    avatarErrTooLarge: 'Файл слишком большой.',
    avatarErrUpload: 'Ошибка загрузки аватара.',
    cancel: 'отмена',
    save: 'сохранить',
    nickHint: 'Ник: a-z A-Z 0-9 _ - (остальное станет _)',
    langHint: 'Выберите язык интерфейса.'
  },
  en: {
    settings: 'Settings',
    shop: 'Shop',
    online: 'online',
    offline: 'offline',
    balance: '#',
    you: 'you',
    msgPlaceholder: 'message...',
    send: 'send',
    title: 'Settings',
    shopTitle: 'Shop',
    shopBalance: 'Balance: #{balance}',
    shopBuy: 'Buy',
    shopActivate: 'Activate',
    shopActive: 'Active',
    shopNoFunds: 'Not enough balance.',
    shopClose: 'close',
    key: 'Key',
    keyHint: 'Paste a key to load an account. Otherwise your current one is used.',
    nick: 'Nick',
    lang: 'Language',
    avatar: 'Avatar (PNG)',
    avatarHint: 'PNG only. Size is limited, no file selected.',
    avatarHintSelected: 'PNG only. Size is limited, selected: {name}.',
    avatarChoose: 'Choose file',
    avatarErrTooLarge: 'File is too large.',
    avatarErrUpload: 'Avatar upload failed.',
    cancel: 'cancel',
    save: 'save',
    nickHint: 'Nick: a-z A-Z 0-9 _ - (others become _)',
    langHint: 'Choose the interface language.'
  },
  zh: {
    settings: '设置',
    shop: '商店',
    online: '在线',
    offline: '离线',
    balance: '#',
    you: '你',
    msgPlaceholder: '消息...',
    send: '发送',
    title: '设置',
    shopTitle: '商店',
    shopBalance: '余额: #{balance}',
    shopBuy: '购买',
    shopActivate: '启用',
    shopActive: '已启用',
    shopNoFunds: '余额不足。',
    shopClose: '关闭',
    key: '密钥',
    keyHint: '粘贴密钥以加载账号，否则使用当前密钥。',
    nick: '昵称',
    lang: '语言',
    avatar: '头像 (PNG)',
    avatarHint: '仅 PNG，大小有限制，未选择文件。',
    avatarHintSelected: '仅 PNG，大小有限制，已选择：{name}。',
    avatarChoose: '选择文件',
    avatarErrTooLarge: '文件太大。',
    avatarErrUpload: '头像上传失败。',
    cancel: '取消',
    save: '保存',
    nickHint: '昵称: a-z A-Z 0-9 _ - (其他字符会变成 _)',
    langHint: '选择界面语言。'
  }
};

// Elements
const messagesEl = document.getElementById('messages');
const composerEl = document.getElementById('composer');
const inputEl = document.getElementById('input');
const statusEl = document.getElementById('status');
const youLineEl = document.getElementById('youLine');

const settingsBtn = document.getElementById('settingsBtn');
const shopBtn = document.getElementById('shopBtn');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const shopModal = document.getElementById('shopModal');
const shopTitle = document.getElementById('shopTitle');
const shopBalance = document.getElementById('shopBalance');
const shopList = document.getElementById('shopList');
const shopCloseBtn = document.getElementById('shopCloseBtn');

const keyInput = document.getElementById('keyInput');
const nickInput = document.getElementById('nickInput');
const langSelect = document.getElementById('langSelect');

const avatarFile = document.getElementById('avatarFile');
const avatarPreviewImg = document.getElementById('avatarPreviewImg');
const avatarFileBtn = document.getElementById('avatarFileBtn');

const labelKey = document.getElementById('labelKey');
const hintKey = document.getElementById('hintKey');
const labelNick = document.getElementById('labelNick');
const labelLang = document.getElementById('labelLang');
const labelAvatar = document.getElementById('labelAvatar');
const hintAvatar = document.getElementById('hintAvatar');
const hintNick = document.getElementById('hintNick');
const hintLang = document.getElementById('hintLang');

const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

let accountKey = getOrCreateKey();
let profile = {
  key: accountKey,
  nick: getFallbackNick(),
  lang: 'ru',
  avatar_url: '', // server will set after upload
  balance: 0,
  prefix: '',
  email: ''
};

let isReady = false;
let pendingAvatarFile = null;
let balanceTickInFlight = false;
let shopState = null;

// Socket
const socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
  timeout: 2000
});

socket.on('connect', () => {
  setStatus(true);
  isReady = false;
  hello();
});

socket.on('disconnect', () => {
  setStatus(false);
  isReady = false;
});

socket.on('connect_error', () => {
  setStatus(false);
  isReady = false;
});

socket.on('chat_history', (history) => {
  messagesEl.innerHTML = '';
  if (Array.isArray(history)) {
    for (const msg of history) appendMessage(msg);
    scrollToBottom(true);
  }
});

socket.on('profile', (p) => {
  if (p && typeof p === 'object') {
    profile = {
      key: p.key || accountKey,
      nick: p.nick || profile.nick,
      lang: p.lang || profile.lang,
      avatar_url: p.avatar_url || profile.avatar_url || '',
      balance: Number.isFinite(p.balance) ? p.balance : profile.balance || 0,
      prefix: p.prefix || profile.prefix || '',
      email: p.email || profile.email || ''
    };
    accountKey = profile.key;
    localStorage.setItem(STORAGE_KEY_KEY, accountKey);

    isReady = true;

    renderYouLine();
    applyLang(profile.lang);
    setStatus(socket.connected);
    updateRenderedMessages(profile.key, profile.nick, profile.avatar_url, profile.prefix);
  }
});

socket.on('chat_message', (msg) => {
  appendMessage(msg);
  scrollToBottom(false);
});

setInterval(() => {
  if (!socket.connected || !isReady) return;
  if (balanceTickInFlight) return;
  balanceTickInFlight = true;
  incrementBalance()
    .catch(() => {})
    .finally(() => {
      balanceTickInFlight = false;
    });
}, 1000);

socket.on('user_profile', (p) => {
  if (!p || typeof p !== 'object') return;
  const key = typeof p.key === 'string' ? p.key : '';
  if (!key) return;

  if (key === profile.key) {
    profile = {
      ...profile,
      nick: p.nick || profile.nick,
      avatar_url: p.avatar_url || profile.avatar_url || '',
      prefix: p.prefix || profile.prefix || ''
    };
    renderYouLine();
    refreshAvatarPreview();
  }

  updateRenderedMessages(key, p.nick || '', p.avatar_url || '', p.prefix || '');
});

// Composer
composerEl.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, window.innerHeight * 0.35)}px`;
});

function sendMessage() {
  const text = normalizeText(inputEl.value);
  if (!text) return;
  if (!socket.connected) return;
  if (!isReady) return;

  socket.emit('chat_message', { text });

  inputEl.value = '';
  inputEl.style.height = 'auto';
}

// Settings modal
settingsBtn.addEventListener('click', () => openModal());
shopBtn.addEventListener('click', () => openShop());
cancelBtn.addEventListener('click', () => closeModal());
saveBtn.addEventListener('click', () => saveSettings());
shopCloseBtn.addEventListener('click', () => closeShop());

modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});
shopModal.addEventListener('click', (e) => {
  if (e.target === shopModal) closeShop();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  if (e.key === 'Escape' && !shopModal.classList.contains('hidden')) closeShop();
});

// Avatar file preview
avatarFile.addEventListener('change', () => {
  const f = avatarFile.files && avatarFile.files[0];
  pendingAvatarFile = null;

  if (!f) {
    refreshAvatarPreview();
    setAvatarHint(null);
    return;
  }

  // Only png
  if (f.type !== 'image/png') {
    avatarFile.value = '';
    refreshAvatarPreview();
    setAvatarHint(null);
    alert('PNG only');
    return;
  }

  pendingAvatarFile = f;
  const url = URL.createObjectURL(f);
  avatarPreviewImg.src = url;
  setAvatarHint(f.name);
});

function openModal() {
  keyInput.value = accountKey;
  nickInput.value = profile.nick;
  langSelect.value = profile.lang;

  avatarFile.value = '';
  pendingAvatarFile = null;
  refreshAvatarPreview();
  setAvatarHint(null);

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  setTimeout(() => {
    keyInput.focus();
    keyInput.select();
  }, 0);
}

function closeModal() {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function openShop() {
  shopModal.classList.remove('hidden');
  shopModal.setAttribute('aria-hidden', 'false');
  loadShop();
}

function closeShop() {
  shopModal.classList.add('hidden');
  shopModal.setAttribute('aria-hidden', 'true');
}

async function saveSettings() {
  const newKey = normalizeKey(keyInput.value);
  if (newKey && newKey !== accountKey) {
    accountKey = newKey;
    localStorage.setItem(STORAGE_KEY_KEY, accountKey);
    isReady = false;
  }

  const newNick = sanitizeNick(nickInput.value);
  const newLang = langSelect.value;

  // optimistic local
  profile = { ...profile, key: accountKey, nick: newNick, lang: newLang };
  renderYouLine();
  applyLang(newLang);

  if (socket.connected) {
    socket.emit('hello', { key: accountKey, nick: profile.nick, lang: profile.lang });
    socket.emit('update_profile', {
      key: accountKey,
      nick: profile.nick,
      lang: profile.lang,
      email: profile.email
    });
  }

  // Upload avatar if selected
  if (pendingAvatarFile) {
    try {
      saveBtn.disabled = true;
      await uploadAvatar(accountKey, pendingAvatarFile);

      // After upload, ask server to re-send profile (hello is enough)
      if (socket.connected) socket.emit('hello', { key: accountKey, nick: profile.nick, lang: profile.lang });
    } catch (e) {
      console.error(e);
      const t = I18N[profile.lang] || I18N.ru;
      const code = e?.message || '';
      if (code === 'file_too_large' || code === 'avatar_too_large') {
        alert(t.avatarErrTooLarge);
      } else {
        alert(t.avatarErrUpload);
      }
    } finally {
      saveBtn.disabled = false;
    }
  }

  closeModal();
}

async function uploadAvatar(key, file) {
  const fd = new FormData();
  fd.append('key', key);
  fd.append('avatar', file);

  const resp = await fetch('/api/avatar', { method: 'POST', body: fd });
  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || !data.ok) {
    const err = data.error || 'upload_error';
    throw new Error(err);
  }

  // Update local preview immediately (server returns cache-busted url)
  profile.avatar_url = data.avatar_url || profile.avatar_url;
  refreshAvatarPreview();
  renderYouLine();
}

async function incrementBalance() {
  const resp = await fetch('/api/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: accountKey })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) throw new Error(data.error || 'balance_error');
  profile.balance = Number.isFinite(data.balance) ? data.balance : profile.balance || 0;
  if (shopState) shopState.balance = profile.balance;
  renderBalance();
}

function refreshAvatarPreview() {
  if (profile.avatar_url) {
    avatarPreviewImg.src = profile.avatar_url;
    avatarPreviewImg.style.display = 'block';
  } else {
    avatarPreviewImg.removeAttribute('src');
    avatarPreviewImg.style.display = 'none';
  }
}

async function loadShop() {
  if (!accountKey) return;
  const resp = await fetch(`/api/shop?key=${accountKey}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) return;

  shopState = {
    balance: Number.isFinite(data.balance) ? data.balance : profile.balance || 0,
    active_prefix_id: data.active_prefix_id || '',
    prefixes: Array.isArray(data.prefixes) ? data.prefixes : []
  };

  profile.balance = shopState.balance;
  renderBalance();
  renderShop();
}

function renderShop() {
  const t = I18N[profile.lang] || I18N.ru;
  shopTitle.textContent = t.shopTitle;
  shopBalance.textContent = t.shopBalance.replace('{balance}', String(shopState?.balance || 0));
  shopCloseBtn.textContent = t.shopClose;

  shopList.innerHTML = '';
  if (!shopState) return;

  for (const item of shopState.prefixes) {
    const row = document.createElement('div');
    row.className = 'shopItem';

    const meta = document.createElement('div');
    meta.className = 'shopMeta';

    const name = document.createElement('div');
    name.className = 'shopName';
    name.textContent = item.label;

    const price = document.createElement('div');
    price.className = 'shopPrice';
    price.textContent = `#${item.price}`;

    meta.appendChild(name);
    meta.appendChild(price);

    const btn = document.createElement('button');
    btn.className = 'btn shopBtn';
    btn.type = 'button';

    if (item.owned) {
      if (shopState.active_prefix_id === item.id) {
        btn.textContent = t.shopActive;
        btn.disabled = true;
        btn.classList.add('btn--accent');
      } else {
        btn.textContent = t.shopActivate;
        btn.addEventListener('click', () => activatePrefix(item.id));
      }
    } else {
      btn.textContent = `${t.shopBuy} #${item.price}`;
      btn.addEventListener('click', () => buyPrefix(item.id));
    }

    row.appendChild(meta);
    row.appendChild(btn);
    shopList.appendChild(row);
  }
}

async function buyPrefix(prefixId) {
  if (!shopState) return;
  const t = I18N[profile.lang] || I18N.ru;
  const resp = await fetch('/api/shop/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: accountKey, prefix_id: prefixId })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    if (data.error === 'no_funds') alert(t.shopNoFunds);
    return;
  }

  shopState.balance = Number.isFinite(data.balance) ? data.balance : shopState.balance;
  profile.balance = shopState.balance;
  const item = shopState.prefixes.find((p) => p.id === prefixId);
  if (item) item.owned = true;
  renderBalance();
  renderShop();
}

async function activatePrefix(prefixId) {
  if (!shopState) return;
  const resp = await fetch('/api/shop/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: accountKey, prefix_id: prefixId })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) return;

  shopState.active_prefix_id = prefixId;
  profile.prefix = data.prefix || profile.prefix || '';
  updateRenderedMessages(profile.key, profile.nick, profile.avatar_url, profile.prefix);
  renderShop();
}

function setAvatarHint(name) {
  const t = I18N[profile.lang] || I18N.ru;
  if (name) {
    hintAvatar.textContent = t.avatarHintSelected.replace('{name}', name);
  } else {
    hintAvatar.textContent = t.avatarHint;
  }
}

function applyLang(lang) {
  const t = I18N[lang] || I18N.ru;

  settingsBtn.setAttribute('aria-label', t.settings);
  settingsBtn.setAttribute('title', t.settings);
  shopBtn.textContent = t.shop;
  renderBalance();

  inputEl.placeholder = t.msgPlaceholder;
  document.getElementById('send').textContent = t.send;

  modalTitle.textContent = t.title;
  labelKey.textContent = t.key;
  hintKey.textContent = t.keyHint;
  labelNick.textContent = t.nick;
  labelLang.textContent = t.lang;
  labelAvatar.textContent = t.avatar;
  hintAvatar.textContent = t.avatarHint;
  avatarFileBtn.textContent = t.avatarChoose;
  setAvatarHint(pendingAvatarFile ? pendingAvatarFile.name : null);
  cancelBtn.textContent = t.cancel;
  saveBtn.textContent = t.save;
  hintNick.textContent = t.nickHint;
  hintLang.textContent = t.langHint;

  if (!shopModal.classList.contains('hidden')) renderShop();
}

function renderYouLine() {
  const t = I18N[profile.lang] || I18N.ru;
  youLineEl.textContent = `${t.you}: [${profile.nick}]`;
}

function hello() {
  socket.emit('hello', { key: accountKey, nick: profile.nick, lang: profile.lang });
}

// Render message (XSS safe)
function appendMessage(msg) {
  if (!msg || typeof msg !== 'object') return;

  const nickText = typeof msg.nick === 'string' ? msg.nick : 'anon';
  const avatarUrl = typeof msg.avatar_url === 'string' ? msg.avatar_url : '';
  const userKey = typeof msg.user_key === 'string' ? msg.user_key : '';
  const prefixText = typeof msg.prefix === 'string' ? msg.prefix : '';
  const bodyText = typeof msg.text === 'string' ? msg.text : '';
  const ts = typeof msg.ts === 'string' ? msg.ts : new Date().toISOString();

  const wrap = document.createElement('div');
  wrap.className = 'msg';
  if (userKey) wrap.dataset.userKey = userKey;
  if (prefixText) wrap.dataset.prefix = prefixText;

  const meta = document.createElement('div');
  meta.className = 'meta';

  const left = document.createElement('div');
  left.className = 'metaLeft';

  if (avatarUrl) {
    const badge = document.createElement('span');
    badge.className = 'avatarBadge';

    const img = document.createElement('img');
    img.alt = '';
    img.src = avatarUrl;
    img.loading = 'lazy';
    badge.appendChild(img);

    left.appendChild(badge);
  }

  const isMe = userKey ? userKey === profile.key : nickText === profile.nick;
  const nickEl = document.createElement('span');
  nickEl.className = 'nick' + (isMe ? ' me' : '');
  nickEl.textContent = formatNick(nickText, prefixText);

  left.appendChild(nickEl);

  const timeEl = document.createElement('span');
  timeEl.className = 'time';
  timeEl.textContent = formatLocal(ts);

  meta.appendChild(left);
  meta.appendChild(timeEl);

  const textEl = document.createElement('div');
  textEl.className = 'text';
  textEl.textContent = bodyText;

  wrap.appendChild(meta);
  wrap.appendChild(textEl);
  messagesEl.appendChild(wrap);
}

function updateRenderedMessages(key, nick, avatarUrl, prefix) {
  if (!key) return;
  const nodes = messagesEl.querySelectorAll(`[data-user-key="${key}"]`);
  if (!nodes.length) return;

  for (const wrap of nodes) {
    const left = wrap.querySelector('.metaLeft');
    const nickEl = wrap.querySelector('.nick');
    const prefixText = typeof prefix === 'string' ? prefix : wrap.dataset.prefix || '';

    if (nickEl && nick) {
      nickEl.textContent = formatNick(nick, prefixText);
      nickEl.classList.toggle('me', key === profile.key);
    }
    if (typeof prefix === 'string') {
      if (prefix) wrap.dataset.prefix = prefix;
      else delete wrap.dataset.prefix;
    }

    if (!left) continue;
    let badge = wrap.querySelector('.avatarBadge');

    if (avatarUrl) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'avatarBadge';
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        badge.appendChild(img);
        left.insertBefore(badge, left.firstChild);
      }
      const img = badge.querySelector('img');
      if (img) img.src = avatarUrl;
    } else if (badge) {
      badge.remove();
    }
  }
}

function formatNick(nick, prefix) {
  if (prefix) return `${nick} | ${prefix}`;
  return nick;
}

function scrollToBottom(force) {
  const nearBottom = messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 80;
  if (force || nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(connected) {
  const t = I18N[profile.lang] || I18N.ru;
  statusEl.classList.toggle('connected', connected);
  statusEl.classList.toggle('disconnected', !connected);
  renderBalance();
}

function renderBalance() {
  const t = I18N[profile.lang] || I18N.ru;
  const val = Number.isFinite(profile.balance) ? profile.balance : 0;
  statusEl.textContent = `${t.balance}${val}`;
  if (!shopModal.classList.contains('hidden') && shopState) {
    shopBalance.textContent = t.shopBalance.replace('{balance}', String(val));
  }
}

// Helpers
function getOrCreateKey() {
  const existing = localStorage.getItem(STORAGE_KEY_KEY);
  const normalized = normalizeKey(existing);
  if (normalized) return normalized;

  const k = randomHex(16);
  localStorage.setItem(STORAGE_KEY_KEY, k);
  return k;
}

function normalizeKey(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase();
  if (/^[a-f0-9]{32}$/.test(s)) return s;
  return '';
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(arr);
  else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getFallbackNick() {
  const existing = localStorage.getItem(STORAGE_KEY_FALLBACK_NICK);
  if (existing && typeof existing === 'string') return sanitizeNick(existing);

  const prefixes = ['ghost', 'nullbyte', 'node', 'root', 'hex', 'kernel', 'proxy', 'cipher', 'daemon'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = randomHex(2);
  const nick = `${prefix}_${suffix}`;
  localStorage.setItem(STORAGE_KEY_FALLBACK_NICK, nick);
  return nick;
}

function sanitizeNick(n) {
  if (typeof n !== 'string') return 'anon';
  let cleaned = n.trim().slice(0, 32);
  cleaned = cleaned.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleaned) cleaned = 'anon';
  return cleaned;
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  let t = text.replace(/\r\n/g, '\n');
  if (t.length > MAX_MESSAGE_LENGTH) t = t.slice(0, MAX_MESSAGE_LENGTH);
  if (t.trim().length === 0) return '';
  return t;
}

function formatLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '---- -- --:--';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

// Init
function updateViewportVars() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--vvh', `${height * 0.01}px`);
}

updateViewportVars();
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateViewportVars);
  window.visualViewport.addEventListener('scroll', updateViewportVars);
}
window.addEventListener('resize', updateViewportVars);

applyLang(profile.lang);
renderYouLine();
refreshAvatarPreview();

/**
 * Popup UI controller.
 *
 * Handles all user interactions in the popup: account selection,
 * mode switching, per-site overrides, account detection/management,
 * quick-switch for current site, and profile picture display.
 */
import { GOOGLE_DOMAINS, STORAGE_KEYS, MAX_ACCOUNT_INDEX } from '../lib/constants.js';
import { getStorage, setStorage } from '../lib/storage.js';

// ─── DOM References ───
const enableToggle = document.getElementById('enableToggle');
const modeSelect = document.getElementById('modeSelect');
const accountListEl = document.getElementById('accountList');
const emptyState = document.getElementById('emptyState');
const detectBtn = document.getElementById('detectBtn');
const addAccountBtn = document.getElementById('addAccountBtn');
const addAccountForm = document.getElementById('addAccountForm');
const saveAccountBtn = document.getElementById('saveAccountBtn');
const cancelAccountBtn = document.getElementById('cancelAccountBtn');
const newIndexInput = document.getElementById('newIndex');
const newEmailInput = document.getElementById('newEmail');
const newLabelInput = document.getElementById('newLabel');
const overrideListEl = document.getElementById('overrideList');
const addOverrideBtn = document.getElementById('addOverrideBtn');
const addOverrideForm = document.getElementById('addOverrideForm');
const overrideSiteSelect = document.getElementById('overrideSite');
const overrideAccountInput = document.getElementById('overrideAccount');
const saveOverrideBtn = document.getElementById('saveOverrideBtn');
const cancelOverrideBtn = document.getElementById('cancelOverrideBtn');
const statusBar = document.getElementById('statusBar');
const quickSwitchSection = document.getElementById('quickSwitchSection');
const quickSwitchSelect = document.getElementById('quickSwitchSelect');
const currentSiteName = document.getElementById('currentSiteName');

// ─── State ───
let currentSettings = {};
let currentTab = null;

// ─── Status Messages ───
let statusTimeout = null;

function showStatus(message, type = 'info') {
  statusBar.textContent = message;
  statusBar.className = `status-bar ${type}`;
  statusBar.classList.remove('hidden');

  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    statusBar.classList.add('hidden');
  }, 3000);
}

// ─── Utility: Generate initials from email ───
function getInitials(email) {
  if (!email) return '?';
  const parts = email.split('@')[0].split('.');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return email[0].toUpperCase();
}

// ─── Account List Rendering ───

function renderAccounts(accounts, defaultAccount) {
  // Remove existing account items (keep empty state)
  const existingItems = accountListEl.querySelectorAll('.account-item');
  existingItems.forEach((item) => item.remove());

  if (!accounts || accounts.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  accounts.forEach((account) => {
    const item = document.createElement('div');
    item.className = `account-item${account.index === defaultAccount ? ' selected' : ''}`;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'defaultAccount';
    radio.value = account.index;
    radio.checked = account.index === defaultAccount;
    radio.addEventListener('change', () => selectAccount(account.index));

    // Avatar (profile picture or initials)
    const avatar = document.createElement('div');
    avatar.className = 'account-avatar';

    if (account.photo) {
      const img = document.createElement('img');
      img.src = account.photo;
      img.alt = account.name || account.email || '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => {
        // Fallback to initials on load error
        img.replaceWith(createInitialsEl(account));
      };
      avatar.appendChild(img);
    } else {
      avatar.appendChild(createInitialsEl(account));
    }

    const info = document.createElement('div');
    info.className = 'account-info';

    const primary = document.createElement('span');
    primary.className = 'account-primary';
    primary.textContent = account.label || account.name || account.email || `Account ${account.index}`;

    const secondary = document.createElement('span');
    secondary.className = 'account-secondary';
    if (account.label && account.email) {
      secondary.textContent = account.email;
    } else if (account.email && account.name) {
      secondary.textContent = account.email;
    } else {
      secondary.textContent = `Index: ${account.index}`;
    }

    info.appendChild(primary);
    info.appendChild(secondary);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'account-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit label';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editAccountLabel(account);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Remove';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAccount(account.index);
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(radio);
    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(actions);

    // Click entire row to select
    item.addEventListener('click', () => {
      radio.checked = true;
      selectAccount(account.index);
    });

    accountListEl.appendChild(item);
  });
}

/**
 * Create an initials element for accounts without a profile picture.
 */
function createInitialsEl(account) {
  const initialsEl = document.createElement('span');
  initialsEl.className = 'account-initials';
  initialsEl.textContent = getInitials(account.email || account.name);
  return initialsEl;
}

async function selectAccount(index) {
  const prevAccount = currentSettings.defaultAccount;
  currentSettings.defaultAccount = index;
  await setStorage({ [STORAGE_KEYS.DEFAULT_ACCOUNT]: index });
  renderAccounts(currentSettings.accounts, index);
  showStatus(`Default account set to ${index}`, 'success');

  // Auto-refresh current tab if it's a Google/YouTube page and account changed
  if (prevAccount !== index && currentTab?.id && currentTab?.url) {
    refreshCurrentTab();
  }
}

/**
 * Refresh the current tab if it's a Google/YouTube page.
 */
function refreshCurrentTab() {
  if (!currentTab?.url) return;
  try {
    const url = new URL(currentTab.url);
    const isGoogle = url.hostname.includes('google.com') ||
                     url.hostname.includes('youtube.com') ||
                     url.hostname.includes('gmail.com');
    if (isGoogle) {
      showStatus('Refreshing page...', 'info');
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'refreshTab', tabId: currentTab.id });
      }, 300);
    }
  } catch { /* invalid URL — skip */ }
}

async function removeAccount(index) {
  const accounts = currentSettings.accounts.filter((a) => a.index !== index);
  currentSettings.accounts = accounts;
  await setStorage({ [STORAGE_KEYS.ACCOUNTS]: accounts });

  // If the removed account was the default, reset to first available or 0
  if (currentSettings.defaultAccount === index) {
    const newDefault = accounts.length > 0 ? accounts[0].index : 0;
    currentSettings.defaultAccount = newDefault;
    await setStorage({ [STORAGE_KEYS.DEFAULT_ACCOUNT]: newDefault });
  }

  renderAccounts(accounts, currentSettings.defaultAccount);
  showStatus('Account removed', 'info');
}

function editAccountLabel(account) {
  const newLabel = prompt('Enter label for this account:', account.label || '');
  if (newLabel === null) return; // Cancelled

  const accounts = currentSettings.accounts.map((a) => {
    if (a.index === account.index) {
      return { ...a, label: newLabel };
    }
    return a;
  });

  currentSettings.accounts = accounts;
  setStorage({ [STORAGE_KEYS.ACCOUNTS]: accounts });
  renderAccounts(accounts, currentSettings.defaultAccount);
  showStatus('Label updated', 'success');
}

// ─── Add Account ───

function showAddAccountForm() {
  // Pre-fill index with next available
  const existingIndices = (currentSettings.accounts || []).map((a) => a.index);
  let nextIndex = 0;
  while (existingIndices.includes(nextIndex) && nextIndex <= MAX_ACCOUNT_INDEX) {
    nextIndex++;
  }
  newIndexInput.value = nextIndex;
  newEmailInput.value = '';
  newLabelInput.value = '';

  addAccountForm.classList.remove('hidden');
  newEmailInput.focus();
}

async function saveNewAccount() {
  const index = parseInt(newIndexInput.value, 10);
  const email = newEmailInput.value.trim();
  const label = newLabelInput.value.trim();

  if (isNaN(index) || index < 0 || index > MAX_ACCOUNT_INDEX) {
    showStatus(`Index must be 0-${MAX_ACCOUNT_INDEX}`, 'error');
    return;
  }

  // Check for duplicate index
  const accounts = currentSettings.accounts || [];
  if (accounts.some((a) => a.index === index)) {
    showStatus(`Account with index ${index} already exists`, 'error');
    return;
  }

  accounts.push({ index, email, name: '', photo: '', label });
  accounts.sort((a, b) => a.index - b.index);
  currentSettings.accounts = accounts;

  await setStorage({ [STORAGE_KEYS.ACCOUNTS]: accounts });
  addAccountForm.classList.add('hidden');
  renderAccounts(accounts, currentSettings.defaultAccount);
  showStatus('Account added', 'success');
}

// ─── Override List Rendering ───

function renderOverrides(siteOverrides, accounts) {
  overrideListEl.innerHTML = '';

  const entries = Object.entries(siteOverrides || {});
  if (entries.length === 0) {
    return;
  }

  entries.forEach(([host, accountIndex]) => {
    const item = document.createElement('div');
    item.className = 'override-item';

    const site = document.createElement('span');
    site.className = 'override-site';
    site.textContent = host;

    const arrow = document.createElement('span');
    arrow.className = 'override-arrow';
    arrow.textContent = '→';

    const accountLabel = accounts?.find((a) => a.index === accountIndex);
    const acct = document.createElement('span');
    acct.className = 'override-account';
    acct.textContent = accountLabel
      ? `${accountIndex} (${accountLabel.label || accountLabel.email || accountLabel.name})`
      : `Account ${accountIndex}`;

    const right = document.createElement('div');
    right.className = 'override-right';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove override';
    delBtn.addEventListener('click', () => removeOverride(host));

    right.appendChild(acct);
    right.appendChild(arrow.cloneNode(false)); // spacer
    right.appendChild(delBtn);

    item.appendChild(site);
    item.appendChild(arrow);
    item.appendChild(right);

    overrideListEl.appendChild(item);
  });
}

async function removeOverride(host) {
  const overrides = { ...currentSettings.siteOverrides };
  delete overrides[host];
  currentSettings.siteOverrides = overrides;
  await setStorage({ [STORAGE_KEYS.SITE_OVERRIDES]: overrides });
  renderOverrides(overrides, currentSettings.accounts);
  showStatus(`Override removed for ${host}`, 'info');
  refreshCurrentTab();
}

// ─── Add Override ───

function populateOverrideSites() {
  overrideSiteSelect.innerHTML = '';

  // Get unique non-excluded hosts
  const hosts = [...new Set(
    GOOGLE_DOMAINS
      .filter((d) => d.type !== 'excluded')
      .map((d) => d.host)
  )];

  hosts.forEach((host) => {
    const option = document.createElement('option');
    option.value = host;
    option.textContent = host;
    // Disable if already has an override
    if (currentSettings.siteOverrides && host in currentSettings.siteOverrides) {
      option.disabled = true;
      option.textContent += ' (has override)';
    }
    overrideSiteSelect.appendChild(option);
  });
}

function showAddOverrideForm() {
  populateOverrideSites();
  overrideAccountInput.value = currentSettings.defaultAccount || 0;
  addOverrideForm.classList.remove('hidden');
}

async function saveNewOverride() {
  const host = overrideSiteSelect.value;
  const accountIndex = parseInt(overrideAccountInput.value, 10);

  if (!host) {
    showStatus('Select a site', 'error');
    return;
  }

  if (isNaN(accountIndex) || accountIndex < 0 || accountIndex > MAX_ACCOUNT_INDEX) {
    showStatus(`Account index must be 0-${MAX_ACCOUNT_INDEX}`, 'error');
    return;
  }

  const overrides = { ...(currentSettings.siteOverrides || {}), [host]: accountIndex };
  currentSettings.siteOverrides = overrides;
  await setStorage({ [STORAGE_KEYS.SITE_OVERRIDES]: overrides });

  addOverrideForm.classList.add('hidden');
  renderOverrides(overrides, currentSettings.accounts);
  showStatus(`Override added: ${host} → Account ${accountIndex}`, 'success');
  refreshCurrentTab();
}

// ─── Quick Switch for Current Site ───

/**
 * Find the matching domain config for the current tab's URL.
 */
function findCurrentSiteDomain(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;

    // Handle gmail.com → mail.google.com mapping
    if (host === 'gmail.com' || host.endsWith('.gmail.com')) {
      return GOOGLE_DOMAINS.find((d) => d.host === 'mail.google.com');
    }

    // Find matching domains
    const matches = GOOGLE_DOMAINS.filter(
      (d) => d.host === host && d.type !== 'excluded'
    );
    if (matches.length === 0) return null;

    // Prefer most specific pathPrefix match
    const pathMatches = matches.filter((d) => d.type === 'path');
    if (pathMatches.length > 0) {
      const sorted = pathMatches.sort(
        (a, b) => (b.pathPrefix || '').length - (a.pathPrefix || '').length
      );
      for (const entry of sorted) {
        if (!entry.pathPrefix || parsed.pathname.startsWith(entry.pathPrefix)) {
          return entry;
        }
      }
    }

    // Query-based match
    const queryMatches = matches.filter((d) => d.type === 'query');
    if (queryMatches.length > 0) {
      const withPrefix = queryMatches
        .filter((d) => d.pathPrefix && parsed.pathname.startsWith(d.pathPrefix))
        .sort((a, b) => (b.pathPrefix || '').length - (a.pathPrefix || '').length);
      if (withPrefix.length > 0) return withPrefix[0];
      return queryMatches.find((d) => !d.pathPrefix) || queryMatches[0];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Render the Quick Switch section based on current tab.
 */
function renderQuickSwitch() {
  if (!currentTab?.url) {
    quickSwitchSection.style.display = 'none';
    return;
  }

  try {
    const urlObj = new URL(currentTab.url);
    if (!urlObj.protocol.startsWith('http')) {
      quickSwitchSection.style.display = 'none';
      return;
    }
  } catch {
    quickSwitchSection.style.display = 'none';
    return;
  }

  const domain = findCurrentSiteDomain(currentTab.url);
  if (!domain) {
    quickSwitchSection.style.display = 'none';
    return;
  }

  // Show the quick switch section
  quickSwitchSection.style.display = '';

  // Display site name
  const siteLabel = domain.pathPrefix
    ? `${domain.host}${domain.pathPrefix}`
    : domain.host;
  currentSiteName.textContent = siteLabel;

  // Build account options
  const currentOverride = currentSettings.siteOverrides?.[domain.host];
  let options = `<option value="" ${currentOverride === undefined ? 'selected' : ''}>Use default (Account ${currentSettings.defaultAccount})</option>`;

  (currentSettings.accounts || []).forEach((acc) => {
    const label = acc.label || acc.email || acc.name || `Account ${acc.index}`;
    const isSelected = currentOverride === acc.index;
    options += `<option value="${acc.index}" ${isSelected ? 'selected' : ''}>${acc.index}: ${label}</option>`;
  });

  quickSwitchSelect.innerHTML = options;
}

/**
 * Handle quick switch account change for current site.
 */
async function handleQuickSwitch(value) {
  if (!currentTab?.url) return;

  const domain = findCurrentSiteDomain(currentTab.url);
  if (!domain) return;

  const overrides = { ...(currentSettings.siteOverrides || {}) };

  if (value === '') {
    // Remove override — use default
    delete overrides[domain.host];
    showStatus(`Removed override for ${domain.host}`, 'info');
  } else {
    const index = parseInt(value, 10);
    overrides[domain.host] = index;
    const acc = currentSettings.accounts?.find((a) => a.index === index);
    const label = acc?.label || acc?.email || `Account ${index}`;
    showStatus(`${domain.host} → ${label}`, 'success');
  }

  currentSettings.siteOverrides = overrides;
  await setStorage({ [STORAGE_KEYS.SITE_OVERRIDES]: overrides });
  renderOverrides(overrides, currentSettings.accounts);

  // Auto-refresh current tab
  refreshCurrentTab();
}

// ─── Account Detection ───

async function handleDetect() {
  detectBtn.classList.add('loading');
  detectBtn.textContent = '⏳ Detecting...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'detectAccounts' });

    if (response?.success && response.accounts) {
      currentSettings.accounts = response.accounts;
      renderAccounts(response.accounts, currentSettings.defaultAccount);
      renderQuickSwitch(); // Re-render with new accounts
      showStatus(`Found ${response.accounts.length} account(s)`, 'success');
    } else {
      showStatus('Could not detect accounts. Are you logged in to Google?', 'error');
    }
  } catch (error) {
    showStatus('Detection failed: ' + error.message, 'error');
  } finally {
    detectBtn.classList.remove('loading');
    detectBtn.textContent = '🔍 Detect';
  }
}

// ─── Event Listeners ───

enableToggle.addEventListener('change', async () => {
  currentSettings.enabled = enableToggle.checked;
  await setStorage({ [STORAGE_KEYS.ENABLED]: enableToggle.checked });
  showStatus(enableToggle.checked ? 'Enabled' : 'Disabled', 'info');
});

modeSelect.addEventListener('change', async () => {
  currentSettings.mode = modeSelect.value;
  await setStorage({ [STORAGE_KEYS.MODE]: modeSelect.value });
  showStatus(`Mode: ${modeSelect.value}`, 'info');
});

detectBtn.addEventListener('click', handleDetect);
addAccountBtn.addEventListener('click', showAddAccountForm);
saveAccountBtn.addEventListener('click', saveNewAccount);
cancelAccountBtn.addEventListener('click', () => addAccountForm.classList.add('hidden'));

addOverrideBtn.addEventListener('click', showAddOverrideForm);
saveOverrideBtn.addEventListener('click', saveNewOverride);
cancelOverrideBtn.addEventListener('click', () => addOverrideForm.classList.add('hidden'));

quickSwitchSelect.addEventListener('change', (e) => {
  handleQuickSwitch(e.target.value);
});

// ─── Initialize ───

async function initPopup() {
  try {
    // Load settings and current tab in parallel
    const [settings, tabs] = await Promise.all([
      getStorage([
        STORAGE_KEYS.ENABLED,
        STORAGE_KEYS.MODE,
        STORAGE_KEYS.DEFAULT_ACCOUNT,
        STORAGE_KEYS.ACCOUNTS,
        STORAGE_KEYS.SITE_OVERRIDES,
      ]),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);

    currentSettings = settings;
    currentTab = tabs[0] || null;

    // Set UI state
    enableToggle.checked = settings.enabled !== false;
    modeSelect.value = settings.mode || 'proactive';

    // Render lists
    renderAccounts(settings.accounts || [], settings.defaultAccount || 0);
    renderOverrides(settings.siteOverrides || {}, settings.accounts || []);
    renderQuickSwitch();
  } catch (error) {
    console.error('[G-Account Switcher] Popup init error:', error);
    showStatus('Failed to load settings', 'error');
  }
}

initPopup();

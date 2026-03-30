/**
 * Popup UI controller.
 *
 * Handles all user interactions in the popup: per-site account selection
 * via icon-based avatar selector, site settings management, account
 * detection/management, collapsible global default section, and mode switching.
 */
import { GOOGLE_DOMAINS, STORAGE_KEYS, MAX_ACCOUNT_INDEX, SITE_DISABLED } from '../lib/constants.js';
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
const siteSettingListEl = document.getElementById('siteSettingList');
const addSiteSettingBtn = document.getElementById('addSiteSettingBtn');
const addSiteSettingForm = document.getElementById('addSiteSettingForm');
const settingSiteSelect = document.getElementById('settingSite');
const settingAccountInput = document.getElementById('settingAccount');
const saveSiteSettingBtn = document.getElementById('saveSiteSettingBtn');
const cancelSiteSettingBtn = document.getElementById('cancelSiteSettingBtn');
const siteSettingEmpty = document.getElementById('siteSettingEmpty');
const statusBar = document.getElementById('statusBar');
const currentSiteSection = document.getElementById('currentSiteSection');
const siteAccountIconsEl = document.getElementById('siteAccountIcons');
const currentSiteName = document.getElementById('currentSiteName');
const currentSiteStatus = document.getElementById('currentSiteStatus');
const globalSection = document.getElementById('globalSection');
const globalHeader = document.getElementById('globalHeader');
const globalArrow = document.getElementById('globalArrow');
const globalBody = document.getElementById('globalBody');
const globalAccountToggle = document.getElementById('globalAccountToggle');
const globalAccountRow = document.getElementById('globalAccountRow');
const globalAccountSelect = document.getElementById('globalAccountSelect');
const globalStatusBadge = document.getElementById('globalStatusBadge');

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

// ─── Utility: Get short label for an account ───
function getShortLabel(account) {
  if (account.label) return account.label;
  if (account.name) return account.name.split(' ')[0];
  if (account.email) return account.email.split('@')[0];
  return `#${account.index}`;
}

// ─── Current Site — Icon-based Account Selector ───

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
 * Render the Current Site panel with icon-based account selector.
 */
function renderCurrentSite() {
  if (!currentTab?.url) {
    currentSiteSection.style.display = 'none';
    return;
  }

  try {
    const urlObj = new URL(currentTab.url);
    if (!urlObj.protocol.startsWith('http')) {
      currentSiteSection.style.display = 'none';
      return;
    }
  } catch {
    currentSiteSection.style.display = 'none';
    return;
  }

  const domain = findCurrentSiteDomain(currentTab.url);
  if (!domain) {
    currentSiteSection.style.display = 'none';
    return;
  }

  // Show the current site section
  currentSiteSection.style.display = '';

  // Display site name
  const siteLabel = domain.pathPrefix
    ? `${domain.host}${domain.pathPrefix}`
    : domain.host;
  currentSiteName.textContent = siteLabel;

  // Determine current selection
  const currentSetting = currentSettings.siteSettings?.[domain.host];
  const accounts = currentSettings.accounts || [];

  // Build icon row
  siteAccountIconsEl.innerHTML = '';

  // "Default" option (no site-specific setting)
  const defaultIcon = createSiteIcon({
    value: '',
    label: '—',
    caption: currentSettings.globalAccountEnabled ? `Default (${currentSettings.defaultAccount})` : 'None',
    isSpecial: true,
    isSelected: currentSetting === undefined,
    specialClass: currentSetting === undefined ? 'special-default' : '',
  });
  siteAccountIconsEl.appendChild(defaultIcon);

  // Per-account icons
  accounts.forEach((acc) => {
    const icon = createAccountSiteIcon(acc, currentSetting === acc.index);
    siteAccountIconsEl.appendChild(icon);
  });

  // "Disable" option
  const disableIcon = createSiteIcon({
    value: SITE_DISABLED.toString(),
    label: '🚫',
    caption: 'Off',
    isSpecial: true,
    isSelected: currentSetting === SITE_DISABLED,
  });
  siteAccountIconsEl.appendChild(disableIcon);

  // Status line
  updateCurrentSiteStatusText(domain.host, currentSetting, accounts);
}

/**
 * Create an icon button for a specific account in the current site selector.
 */
function createAccountSiteIcon(account, isSelected) {
  const btn = document.createElement('button');
  btn.className = `site-account-icon${isSelected ? ' selected' : ''}`;
  btn.dataset.value = account.index.toString();
  btn.title = account.email || account.name || `Account ${account.index}`;

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'account-avatar';

  if (account.photo) {
    const img = document.createElement('img');
    img.src = account.photo;
    img.alt = account.name || account.email || '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      img.replaceWith(createInitialsEl(account));
    };
    avatar.appendChild(img);
  } else {
    avatar.appendChild(createInitialsEl(account));
  }

  btn.appendChild(avatar);

  // Index badge
  const indexBadge = document.createElement('span');
  indexBadge.className = 'account-index';
  indexBadge.textContent = account.index.toString();
  btn.appendChild(indexBadge);

  // Caption
  const caption = document.createElement('span');
  caption.className = 'icon-caption';
  caption.textContent = getShortLabel(account);
  btn.appendChild(caption);

  // Click handler
  btn.addEventListener('click', () => handleCurrentSiteSelection(account.index));

  return btn;
}

/**
 * Create a special icon button (Default / Disable) for the current site selector.
 */
function createSiteIcon({ value, label, caption, isSpecial, isSelected, specialClass }) {
  const btn = document.createElement('button');
  btn.className = `site-account-icon${isSpecial ? ' special' : ''}${isSelected ? ' selected' : ''}${specialClass ? ' ' + specialClass : ''}`;
  btn.dataset.value = value;
  btn.title = caption;

  const iconLabel = document.createElement('span');
  iconLabel.className = 'icon-label';
  iconLabel.textContent = label;
  btn.appendChild(iconLabel);

  const captionEl = document.createElement('span');
  captionEl.className = 'icon-caption';
  captionEl.textContent = caption;
  btn.appendChild(captionEl);

  btn.addEventListener('click', () => {
    if (value === '') {
      handleCurrentSiteSelection(null); // Remove site setting
    } else {
      handleCurrentSiteSelection(parseInt(value, 10));
    }
  });

  return btn;
}

/**
 * Update the status text below the icon selector.
 */
function updateCurrentSiteStatusText(host, currentSetting, accounts) {
  if (currentSetting === SITE_DISABLED) {
    currentSiteStatus.textContent = '🚫 Redirection disabled for this site';
  } else if (currentSetting !== undefined) {
    const acc = accounts.find((a) => a.index === currentSetting);
    const label = acc ? (acc.label || acc.email || acc.name) : `Account ${currentSetting}`;
    currentSiteStatus.textContent = `✓ Using: ${label} (Account ${currentSetting})`;
  } else if (currentSettings.globalAccountEnabled) {
    currentSiteStatus.textContent = `Using global default (Account ${currentSettings.defaultAccount})`;
  } else {
    currentSiteStatus.textContent = 'No setting — using browser default';
  }
}

/**
 * Handle clicking an account icon in the current site selector.
 */
async function handleCurrentSiteSelection(accountIndex) {
  if (!currentTab?.url) return;

  const domain = findCurrentSiteDomain(currentTab.url);
  if (!domain) return;

  const siteSettings = { ...(currentSettings.siteSettings || {}) };
  let shouldRefresh = true;

  if (accountIndex === null) {
    // Remove site setting — use default
    delete siteSettings[domain.host];
    showStatus(`Removed setting for ${domain.host}`, 'info');
  } else if (accountIndex === SITE_DISABLED) {
    // Disable redirection
    siteSettings[domain.host] = SITE_DISABLED;
    showStatus(`Redirection disabled for ${domain.host}`, 'info');
    shouldRefresh = false;
  } else {
    // Set specific account
    siteSettings[domain.host] = accountIndex;
    const acc = currentSettings.accounts?.find((a) => a.index === accountIndex);
    const label = acc?.label || acc?.email || `Account ${accountIndex}`;
    showStatus(`${domain.host} → ${label}`, 'success');
  }

  currentSettings.siteSettings = siteSettings;
  await updateSettingsAndWait({ [STORAGE_KEYS.SITE_SETTINGS]: siteSettings });
  renderCurrentSite();
  renderSiteSettings(siteSettings, currentSettings.accounts);

  // Auto-refresh current tab (skip when disabling redirection)
  if (shouldRefresh) {
    refreshCurrentTabNow();
  }
}

// ─── Account List Rendering ───

function renderAccounts(accounts) {
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
    item.className = 'account-item';

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

    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(actions);

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

/**
 * Update settings and wait for background rules to be applied.
 */
async function updateSettingsAndWait(settingsObj) {
  const rulesPromise = new Promise(resolve => {
    const listener = (msg) => {
      if (msg.type === 'rulesUpdated') {
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve();
    }, 1000); // fallback timeout
  });

  await setStorage(settingsObj);
  await rulesPromise;
}

/**
 * Refresh the current tab immediately if it's a Google/YouTube page.
 */
function refreshCurrentTabNow() {
  if (!currentTab?.url) return;
  try {
    const url = new URL(currentTab.url);
    const isGoogle = url.hostname.includes('google.com') ||
                     url.hostname.includes('youtube.com') ||
                     url.hostname.includes('gmail.com');
    if (isGoogle) {
      showStatus('Refreshing page...', 'info');
      chrome.runtime.sendMessage({ type: 'refreshTab', tabId: currentTab.id });
    }
  } catch { /* invalid URL — skip */ }
}

async function removeAccount(index) {
  const accounts = currentSettings.accounts.filter((a) => a.index !== index);
  currentSettings.accounts = accounts;
  await setStorage({ [STORAGE_KEYS.ACCOUNTS]: accounts });

  // If the removed account was the global default, reset to first available or 0
  if (currentSettings.defaultAccount === index) {
    const newDefault = accounts.length > 0 ? accounts[0].index : 0;
    currentSettings.defaultAccount = newDefault;
    await updateSettingsAndWait({ [STORAGE_KEYS.DEFAULT_ACCOUNT]: newDefault });
  }

  renderAccounts(accounts);
  renderCurrentSite();
  renderGlobalSection();
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
  renderAccounts(accounts);
  renderCurrentSite();
  renderGlobalSection();
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
  renderAccounts(accounts);
  renderCurrentSite();
  renderGlobalSection();
  showStatus('Account added', 'success');
}

// ─── Site Settings Rendering ───

function renderSiteSettings(siteSettings, accounts) {
  // Remove existing items (keep empty state element)
  const existingItems = siteSettingListEl.querySelectorAll('.site-setting-item');
  existingItems.forEach((item) => item.remove());

  const entries = Object.entries(siteSettings || {});
  if (entries.length === 0) {
    siteSettingEmpty.classList.remove('hidden');
    return;
  }

  siteSettingEmpty.classList.add('hidden');

  entries.forEach(([host, accountIndex]) => {
    const item = document.createElement('div');
    item.className = 'site-setting-item';

    // Avatar
    const avatar = document.createElement('div');
    if (accountIndex === SITE_DISABLED) {
      avatar.className = 'site-setting-avatar disabled';
      avatar.textContent = '🚫';
    } else {
      avatar.className = 'site-setting-avatar';
      const acc = accounts?.find((a) => a.index === accountIndex);
      if (acc?.photo) {
        const img = document.createElement('img');
        img.src = acc.photo;
        img.alt = acc.name || acc.email || '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => {
          img.replaceWith(createInitialsEl(acc));
        };
        avatar.appendChild(img);
      } else if (acc) {
        avatar.appendChild(createInitialsEl(acc));
      } else {
        const initialsEl = document.createElement('span');
        initialsEl.className = 'account-initials';
        initialsEl.textContent = accountIndex.toString();
        avatar.appendChild(initialsEl);
      }
    }

    // Info block (site name + account label)
    const info = document.createElement('div');
    info.className = 'site-setting-info';

    const siteName = document.createElement('span');
    siteName.className = 'site-setting-site';
    siteName.textContent = host;

    const acctLabel = document.createElement('span');
    if (accountIndex === SITE_DISABLED) {
      acctLabel.className = 'site-setting-account disabled-text';
      acctLabel.textContent = 'Redirection disabled';
    } else {
      acctLabel.className = 'site-setting-account';
      const acc = accounts?.find((a) => a.index === accountIndex);
      acctLabel.textContent = acc
        ? `Account ${accountIndex} · ${acc.label || acc.email || acc.name}`
        : `Account ${accountIndex}`;
    }

    info.appendChild(siteName);
    info.appendChild(acctLabel);

    // Action buttons (visible on hover)
    const actions = document.createElement('div');
    actions.className = 'site-setting-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm';
    editBtn.textContent = '✏️';
    editBtn.title = 'Change account';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineEdit(host, accountIndex, info);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove setting';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSiteSetting(host);
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(actions);

    siteSettingListEl.appendChild(item);
  });
}

/**
 * Start inline editing for a site setting — replaces the account label
 * with a <select> dropdown for quick account switching.
 */
function startInlineEdit(host, currentAccountIndex, infoEl) {
  const accounts = currentSettings.accounts || [];

  // Replace the account label with a select
  const select = document.createElement('select');
  select.className = 'site-setting-inline-select';

  // Account options
  accounts.forEach((acc) => {
    const opt = document.createElement('option');
    opt.value = acc.index.toString();
    opt.textContent = `${acc.index}: ${acc.label || acc.email || acc.name || 'Account ' + acc.index}`;
    if (acc.index === currentAccountIndex) opt.selected = true;
    select.appendChild(opt);
  });

  // Disable option
  const disableOpt = document.createElement('option');
  disableOpt.value = SITE_DISABLED.toString();
  disableOpt.textContent = '🚫 Disable redirection';
  if (currentAccountIndex === SITE_DISABLED) disableOpt.selected = true;
  select.appendChild(disableOpt);

  // Replace info content with select
  const originalContent = infoEl.innerHTML;
  infoEl.innerHTML = '';

  const siteName = document.createElement('span');
  siteName.className = 'site-setting-site';
  siteName.textContent = host;
  infoEl.appendChild(siteName);
  infoEl.appendChild(select);

  select.focus();

  // Handle selection
  const commitEdit = async () => {
    const newIndex = parseInt(select.value, 10);
    if (newIndex !== currentAccountIndex) {
      const siteSettings = { ...(currentSettings.siteSettings || {}), [host]: newIndex };
      currentSettings.siteSettings = siteSettings;
      await updateSettingsAndWait({ [STORAGE_KEYS.SITE_SETTINGS]: siteSettings });
      renderCurrentSite();
      showStatus(`${host} → ${newIndex === SITE_DISABLED ? 'Disabled' : 'Account ' + newIndex}`, 'success');
      refreshCurrentTabNow();
    }
    renderSiteSettings(currentSettings.siteSettings, currentSettings.accounts);
  };

  select.addEventListener('change', commitEdit);
  select.addEventListener('blur', () => {
    // Restore original content if no change was committed
    renderSiteSettings(currentSettings.siteSettings, currentSettings.accounts);
  });
}

async function removeSiteSetting(host) {
  const siteSettings = { ...currentSettings.siteSettings };
  delete siteSettings[host];
  currentSettings.siteSettings = siteSettings;
  await updateSettingsAndWait({ [STORAGE_KEYS.SITE_SETTINGS]: siteSettings });
  renderSiteSettings(siteSettings, currentSettings.accounts);
  renderCurrentSite();
  showStatus(`Setting removed for ${host}`, 'info');
  refreshCurrentTabNow();
}

// ─── Add Site Setting ───

function populateSettingSites() {
  settingSiteSelect.innerHTML = '';

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
    // Disable if already has a setting
    if (currentSettings.siteSettings && host in currentSettings.siteSettings) {
      option.disabled = true;
      option.textContent += ' (configured)';
    }
    settingSiteSelect.appendChild(option);
  });
}

function showAddSiteSettingForm() {
  populateSettingSites();
  settingAccountInput.value = currentSettings.defaultAccount || 0;
  addSiteSettingForm.classList.remove('hidden');
}

async function saveNewSiteSetting() {
  const host = settingSiteSelect.value;
  const accountIndex = parseInt(settingAccountInput.value, 10);

  if (!host) {
    showStatus('Select a site', 'error');
    return;
  }

  if (isNaN(accountIndex) || accountIndex < -1 || accountIndex > MAX_ACCOUNT_INDEX) {
    showStatus(`Account index must be -1 to ${MAX_ACCOUNT_INDEX}`, 'error');
    return;
  }

  const siteSettings = { ...(currentSettings.siteSettings || {}), [host]: accountIndex };
  currentSettings.siteSettings = siteSettings;
  await updateSettingsAndWait({ [STORAGE_KEYS.SITE_SETTINGS]: siteSettings });

  addSiteSettingForm.classList.add('hidden');
  renderSiteSettings(siteSettings, currentSettings.accounts);
  renderCurrentSite();
  showStatus(`Setting added: ${host} → Account ${accountIndex}`, 'success');
  refreshCurrentTabNow();
}

// ─── Global Section ───

function renderGlobalSection() {
  const isEnabled = currentSettings.globalAccountEnabled || false;

  // Badge
  globalStatusBadge.textContent = isEnabled ? 'on' : 'off';
  globalStatusBadge.className = `global-status${isEnabled ? ' active' : ''}`;

  // Toggle
  globalAccountToggle.checked = isEnabled;

  // Account row visibility
  if (isEnabled) {
    globalAccountRow.classList.remove('hidden');
  } else {
    globalAccountRow.classList.add('hidden');
  }

  // Populate account select
  populateGlobalAccountSelect();
}

function populateGlobalAccountSelect() {
  const accounts = currentSettings.accounts || [];
  const currentDefault = currentSettings.defaultAccount || 0;

  let options = '';
  // If no accounts detected, show basic index options
  if (accounts.length === 0) {
    for (let i = 0; i <= MAX_ACCOUNT_INDEX; i++) {
      options += `<option value="${i}" ${i === currentDefault ? 'selected' : ''}>Account ${i}</option>`;
    }
  } else {
    accounts.forEach((acc) => {
      const label = acc.label || acc.email || acc.name || `Account ${acc.index}`;
      options += `<option value="${acc.index}" ${acc.index === currentDefault ? 'selected' : ''}>${acc.index}: ${label}</option>`;
    });
  }

  globalAccountSelect.innerHTML = options;
}

function toggleGlobalBody() {
  const isHidden = globalBody.classList.contains('hidden');
  if (isHidden) {
    globalBody.classList.remove('hidden');
    globalArrow.classList.add('expanded');
  } else {
    globalBody.classList.add('hidden');
    globalArrow.classList.remove('expanded');
  }
}

// ─── Account Detection ───

async function handleDetect() {
  detectBtn.classList.add('loading');
  detectBtn.textContent = '⏳ Detecting...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'detectAccounts' });

    if (response?.success && response.accounts) {
      currentSettings.accounts = response.accounts;
      renderAccounts(response.accounts);
      renderCurrentSite();
      renderGlobalSection();
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
  await updateSettingsAndWait({ [STORAGE_KEYS.ENABLED]: enableToggle.checked });
  showStatus(enableToggle.checked ? 'Enabled' : 'Disabled', 'info');

  // Only refresh when enabling — disabling should not reload/change the URL
  if (enableToggle.checked && currentTab?.id && currentTab?.url) {
    refreshCurrentTabNow();
  }
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

addSiteSettingBtn.addEventListener('click', showAddSiteSettingForm);
saveSiteSettingBtn.addEventListener('click', saveNewSiteSetting);
cancelSiteSettingBtn.addEventListener('click', () => addSiteSettingForm.classList.add('hidden'));

// Global section — collapsible header
globalHeader.addEventListener('click', toggleGlobalBody);

// Global account enabled toggle
globalAccountToggle.addEventListener('change', async (e) => {
  e.stopPropagation(); // Don't trigger collapse
  const enabled = globalAccountToggle.checked;
  currentSettings.globalAccountEnabled = enabled;
  await updateSettingsAndWait({ [STORAGE_KEYS.GLOBAL_ACCOUNT_ENABLED]: enabled });
  renderGlobalSection();
  renderCurrentSite();
  showStatus(enabled ? 'Global default enabled' : 'Global default disabled', 'info');
  if (enabled && currentTab?.id && currentTab?.url) {
    refreshCurrentTabNow();
  }
});

// Global account select
globalAccountSelect.addEventListener('change', async () => {
  const index = parseInt(globalAccountSelect.value, 10);
  const prevAccount = currentSettings.defaultAccount;
  currentSettings.defaultAccount = index;
  await updateSettingsAndWait({ [STORAGE_KEYS.DEFAULT_ACCOUNT]: index });
  renderCurrentSite();
  showStatus(`Global default set to Account ${index}`, 'success');

  // Auto-refresh if account changed and global is enabled
  if (prevAccount !== index && currentSettings.globalAccountEnabled && currentTab?.id && currentTab?.url) {
    refreshCurrentTabNow();
  }
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
        STORAGE_KEYS.GLOBAL_ACCOUNT_ENABLED,
        STORAGE_KEYS.ACCOUNTS,
        STORAGE_KEYS.SITE_SETTINGS,
      ]),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);

    currentSettings = settings;
    currentTab = tabs[0] || null;

    // Set UI state
    enableToggle.checked = settings.enabled !== false;
    modeSelect.value = settings.mode || 'proactive';

    // Render sections
    renderCurrentSite();
    renderSiteSettings(settings.siteSettings || {}, settings.accounts || []);
    renderAccounts(settings.accounts || []);
    renderGlobalSection();
  } catch (error) {
    console.error('[G-Account Switcher] Popup init error:', error);
    showStatus('Failed to load settings', 'error');
  }
}

initPopup();

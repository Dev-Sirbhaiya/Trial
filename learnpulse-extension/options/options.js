/**
 * Options Page Controller
 * -----------------------
 * Loads and persists LearnPulse user preferences.
 */

const statusElement = document.getElementById('status');
const modeSelect = document.getElementById('mode-select');
const topicInput = document.getElementById('topic-input');
const curatedWrapper = document.getElementById('curated-wrapper');
const curatedUrls = document.getElementById('curated-urls');
const curatedNotes = document.getElementById('curated-notes');
const curatedFileInput = document.getElementById('curated-file');
const curatedList = document.getElementById('curated-list');
const backendPreferencesList = document.getElementById('backend-preferences');
const geminiKeyInput = document.getElementById('gemini-key');
const ollamaModelInput = document.getElementById('ollama-model');
const lessonTimeInput = document.getElementById('lesson-time');
const notificationsToggle = document.getElementById('notifications-toggle');
const lessonLengthSlider = document.getElementById('lesson-length');
const lessonLengthValue = document.getElementById('lesson-length-value');
const flashcardCountSlider = document.getElementById('flashcard-count');
const flashcardCountValue = document.getElementById('flashcard-count-value');
const saveButton = document.getElementById('save-button');

let fileSources = [];

init();

function init() {
  modeSelect.addEventListener('change', handleModeChange);
  lessonLengthSlider.addEventListener('input', () => {
    lessonLengthValue.textContent = `${lessonLengthSlider.value} words`;
  });
  flashcardCountSlider.addEventListener('input', () => {
    flashcardCountValue.textContent = `${flashcardCountSlider.value} cards`;
  });
  curatedFileInput.addEventListener('change', handleFileUpload);
  saveButton.addEventListener('click', persistSettings);
  backendPreferencesList.addEventListener('click', handleBackendControls);
  backendPreferencesList.addEventListener('change', ensureBackendSelection);
  loadSettings();
}

function handleModeChange() {
  curatedWrapper.hidden = modeSelect.value !== 'curated';
}

async function loadSettings() {
  const [{ learnpulse_settings: settings }, { learnpulse_gemini_api_key: geminiKey }] = await Promise.all([
    chrome.storage.local.get('learnpulse_settings'),
    chrome.storage.sync.get('learnpulse_gemini_api_key')
  ]);

  if (settings) {
    modeSelect.value = settings.mode || 'autonomous';
    topicInput.value = settings.topic || '';
    notificationsToggle.checked = settings.notificationsEnabled !== false;
    lessonLengthSlider.value = settings.lessonLength || 750;
    lessonLengthValue.textContent = `${lessonLengthSlider.value} words`;
    flashcardCountSlider.value = settings.flashcardCount || 6;
    flashcardCountValue.textContent = `${flashcardCountSlider.value} cards`;
    ollamaModelInput.value = settings.ollamaModel || ollamaModelInput.value || 'mistral';
    if (settings.schedule) {
      const hour = String(settings.schedule.hour).padStart(2, '0');
      const minute = String(settings.schedule.minute).padStart(2, '0');
      lessonTimeInput.value = `${hour}:${minute}`;
    }
    applyBackendPreference(settings.backendPreference || []);
    fileSources = (settings.curatedSources || []).filter((source) => source.type === 'file');
    curatedUrls.value = (settings.curatedSources || [])
      .filter((source) => source.type === 'url')
      .map((source) => source.url)
      .join('\n');
    curatedNotes.value = (settings.curatedSources || [])
      .filter((source) => source.type === 'text')
      .map((source) => source.value || source.text)
      .join('\n\n');
    renderFileSources();
  }

  geminiKeyInput.value = geminiKey || '';
  handleModeChange();
}

function applyBackendPreference(order) {
  const items = Array.from(backendPreferencesList.querySelectorAll('li'));
  const allBackends = items.map((item) => item.dataset.backend);
  const enabledSet = new Set(order.length ? order : allBackends);
  const orderedBackends = [...enabledSet, ...allBackends.filter((backend) => !enabledSet.has(backend))];

  orderedBackends.forEach((backend) => {
    const item = items.find((entry) => entry.dataset.backend === backend);
    if (item) backendPreferencesList.appendChild(item);
  });

  items.forEach((item) => {
    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.checked = enabledSet.has(item.dataset.backend);
  });
  ensureBackendSelection();
}

function handleBackendControls(event) {
  const button = event.target.closest('button');
  if (!button) return;
  const item = event.target.closest('li');
  if (!item) return;
  if (button.classList.contains('up')) {
    const prev = item.previousElementSibling;
    if (prev) {
      backendPreferencesList.insertBefore(item, prev);
    }
  } else if (button.classList.contains('down')) {
    const next = item.nextElementSibling?.nextElementSibling;
    backendPreferencesList.insertBefore(item, next || null);
  }
  ensureBackendSelection();
}

function ensureBackendSelection() {
  const checkboxes = Array.from(backendPreferencesList.querySelectorAll('input[type="checkbox"]'));
  const enabled = checkboxes.filter((checkbox) => checkbox.checked);
  if (!enabled.length) {
    const first = checkboxes[0];
    if (first) first.checked = true;
  }
}

function handleFileUpload(event) {
  const files = Array.from(event.target.files || []);
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      fileSources.push({
        id: `file-${file.name}-${Date.now()}`,
        type: 'file',
        label: file.name,
        content: btoa(reader.result)
      });
      renderFileSources();
    };
    reader.readAsBinaryString(file);
  });
  event.target.value = '';
}

function renderFileSources() {
  curatedList.innerHTML = '';
  fileSources.forEach((source) => {
    const item = document.createElement('li');
    item.textContent = source.label;
    const removeButton = document.createElement('button');
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      fileSources = fileSources.filter((entry) => entry.id !== source.id);
      renderFileSources();
    });
    item.appendChild(removeButton);
    curatedList.appendChild(item);
  });
}

async function persistSettings() {
  const hour = parseInt(lessonTimeInput.value.split(':')[0], 10) || 9;
  const minute = parseInt(lessonTimeInput.value.split(':')[1], 10) || 0;

  const curatedEntries = [];
  curatedUrls.value
    .split(/\n+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((url, index) => {
      curatedEntries.push({
        id: `url-${index}-${Date.now()}`,
        type: 'url',
        url,
        label: url
      });
    });

  curatedNotes.value
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value, index) => {
      curatedEntries.push({
        id: `note-${index}-${Date.now()}`,
        type: 'text',
        value,
        label: `Note ${index + 1}`
      });
    });

  const settingsPayload = {
    mode: modeSelect.value,
    topic: topicInput.value.trim(),
    schedule: { hour, minute },
    notificationsEnabled: notificationsToggle.checked,
    lessonLength: Number(lessonLengthSlider.value),
    flashcardCount: Number(flashcardCountSlider.value),
    backendPreference: getBackendPreference(),
    curatedSources: [...curatedEntries, ...fileSources],
    ollamaModel: ollamaModelInput.value.trim()
  };

  await Promise.all([
    chrome.runtime.sendMessage({ type: 'learnpulse:updateSettings', payload: settingsPayload }),
    chrome.storage.sync.set({ learnpulse_gemini_api_key: geminiKeyInput.value.trim() })
  ]);

  statusElement.textContent = 'Saved successfully. Daily schedule updated.';
  setTimeout(() => (statusElement.textContent = ''), 3000);
}

function getBackendPreference() {
  return Array.from(backendPreferencesList.querySelectorAll('li'))
    .filter((item) => item.querySelector('input[type="checkbox"]').checked)
    .map((item) => item.dataset.backend);
}


# LearnPulse Chrome Extension

LearnPulse is a Manifest V3 Chrome extension that delivers daily AI-generated micro-lessons and spaced repetition flashcards. It automates your personal learning plan using free-tier AI backends (Google Gemini, local Ollama, or the Chrome Prompt API) while supporting dual learning modes:

- **Autonomous Mode** – describe a topic and LearnPulse builds the curriculum.
- **Curated Mode** – upload documents or links and LearnPulse teaches strictly from those sources.

## Features

- Automated daily lesson generation scheduled via the Chrome Alarms API.
- SM-2 spaced repetition engine with inline flashcard grading.
- Fallback-aware AI orchestration across Gemini, Ollama, and Chrome Prompt API.
- Offline-first storage with lesson history, streak tracking, and catch-up logic.
- Rich popup UI showing the lesson, due flashcards, and progress metrics.
- Options page for managing learning mode, curated sources, backend order, and notification preferences.

## Repository Structure

```
learnpulse-extension/
├── manifest.json
├── background/
│   └── service-worker.js
├── lib/
│   ├── content-chunker.js
│   ├── llm-gemini.js
│   ├── llm-ollama.js
│   ├── llm-nano.js
│   └── srs-engine.js
├── options/
│   ├── options.css
│   ├── options.html
│   └── options.js
├── popup/
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
└── assets/
```

## Getting Started

1. **Clone the repository** and open Chrome at `chrome://extensions/`.
2. Enable **Developer mode** and choose **Load unpacked**.
3. Select the `learnpulse-extension` directory.
4. Open the options page to configure your learning mode, schedule, and AI backends.
   - Provide a Gemini API key (stored in `chrome.storage.sync`) for cloud inference.
   - Optionally configure an Ollama model running locally at `http://localhost:11434`.
5. LearnPulse will automatically schedule the daily lesson. Use the popup to review lessons and grade flashcards.

## AI Backend Notes

- **Gemini API**: Requires an API key from [Google AI Studio](https://makersuite.google.com/app/apikey). The extension calls `gemini-1.5-flash-latest` by default.
- **Ollama**: Ensure Ollama is running with the desired model (`ollama run mistral`) before selecting it as the primary backend.
- **Chrome Prompt API**: Experimental on-device Gemini Nano integration. Availability is detected at runtime; when absent the extension automatically falls back to the next backend.

## Development Tips

- The background service worker coordinates scheduling, AI generation, storage, and notifications.
- Lessons and flashcards are stored in `chrome.storage.local` (retained for the latest 60 lessons) and stats track streaks/review counts.
- Manual generation can be triggered from the popup via the “Refresh” button.

## License

This project is provided as-is for educational purposes. Configure API keys responsibly and monitor usage to stay within free-tier limits.


import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';
import { applyStoredAccent } from './lib/use-accent';

// Apple devices (iOS/macOS) → system SF Pro (crispest); others use self-hosted SF Pro
if (/iPhone|iPad|iPod|Macintosh|Mac|Apple/i.test(navigator.userAgent)) {
  document.documentElement.classList.add('platform-apple');
}

// Apply the persisted accent before React paints, so every route and overlay
// starts with the user's chosen colour rather than waiting for Settings to open.
applyStoredAccent();

createRoot(document.getElementById('root')!).render(<App />);

/**
 * Frontend Mobbin Client Wrapper
 *
 * Provides a React-friendly interface to the Mobbin integration.
 * In the future, this could connect to the backend via API.
 */

import { MobbinClient as BackendClient } from '../../../api-server/src/lib/mobbin-integration';
import type { MobbinScreen, MobbinSearchQuery, MobbinSearchResult, MobbinCollection, CompetitorTeardown } from '../../../api-server/src/lib/mobbin-integration';

// Re-export types
export type { MobbinScreen, MobbinSearchQuery, MobbinSearchResult, MobbinCollection, CompetitorTeardown };

// For now, use the backend client directly on the frontend
// (It's pure TypeScript with no Node.js dependencies)
export { BackendClient as MobbinClient };

// Create a singleton instance
let mobbinInstance: BackendClient | null = null;

export function getMobbinClient(): BackendClient {
  if (!mobbinInstance) {
    mobbinInstance = new BackendClient();
  }
  return mobbinInstance;
}

export function createMobbinClient(): BackendClient {
  return new BackendClient();
}

// React hook for using the Mobbin client
import { useRef, useEffect } from 'react';

export function useMobbinClient(): BackendClient {
  const clientRef = useRef<BackendClient | null>(null);

  useEffect(() => {
    clientRef.current = getMobbinClient();
    return () => {
      // Cleanup if needed
    };
  }, []);

  return clientRef.current!;
}
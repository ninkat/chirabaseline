import React from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Awareness } from 'y-protocols/awareness';
import getWebsocketUrl from '../utils/websocketUtils';

// create a shared y.doc instance
const doc = new Y.Doc();
// create a webrtc provider for local collaboration
// we need to keep this even though it's "unused" - it handles the webrtc connections

const provider = new WebrtcProvider('react-yjs-room', doc, {
  signaling: [getWebsocketUrl()],
});

// create awareness instance
const awareness = provider.awareness;

// include null in the type to handle cases where context might not be available
export const YjsContext = React.createContext<{
  doc: Y.Doc;
  awareness: Awareness;
} | null>({ doc, awareness });

export const YjsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <YjsContext.Provider value={{ doc, awareness }}>
      {children}
    </YjsContext.Provider>
  );
};

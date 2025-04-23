import React from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Awareness } from 'y-protocols/awareness';

// do not change this file
// create a shared Y.Doc instance
const doc = new Y.Doc();
// create a WebRTC provider for local collaboration
// we need to keep this even though it's "unused" - it handles the WebRTC connections
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const provider = new WebrtcProvider('react-yjs-room', doc);

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

import React from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';

// create a shared Y.Doc instance
const doc = new Y.Doc();
// create a WebRTC provider for local collaboration
const provider = new WebrtcProvider('react-yjs-room', doc);

export const YjsContext = React.createContext<Y.Doc>(doc);

export const YjsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return <YjsContext.Provider value={doc}>{children}</YjsContext.Provider>;
};

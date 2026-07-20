import { EVENT_SOURCES, EVENT_TYPES } from '../EventModule/eventDto';

export type ConnectorMode =
  | 'oauth'
  | 'token'
  | 'extension'
  | 'ingest'
  | 'manual';

export type ConnectorCatalogItem = {
  source: (typeof EVENT_SOURCES)[number];
  name: string;
  mode: ConnectorMode;
  description: string;
  /** Can call POST /connectors/:source/sync */
  syncSupported: boolean;
  /** Can push events via POST /connectors/ingest */
  ingestSupported: boolean;
  connectFields: string[];
  defaultEventType: (typeof EVENT_TYPES)[number];
};

export const CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  {
    source: 'github',
    name: 'GitHub',
    mode: 'token',
    description: 'Commits, PRs, issues via classic PAT (repo scope).',
    syncSupported: true,
    ingestSupported: false,
    connectFields: ['accessToken'],
    defaultEventType: 'commit',
  },
  {
    source: 'vscode',
    name: 'VS Code',
    mode: 'extension',
    description: 'VS Code extension pushes file edits and workspace activity.',
    syncSupported: false,
    ingestSupported: true,
    connectFields: [],
    defaultEventType: 'file_edit',
  },
  {
    source: 'chrome',
    name: 'Chrome',
    mode: 'extension',
    description: 'Chrome extension pushes browse history / tab events.',
    syncSupported: false,
    ingestSupported: true,
    connectFields: [],
    defaultEventType: 'browse',
  },
  {
    source: 'gmail',
    name: 'Gmail',
    mode: 'oauth',
    description: 'Email memory via Google OAuth (token sync when configured).',
    syncSupported: true,
    ingestSupported: true,
    connectFields: ['accessToken', 'refreshToken'],
    defaultEventType: 'email',
  },
  {
    source: 'slack',
    name: 'Slack',
    mode: 'oauth',
    description: 'Slack messages via bot/user token.',
    syncSupported: true,
    ingestSupported: true,
    connectFields: ['accessToken'],
    defaultEventType: 'message',
  },
  {
    source: 'calendar',
    name: 'Calendar',
    mode: 'oauth',
    description: 'Meetings from Google Calendar.',
    syncSupported: true,
    ingestSupported: true,
    connectFields: ['accessToken', 'refreshToken'],
    defaultEventType: 'meeting',
  },
  {
    source: 'notion',
    name: 'Notion',
    mode: 'token',
    description: 'Notion pages/notes via integration token.',
    syncSupported: true,
    ingestSupported: true,
    connectFields: ['accessToken'],
    defaultEventType: 'note',
  },
  {
    source: 'drive',
    name: 'Drive',
    mode: 'oauth',
    description: 'Google Drive file activity.',
    syncSupported: true,
    ingestSupported: true,
    connectFields: ['accessToken', 'refreshToken'],
    defaultEventType: 'file',
  },
  {
    source: 'photos',
    name: 'Photos',
    mode: 'oauth',
    description: 'Photo library events (Google Photos / local ingest).',
    syncSupported: false,
    ingestSupported: true,
    connectFields: ['accessToken'],
    defaultEventType: 'photo',
  },
  {
    source: 'manual',
    name: 'Manual',
    mode: 'manual',
    description: 'Notes you add yourself — always available.',
    syncSupported: false,
    ingestSupported: true,
    connectFields: [],
    defaultEventType: 'note',
  },
];

export function getCatalogItem(source: string): ConnectorCatalogItem | undefined {
  return CONNECTOR_CATALOG.find((c) => c.source === source);
}

const { contextBridge, ipcRenderer } = require('electron');
const allowedEvents = new Set(['channel:init', 'message', 'presence', 'typing', 'connection', 'error', 'session-expired']);
contextBridge.exposeInMainWorld('glassChat', Object.freeze({
  platform: process.platform,
  electronVersion: process.versions.electron,
  getMetadata: () => ipcRenderer.invoke('app:metadata'),
  auth: Object.freeze({
    status: () => ipcRenderer.invoke('auth:status'),
    register: data => ipcRenderer.invoke('auth:register', data),
    login: data => ipcRenderer.invoke('auth:login', data),
    verifyEmail: data => ipcRenderer.invoke('auth:verify-email', data),
    resendVerification: data => ipcRenderer.invoke('auth:resend-verification', data),
    forgotPassword: data => ipcRenderer.invoke('auth:forgot-password', data),
    resetPassword: data => ipcRenderer.invoke('auth:reset-password', data),
    logout: () => ipcRenderer.invoke('auth:logout'),
    setApiBaseUrl: value => ipcRenderer.invoke('auth:set-api-base-url', value),
    getApiBaseUrl: () => ipcRenderer.invoke('auth:get-api-base-url')
  }),
  chat: Object.freeze({
    joinChannel: channelId => ipcRenderer.invoke('chat:join-channel', channelId),
    sendMessage: text => ipcRenderer.invoke('chat:send-message', text),
    setTyping: active => ipcRenderer.invoke('chat:set-typing', active),
    onEvent: callback => {
      if (typeof callback !== 'function') throw new TypeError('A callback is required');
      const listener = (_event, payload) => { if (payload && allowedEvents.has(payload.type)) callback(payload); };
      ipcRenderer.on('chat:event', listener);
      return () => ipcRenderer.removeListener('chat:event', listener);
    }
  })
}));

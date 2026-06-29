import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("openleash", {
  list: () => ipcRenderer.invoke("openleash:list"),
  bootstrapRemoteApi: (payload: unknown) => ipcRenderer.invoke("openleash:bootstrap-remote-api", payload),
  startRemoteAuth: (payload: unknown) => ipcRenderer.invoke("openleash:start-remote-auth", payload),
  startOrgCloudOnboarding: (payload: unknown) => ipcRenderer.invoke("openleash:start-org-cloud-onboarding", payload),
  remoteState: (payload: unknown) => ipcRenderer.invoke("openleash:remote-state", payload),
  saveRemoteModelKey: (payload: unknown) => ipcRenderer.invoke("openleash:save-remote-model-key", payload),
  dockerStatus: () => ipcRenderer.invoke("openleash:docker-status"),
  startSelfHosted: () => ipcRenderer.invoke("openleash:start-self-hosted"),
  openLocalConfig: () => ipcRenderer.invoke("openleash:open-local-config"),
  markIntroSeen: () => ipcRenderer.invoke("openleash:mark-intro-seen"),
  setup: (payload: unknown) => ipcRenderer.invoke("openleash:setup", payload),
  saveSettings: (payload: unknown) => ipcRenderer.invoke("openleash:save-settings", payload),
  setAgentMonitoring: (payload: unknown) => ipcRenderer.invoke("openleash:set-agent-monitoring", payload),
  savePluginSettings: (payload: unknown) => ipcRenderer.invoke("openleash:save-plugin-settings", payload),
  savePromptTransforms: (payload: unknown) => ipcRenderer.invoke("openleash:save-prompt-transforms", payload),
  deleteData: () => ipcRenderer.invoke("openleash:delete-data"),
  deleteSettings: () => ipcRenderer.invoke("openleash:delete-settings"),
  deleteDataAndSettings: () => ipcRenderer.invoke("openleash:delete-data-and-settings"),
  copyText: (text: string) => ipcRenderer.invoke("openleash:copy-text", text),
  savePolicies: (policies: unknown) => ipcRenderer.invoke("openleash:save-policies", policies),
  importRules: (payload: unknown) => ipcRenderer.invoke("openleash:import-rules", payload),
  importRuleListJson: () => ipcRenderer.invoke("openleash:import-rule-list-json"),
  discoverInstructionRules: () => ipcRenderer.invoke("openleash:discover-instruction-rules"),
  resolve: (id: string, resolution: "allow" | "deny", resolutionGuidance?: string) => ipcRenderer.invoke("openleash:resolve", id, resolution, resolutionGuidance),
  dismissNotice: () => ipcRenderer.invoke("openleash:dismiss-notice"),
  onUpdate: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("openleash:update", (_event, payload) => callback(payload));
  },
  onNotice: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("openleash:notice", (_event, payload) => callback(payload));
  },
  onAuth: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("openleash:auth", (_event, payload) => callback(payload));
  }
});

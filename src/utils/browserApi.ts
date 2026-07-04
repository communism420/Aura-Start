type AnyExtensionApi = Partial<typeof chrome> & {
  browserAction?: unknown;
};

type GlobalWithExtensionApis = typeof globalThis & {
  browser?: AnyExtensionApi;
  chrome?: AnyExtensionApi;
};

type RuntimeMessageListener = (message: unknown, sender?: chrome.runtime.MessageSender) => void;
type CallbackResult<T> = (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void;
type WebAuthFlowDetails = {
  interactive?: boolean;
  url: string;
};
type InvalidTokenDetails = {
  token: string;
};

export type ExtensionStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export type ExtensionTab = Pick<chrome.tabs.Tab, "favIconUrl" | "title" | "url">;
export type ExtensionDataCollectionPermission = "browsingActivity" | "technicalAndInteraction";

function extensionGlobals(): GlobalWithExtensionApis {
  return globalThis as GlobalWithExtensionApis;
}

function usesBrowserNamespace(): boolean {
  return Boolean(extensionGlobals().browser);
}

export function getExtensionApi(): AnyExtensionApi | undefined {
  const globals = extensionGlobals();
  return globals.browser ?? globals.chrome;
}

export function getExtensionLastErrorMessage(): string | undefined {
  const api = getExtensionApi();
  return api?.runtime?.lastError?.message;
}

function rejectLastError(reject: (reason?: unknown) => void): boolean {
  const message = getExtensionLastErrorMessage();
  if (!message) {
    return false;
  }

  reject(new Error(message));
  return true;
}

async function callPromiseOrCallback<T>(
  promiseCall: () => Promise<T> | T,
  callbackCall: CallbackResult<T>
): Promise<T> {
  if (usesBrowserNamespace()) {
    return await promiseCall();
  }

  return await new Promise<T>((resolve, reject) => {
    callbackCall(resolve, reject);
  });
}

function storageArea(areaName: "local" | "session"): chrome.storage.StorageArea | undefined {
  return getExtensionApi()?.storage?.[areaName];
}

export function getExtensionStorageArea(areaName: "local" | "session"): ExtensionStorageArea | undefined {
  const area = storageArea(areaName);
  if (!area) {
    return undefined;
  }

  return {
    get: async (key) =>
      await callPromiseOrCallback(
        async () => (await (area.get as (key: string) => Promise<Record<string, unknown>>)(key)) ?? {},
        (resolve, reject) => {
          area.get(key, (result) => {
            if (rejectLastError(reject)) return;
            resolve((result ?? {}) as Record<string, unknown>);
          });
        }
      ),
    set: async (items) =>
      await callPromiseOrCallback(
        async () => {
          await (area.set as (items: Record<string, unknown>) => Promise<void>)(items);
        },
        (resolve, reject) => {
          area.set(items, () => {
            if (rejectLastError(reject)) return;
            resolve();
          });
        }
      ),
    remove: async (key) =>
      await callPromiseOrCallback(
        async () => {
          await (area.remove as (key: string) => Promise<void>)(key);
        },
        (resolve, reject) => {
          area.remove(key, () => {
            if (rejectLastError(reject)) return;
            resolve();
          });
        }
      )
  };
}

export function hasExtensionRuntime(): boolean {
  return Boolean(getExtensionApi()?.runtime);
}

export function getExtensionRuntimeId(): string | undefined {
  return getExtensionApi()?.runtime?.id;
}

export function getExtensionManifest(): chrome.runtime.Manifest | undefined {
  return getExtensionApi()?.runtime?.getManifest?.();
}

export async function sendExtensionRuntimeMessage(message: unknown): Promise<void> {
  const runtime = getExtensionApi()?.runtime;
  if (!runtime?.sendMessage) {
    return;
  }

  await callPromiseOrCallback(
    async () => {
      await (runtime.sendMessage as (message: unknown) => Promise<unknown>)(message);
    },
    (resolve) => {
      runtime.sendMessage(message, () => {
        void getExtensionLastErrorMessage();
        resolve();
      });
    }
  ).catch(() => undefined);
}

export function addExtensionRuntimeMessageListener(listener: RuntimeMessageListener): boolean {
  const onMessage = getExtensionApi()?.runtime?.onMessage;
  if (!onMessage) {
    return false;
  }

  onMessage.addListener(listener);
  return true;
}

export function removeExtensionRuntimeMessageListener(listener: RuntimeMessageListener): void {
  getExtensionApi()?.runtime?.onMessage?.removeListener(listener);
}

export async function openExtensionOptionsPage(): Promise<boolean> {
  const runtime = getExtensionApi()?.runtime;
  if (!runtime?.openOptionsPage) {
    return false;
  }

  await callPromiseOrCallback(
    async () => {
      await (runtime.openOptionsPage as () => Promise<void>)();
    },
    (resolve, reject) => {
      runtime.openOptionsPage(() => {
        if (rejectLastError(reject)) return;
        resolve();
      });
    }
  );
  return true;
}

export function addExtensionCommandListener(listener: (command: string) => void): boolean {
  const onCommand = getExtensionApi()?.commands?.onCommand;
  if (!onCommand) {
    return false;
  }

  onCommand.addListener(listener);
  return true;
}

export function hasExtensionPermissionsApi(): boolean {
  const permissions = getExtensionApi()?.permissions;
  return Boolean(permissions?.contains && permissions.request);
}

export async function containsExtensionPermission(permission: string): Promise<boolean> {
  const permissions = getExtensionApi()?.permissions;
  if (!permissions?.contains) {
    return false;
  }

  return await callPromiseOrCallback(
    async () => Boolean(await (permissions.contains as (permissions: chrome.permissions.Permissions) => Promise<boolean>)({ permissions: [permission] })),
    (resolve) => {
      permissions.contains({ permissions: [permission] }, (granted) => {
        resolve(Boolean(granted));
      });
    }
  ).catch(() => false);
}

export async function requestExtensionPermission(permission: string): Promise<boolean> {
  const permissions = getExtensionApi()?.permissions;
  if (!permissions?.request) {
    throw new Error("Extension permissions API is unavailable.");
  }

  // Firefox requires permissions.request to run directly from a user input
  // handler. A preflight permissions.contains await can consume that gesture.
  return await callPromiseOrCallback(
    async () => Boolean(await (permissions.request as (permissions: chrome.permissions.Permissions) => Promise<boolean>)({ permissions: [permission] })),
    (resolve, reject) => {
      permissions.request({ permissions: [permission] }, (granted) => {
        if (rejectLastError(reject)) return;
        resolve(Boolean(granted));
      });
    }
  );
}

export async function containsExtensionDataCollectionPermissions(
  dataCollectionPermissions: ExtensionDataCollectionPermission[]
): Promise<boolean> {
  const permissions = getExtensionApi()?.permissions as {
    contains?: (permissions: Record<string, unknown>, callback?: (granted: boolean) => void) => Promise<boolean> | void;
  } | undefined;
  if (!permissions?.contains) {
    return false;
  }

  const request = { data_collection: dataCollectionPermissions };
  return await callPromiseOrCallback(
    async () => Boolean(await permissions.contains?.(request)),
    (resolve, reject) => {
      permissions.contains?.(request, (granted) => {
        if (rejectLastError(reject)) return;
        resolve(Boolean(granted));
      });
    }
  ).catch(() => false);
}

export async function requestExtensionDataCollectionPermissions(
  dataCollectionPermissions: ExtensionDataCollectionPermission[]
): Promise<boolean> {
  const permissions = getExtensionApi()?.permissions as {
    request?: (permissions: Record<string, unknown>, callback?: (granted: boolean) => void) => Promise<boolean> | void;
  } | undefined;
  if (!permissions?.request) {
    return true;
  }

  const request = { data_collection: dataCollectionPermissions };
  // Firefox requires permissions.request to run directly from a user input
  // handler. A preflight permissions.contains await can consume that gesture.
  return await callPromiseOrCallback(
    async () => Boolean(await permissions.request?.(request)),
    (resolve, reject) => {
      permissions.request?.(request, (granted) => {
        if (rejectLastError(reject)) return;
        resolve(Boolean(granted));
      });
    }
  );
}

export async function queryCurrentWindowTabs(): Promise<ExtensionTab[]> {
  const tabs = getExtensionApi()?.tabs;
  if (!tabs?.query) {
    throw new Error("Extension tabs API is unavailable.");
  }

  return await callPromiseOrCallback(
    async () => await (tabs.query as (queryInfo: chrome.tabs.QueryInfo) => Promise<ExtensionTab[]>)({ currentWindow: true }),
    (resolve, reject) => {
      tabs.query({ currentWindow: true }, (result) => {
        if (rejectLastError(reject)) return;
        resolve(result);
      });
    }
  );
}

export async function createExtensionTab(createProperties: chrome.tabs.CreateProperties): Promise<void> {
  const tabs = getExtensionApi()?.tabs;
  if (!tabs?.create) {
    globalThis.open?.(createProperties.url ?? "newtab.html", "_blank", "noopener,noreferrer");
    return;
  }

  await callPromiseOrCallback(
    async () => {
      await (tabs.create as (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>)(createProperties);
    },
    (resolve) => {
      tabs.create(createProperties, () => {
        void getExtensionLastErrorMessage();
        resolve();
      });
    }
  ).catch(() => {
    globalThis.open?.(createProperties.url ?? "newtab.html", "_blank", "noopener,noreferrer");
  });
}

export function hasExtensionIdentityApi(): boolean {
  return Boolean(getExtensionApi()?.identity);
}

export function hasExtensionIdentityGetAuthToken(): boolean {
  return typeof getExtensionApi()?.identity?.getAuthToken === "function";
}

export function hasExtensionWebAuthFlow(): boolean {
  const identity = getExtensionApi()?.identity;
  return Boolean(identity?.launchWebAuthFlow && identity.getRedirectURL);
}

export function getExtensionRedirectUrl(path = ""): string | undefined {
  return getExtensionApi()?.identity?.getRedirectURL?.(path);
}

export async function getExtensionAuthToken(interactive: boolean): Promise<unknown> {
  const identity = getExtensionApi()?.identity;
  if (!identity?.getAuthToken) {
    throw new Error("Extension identity getAuthToken API is unavailable.");
  }

  return await callPromiseOrCallback(
    async () => await (identity.getAuthToken as (details: chrome.identity.TokenDetails) => Promise<unknown>)({ interactive }),
    (resolve, reject) => {
      identity.getAuthToken({ interactive }, (token) => {
        if (rejectLastError(reject)) return;
        resolve(token);
      });
    }
  );
}

export async function launchExtensionWebAuthFlow(details: WebAuthFlowDetails): Promise<string> {
  const identity = getExtensionApi()?.identity;
  if (!identity?.launchWebAuthFlow) {
    throw new Error("Extension identity web auth flow API is unavailable.");
  }

  return await callPromiseOrCallback(
    async () => await (identity.launchWebAuthFlow as (details: WebAuthFlowDetails) => Promise<string>)(details),
    (resolve, reject) => {
      identity.launchWebAuthFlow(details, (redirectedTo) => {
        if (rejectLastError(reject)) return;
        if (!redirectedTo) {
          reject(new Error("Web authorization did not complete."));
          return;
        }
        resolve(redirectedTo);
      });
    }
  );
}

export async function removeCachedExtensionAuthToken(token: string): Promise<void> {
  const identity = getExtensionApi()?.identity;
  if (!identity?.removeCachedAuthToken) {
    return;
  }

  await callPromiseOrCallback(
    async () => {
      await (identity.removeCachedAuthToken as (details: InvalidTokenDetails) => Promise<void>)({ token });
    },
    (resolve, reject) => {
      identity.removeCachedAuthToken({ token }, () => {
        if (rejectLastError(reject)) return;
        resolve();
      });
    }
  );
}

export async function getExtensionProfileUserInfo(): Promise<{ email?: string } | undefined> {
  const identity = getExtensionApi()?.identity;
  if (!identity?.getProfileUserInfo) {
    return undefined;
  }

  return await callPromiseOrCallback(
    async () => await (identity.getProfileUserInfo as () => Promise<{ email?: string }>)(),
    (resolve) => {
      identity.getProfileUserInfo((info) => {
        resolve({ email: typeof info.email === "string" ? info.email : undefined });
      });
    }
  ).catch(() => undefined);
}

// Node 22+ exposes a localStorage global that is undefined unless
// --localstorage-file is set. That hides jsdom's storage and crashes
// modules which read localStorage at import time.
const storage = globalThis.localStorage
if (!storage || typeof storage.getItem !== "function") {
   const memory = new Map<string, string>()
   const shim: Storage = {
      get length() {
         return memory.size
      },
      clear() {
         memory.clear()
      },
      getItem(key: string) {
         return memory.has(key) ? memory.get(key)! : null
      },
      key(index: number) {
         return [...memory.keys()][index] ?? null
      },
      removeItem(key: string) {
         memory.delete(key)
      },
      setItem(key: string, value: string) {
         memory.set(key, String(value))
      },
   }
   Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: shim,
   })
}
